import {
  Annotation,
  END,
  MemorySaver,
  START,
  StateGraph,
} from '@langchain/langgraph';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { tavily } from '@tavily/core';
import { z } from 'zod';

import {
  PLAN_PROMPT,
  WRITER_PROMPT,
  REFLECTION_PROMPT,
  RESEARCH_PLAN_PROMPT,
  RESEARCH_CRITIQUE_PROMPT,
} from './prompts.js';

/**
 * 1. Create the graph state.
 *
 * This is similar to the Python AgentState:
 *
 * task: original user topic
 * plan: essay outline
 * draft: current essay draft
 * critique: review feedback
 * content: research documents
 * revisionNumber: current revision count
 * maxRevisions: maximum allowed revisions
 */
const EssayState = Annotation.Root({
  task: Annotation({
    reducer: function (_left, right) {
      return right;
    },
    default: function () {
      return '';
    },
  }),

  plan: Annotation({
    reducer: function (_left, right) {
      return right;
    },
    default: function () {
      return '';
    },
  }),

  draft: Annotation({
    reducer: function (_left, right) {
      return right;
    },
    default: function () {
      return '';
    },
  }),

  critique: Annotation({
    reducer: function (_left, right) {
      return right;
    },
    default: function () {
      return '';
    },
  }),

  /**
   * content is a list, so we append new research results
   * to the existing content.
   */
  content: Annotation({
    reducer: function (left, right) {
      return [...left, ...right];
    },
    default: function () {
      return [];
    },
  }),

  revisionNumber: Annotation({
    reducer: function (_left, right) {
      return right;
    },
    default: function () {
      return 1;
    },
  }),

  maxRevisions: Annotation({
    reducer: function (_left, right) {
      return right;
    },
    default: function () {
      return 2;
    },
  }),
});

/**
 * 2. Create the LLM model.
 */
const model = new ChatGoogleGenerativeAI({
  model: 'gemini-2.5-flash-lite',
  temperature: 0,
});

/**
 * 3. Create Tavily client.
 */
const tavilyClient = tavily({
  apiKey: process.env.TAVILY_API_KEY,
});

/**
 * 4. Structured output schema for search queries.
 *
 * This forces the model to return:
 * {
 *   queries: ["query one", "query two"]
 * }
 */
const QueriesSchema = z.object({
  queries: z
    .array(z.string())
    .max(3)
    .describe('Search queries to use for research. Maximum 3 queries.'),
});

/**
 * Safely search Tavily and return an array of content strings.
 */
async function searchTavily(query) {
  const response = await tavilyClient.search(query, {
    maxResults: 2,
    searchDepth: 'basic',
  });

  const results = response.results ?? [];

  return results
    .map(function (result) {
      return result.content;
    })
    .filter(Boolean);
}

/**
 * Node 1: Planner
 *
 * Input: task
 * Output: plan
 */
async function planNode(state) {
  console.log('\n--- PLANNER NODE ---');

  const response = await model.invoke([
    new SystemMessage(PLAN_PROMPT),
    new HumanMessage(state.task),
  ]);

  return {
    plan: response.content,
  };
}

/**
 * Node 2: Research based on the original plan/topic
 *
 * Input: task
 * Output: content
 */
async function researchPlanNode(state) {
  console.log('\n--- RESEARCH PLAN NODE ---');

  const structuredModel = model.withStructuredOutput(QueriesSchema, {
    name: 'research_queries',
  });

  const queryResult = await structuredModel.invoke([
    new SystemMessage(RESEARCH_PLAN_PROMPT),
    new HumanMessage(state.task),
  ]);

  const newContent = [];

  for (const query of queryResult.queries) {
    console.log(`Searching: ${query}`);

    const searchResults = await searchTavily(query);
    newContent.push(...searchResults);
  }

  return {
    content: newContent,
  };
}

/**
 * Node 3: Generate essay draft
 *
 * Input: task, plan, content
 * Output: draft, revisionNumber
 */
async function generationNode(state) {
  console.log('\n--- GENERATE NODE ---');

  const researchContent = (state.content ?? []).join('\n\n');

  const writerPromptWithContent = WRITER_PROMPT.replace(
    '{content}',
    researchContent,
  );

  const userMessage = `
Task:
${state.task}

Plan:
${state.plan}

Current critique, if any:
${state.critique || 'No critique yet.'}
`;

  const response = await model.invoke([
    new SystemMessage(writerPromptWithContent),
    new HumanMessage(userMessage),
  ]);

  return {
    draft: response.content,
    revisionNumber: state.revisionNumber + 1,
  };
}

/**
 * Node 4: Reflect / critique the current draft
 *
 * Input: draft
 * Output: critique
 */
async function reflectionNode(state) {
  console.log('\n--- REFLECTION NODE ---');

  const response = await model.invoke([
    new SystemMessage(REFLECTION_PROMPT),
    new HumanMessage(state.draft),
  ]);

  return {
    critique: response.content,
  };
}

/**
 * Node 5: Research based on the critique
 *
 * Input: critique
 * Output: more content
 */
async function researchCritiqueNode(state) {
  console.log('\n--- RESEARCH CRITIQUE NODE ---');

  const structuredModel = model.withStructuredOutput(QueriesSchema, {
    name: 'critique_research_queries',
  });

  const queryResult = await structuredModel.invoke([
    new SystemMessage(RESEARCH_CRITIQUE_PROMPT),
    new HumanMessage(state.critique),
  ]);

  const newContent = [];

  for (const query of queryResult.queries) {
    console.log(`Searching: ${query}`);

    const searchResults = await searchTavily(query);
    newContent.push(...searchResults);
  }

  return {
    content: newContent,
  };
}

/**
 * Conditional edge after generate.
 *
 * If revisionNumber is greater than maxRevisions, stop.
 * Otherwise, go to reflect.
 */
function shouldContinue(state) {
  console.log('\n--- SHOULD CONTINUE? ---');
  console.log(`Revision: ${state.revisionNumber}`);
  console.log(`Max revisions: ${state.maxRevisions}`);

  if (state.revisionNumber > state.maxRevisions) {
    return END;
  }

  return 'reflect';
}

/**
 * Build and compile the graph.
 */
export function createEssayGraph() {
  const checkpointer = new MemorySaver();

  const graph = new StateGraph(EssayState)
    .addNode('planner', planNode)
    .addNode('research_plan', researchPlanNode)
    .addNode('generate', generationNode)
    .addNode('reflect', reflectionNode)
    .addNode('research_critique', researchCritiqueNode)

    .addEdge(START, 'planner')
    .addEdge('planner', 'research_plan')
    .addEdge('research_plan', 'generate')

    .addConditionalEdges('generate', shouldContinue, {
      [END]: END,
      reflect: 'reflect',
    })

    .addEdge('reflect', 'research_critique')
    .addEdge('research_critique', 'generate')

    .compile({
      checkpointer,
    });

  return graph;
}
