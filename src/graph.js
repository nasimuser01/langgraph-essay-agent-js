import {
  Annotation,
  END,
  MemorySaver,
  START,
  StateGraph,
} from '@langchain/langgraph';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { z } from 'zod';

import {
  PLAN_PROMPT,
  WRITER_PROMPT,
  REFLECTION_PROMPT,
  RESEARCH_PLAN_PROMPT,
  RESEARCH_CRITIQUE_PROMPT,
} from './prompts.js';
import { search } from './search.js';

/**
 * 1. Graph state.
 *
 * task:            original user topic
 * plan:            essay outline
 * draft:           current essay draft
 * critique:        review feedback
 * content:         research results ({ title, url, snippet }), appended across revisions
 * revisionNumber:  current revision count
 * maxRevisions:    maximum allowed revisions
 */
const replace = function (_left, right) {
  return right;
};

const EssayState = Annotation.Root({
  task: Annotation({ reducer: replace, default: () => '' }),
  plan: Annotation({ reducer: replace, default: () => '' }),
  draft: Annotation({ reducer: replace, default: () => '' }),
  critique: Annotation({ reducer: replace, default: () => '' }),
  content: Annotation({
    reducer: (left, right) => [...left, ...right],
    default: () => [],
  }),
  revisionNumber: Annotation({ reducer: replace, default: () => 1 }),
  maxRevisions: Annotation({ reducer: replace, default: () => 2 }),
});

/**
 * 2. The LLM.
 *
 * Groq (free tier) when LLM_PROVIDER=groq or a GROQ_API_KEY is set,
 * otherwise Gemini. Override the model name with GROQ_MODEL / GEMINI_MODEL.
 */
async function createModel() {
  const provider =
    process.env.LLM_PROVIDER ?? (process.env.GROQ_API_KEY ? 'groq' : 'gemini');

  if (provider === 'groq') {
    const { ChatGroq } = await import('@langchain/groq');
    return new ChatGroq({
      model: process.env.GROQ_MODEL ?? 'openai/gpt-oss-120b',
      temperature: 0,
      reasoningEffort: 'low', // free tier is 8k tokens/min; keep reasoning tokens small
    });
  }

  const { ChatGoogleGenerativeAI } = await import('@langchain/google-genai');
  return new ChatGoogleGenerativeAI({
    model: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash-lite',
    temperature: 0,
  });
}

/**
 * 3. Structured output schema for search queries.
 */
const QueriesSchema = z.object({
  queries: z
    .array(z.string())
    .max(3)
    .describe('Search queries to use for research. Maximum 3 queries.'),
});

/**
 * Progress reporting.
 *
 * LangGraph passes a `writer` on the config when the caller streams with
 * streamMode "custom". Everything emitted here becomes a live event for the UI.
 * When nobody is streaming (plain invoke), it is a no-op.
 */
function emit(config, event) {
  config?.writer?.(event);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Groq's free tier allows 8k tokens per minute, which one essay loop exceeds.
 * On a 429 the error says how long to wait; honour that, tell the UI, retry.
 */
async function withRateLimitRetry(step, config, fn) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const is429 = /rate limit|429/i.test(err.message);
      if (!is429 || attempt >= 5) throw err;

      const m = err.message.match(/try again in (?:(\d+)m)?([\d.]+)(m?s)/i);
      let seconds = 15;
      if (m) seconds = (Number(m[1] ?? 0) * 60) + (m[3] === 'ms' ? Number(m[2]) / 1000 : Number(m[2]));
      seconds = Math.ceil(seconds) + 1;

      emit(config, { event: 'waiting', step, seconds, attempt });
      await sleep(seconds * 1000);
    }
  }
}

/**
 * Run the planner's queries, reporting each search as it starts and finishes.
 * A failed search is recorded instead of aborting the run.
 */
async function runSearches(queries, step, config) {
  const content = [];

  for (const question of queries) {
    emit(config, { event: 'search', step, question, status: 'running' });

    let results = [];
    let error = null;
    try {
      results = await search(question);
    } catch (err) {
      error = `${err.name}: ${err.message}`;
    }

    content.push(...results);
    emit(config, {
      event: 'search',
      step,
      question,
      status: 'done',
      results: results.map((r) => ({ title: r.title, url: r.url })),
      error,
    });
  }

  return content;
}

function formatContent(content) {
  return content
    .map((r) => `- ${r.title} (${r.url}): ${r.snippet.slice(0, 300)}`)
    .join('\n');
}

/**
 * Node 1: Planner.   task -> plan
 */
async function planNode(state, config) {
  emit(config, { event: 'step', step: 'planner', status: 'running' });

  const model = await createModel();
  const response = await withRateLimitRetry('planner', config, () =>
    model.invoke([new SystemMessage(PLAN_PROMPT), new HumanMessage(state.task)]),
  );

  emit(config, { event: 'plan', text: response.content });
  return { plan: response.content };
}

/**
 * Node 2: Research the topic.   task -> content
 */
async function researchPlanNode(state, config) {
  emit(config, { event: 'step', step: 'research_plan', status: 'running' });

  const model = await createModel();
  const { queries } = await withRateLimitRetry('research_plan', config, () =>
    model
      .withStructuredOutput(QueriesSchema, { name: 'research_queries' })
      .invoke([new SystemMessage(RESEARCH_PLAN_PROMPT), new HumanMessage(state.task)]),
  );

  emit(config, { event: 'queries', step: 'research_plan', queries });
  const content = await runSearches(queries, 'research_plan', config);
  return { content };
}

/**
 * Node 3: Write or revise the essay.   task, plan, content, critique -> draft
 *
 * The model is streamed so the UI receives the essay token by token.
 */
async function generationNode(state, config) {
  emit(config, {
    event: 'step',
    step: 'generate',
    status: 'running',
    revision: state.revisionNumber,
  });

  const systemPrompt = WRITER_PROMPT.replace(
    '{content}',
    formatContent(state.content ?? []),
  );
  const userMessage = `
Task:
${state.task}

Plan:
${state.plan}

Current critique, if any:
${state.critique || 'No critique yet.'}
`;

  const model = await createModel();
  const draft = await withRateLimitRetry('generate', config, async () => {
    const stream = await model.stream([
      new SystemMessage(systemPrompt),
      new HumanMessage(userMessage),
    ]);

    let text = '';
    for await (const chunk of stream) {
      const piece = typeof chunk.content === 'string' ? chunk.content : '';
      if (piece) {
        text += piece;
        emit(config, { event: 'token', step: 'generate', text: piece });
      }
    }
    return text;
  });

  emit(config, { event: 'draft', revision: state.revisionNumber, text: draft });
  return { draft, revisionNumber: state.revisionNumber + 1 };
}

/**
 * Node 4: Critique the draft.   draft -> critique
 */
async function reflectionNode(state, config) {
  emit(config, { event: 'step', step: 'reflect', status: 'running' });

  const model = await createModel();
  const response = await withRateLimitRetry('reflect', config, () =>
    model.invoke([new SystemMessage(REFLECTION_PROMPT), new HumanMessage(state.draft)]),
  );

  emit(config, { event: 'critique', text: response.content });
  return { critique: response.content };
}

/**
 * Node 5: Research the critique.   critique -> more content
 */
async function researchCritiqueNode(state, config) {
  emit(config, { event: 'step', step: 'research_critique', status: 'running' });

  const model = await createModel();
  const { queries } = await withRateLimitRetry('research_critique', config, () =>
    model
      .withStructuredOutput(QueriesSchema, { name: 'critique_research_queries' })
      .invoke([new SystemMessage(RESEARCH_CRITIQUE_PROMPT), new HumanMessage(state.critique)]),
  );

  emit(config, { event: 'queries', step: 'research_critique', queries });
  const content = await runSearches(queries, 'research_critique', config);
  return { content };
}

/**
 * After generate: stop once the revision cap is reached, otherwise reflect.
 */
function shouldContinue(state) {
  return state.revisionNumber > state.maxRevisions ? END : 'reflect';
}

export function createEssayGraph() {
  return new StateGraph(EssayState)
    .addNode('planner', planNode)
    .addNode('research_plan', researchPlanNode)
    .addNode('generate', generationNode)
    .addNode('reflect', reflectionNode)
    .addNode('research_critique', researchCritiqueNode)
    .addEdge(START, 'planner')
    .addEdge('planner', 'research_plan')
    .addEdge('research_plan', 'generate')
    .addConditionalEdges('generate', shouldContinue, { [END]: END, reflect: 'reflect' })
    .addEdge('reflect', 'research_critique')
    .addEdge('research_critique', 'generate')
    .compile({ checkpointer: new MemorySaver() });
}
