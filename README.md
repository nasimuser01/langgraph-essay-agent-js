# LangGraph Essay Writer Agent — Node.js, with a live steps UI

A **LangGraph.js** essay-writing agent with an **Express** server that streams every
step of the run as Server-Sent Events, and a small **React** screen that shows the
agent planning, researching, drafting, reviewing itself and revising, live.

```text
planner → research_plan → generate → reflect → research_critique → generate → END
```

## What this project does

1. Receives an essay topic.
2. Writes a high-level outline (planner).
3. Generates search queries with structured output and searches the web (research_plan).
4. Streams a first draft token by token (generate).
5. Critiques the draft (reflect).
6. Searches again based on the critique (research_critique).
7. Streams a revised draft (generate) and stops at the revision cap.

Every node reports progress through LangGraph's custom stream writer, so the CLI,
the server and the UI all see the same events.

## Tech stack

- Node.js 20+, ES modules
- LangGraph.js, LangChain.js, zod
- LLM: **Groq** (free tier) or **Gemini**
- Search: **Tavily** (free tier) or the **Wikipedia API** (no key needed)
- Express 5 for the SSE API
- React 18 + Vite for the UI

## Project structure

```text
src/
  graph.js      the graph: state, nodes, edges, progress events
  search.js     Tavily or Wikipedia search
  prompts.js    system prompts
  server.js     Express server: GET /api/run?topic=...  → text/event-stream
  index.js      command-line runner
web/            React app (Vite)
.env.example    all settings
```

## Setup

```bash
npm install
npm run web:install
cp .env.example .env   # then fill in a key
```

Keys, pick one LLM and optionally Tavily:

| Variable         | Purpose                                                       |
|------------------|---------------------------------------------------------------|
| `GROQ_API_KEY`   | Free at console.groq.com. When set, Groq is used.             |
| `GROQ_MODEL`     | Default `openai/gpt-oss-120b`. Also `openai/gpt-oss-20b`, `qwen/qwen3.8-27b`. |
| `GOOGLE_API_KEY` | Gemini, used when no Groq key is set.                         |
| `LLM_PROVIDER`   | Force `groq` or `gemini`.                                     |
| `TAVILY_API_KEY` | Optional but recommended (free tier). Without it, Wikipedia search is used. |

## Run

Command line:

```bash
npm start -- "How can AI agents improve accessibility testing?"
```

Server and UI, two terminals:

```bash
npm run server          # http://localhost:3000
npm run web:dev         # http://localhost:5173, proxies /api to the server
```

Single process for a demo:

```bash
npm run web:build
npm run server          # serves the built UI at http://localhost:3000
```

Raw event stream:

```bash
curl -N "http://localhost:3000/api/run?topic=LangGraph"
```

## Events

| Event      | Data                                      | Meaning                        |
|------------|-------------------------------------------|--------------------------------|
| `step`     | `{ step, status, revision? }`             | a node started or finished     |
| `plan`     | `{ text }`                                | the outline                    |
| `queries`  | `{ step, queries }`                       | search queries for a node      |
| `search`   | `{ step, question, status, results?, error? }` | one query started or finished |
| `token`    | `{ step, text }`                          | a chunk of the essay           |
| `draft`    | `{ revision, text }`                      | a finished draft               |
| `critique` | `{ text }`                                | the reviewer's feedback        |
| `waiting`  | `{ step, seconds, attempt }`              | rate limited, retrying         |
| `done`     | `{ draft, plan, critique, revisions }`    | final state                    |
| `error`    | `{ message }`                             | the run failed                 |

## How the streaming works

`graph.stream(input, { streamMode: ["custom", "updates"] })` yields pairs of
mode and chunk. Custom chunks are whatever the nodes pass to `config.writer`.
Update chunks mark a node as finished. The server maps each to a named SSE
event. The React app opens an `EventSource` and appends a card to the timeline
for every `step … running` event, then patches that card as its events arrive.
The generate node calls `model.stream()` so tokens flow while the essay is written.

## Rate limits

Groq's free tier allows about 8,000 tokens per minute. One essay loop needs more
than that, so the graph catches 429 responses, waits the time Groq asks for, emits
a `waiting` event the UI shows, and retries. Reasoning effort is set to low to keep
token use down. A failed search is reported in the UI but does not stop the run.

## State fields

| Field            | Purpose                                      |
|------------------|----------------------------------------------|
| `task`           | the essay topic                              |
| `plan`           | the outline                                  |
| `draft`          | the current draft                            |
| `critique`       | feedback on the draft                        |
| `content`        | research results `{ title, url, snippet }`, appended across revisions |
| `revisionNumber` | current revision                             |
| `maxRevisions`   | revision cap, default 2 (`?maxRevisions=` on the API) |

## Learning notes

| Concept          | Where                                            |
|------------------|--------------------------------------------------|
| State + reducers | `Annotation.Root` in `src/graph.js`              |
| Structured output| `withStructuredOutput(QueriesSchema)`            |
| Conditional edge | `shouldContinue`                                 |
| Checkpointer     | `MemorySaver`, one thread id per request         |
| Custom streaming | `config.writer` in nodes, `streamMode: "custom"` |
| Token streaming  | `model.stream()` inside the generate node        |
