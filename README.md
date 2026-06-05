# LangGraph Essay Writer Agent — Node.js

A beginner-friendly **LangGraph.js** project that builds an AI essay writer agent using **Node.js**, **JavaScript**, **Gemini**, and **Tavily Search**.

The agent creates an essay through a multi-step workflow:

```text
planner → research_plan → generate → reflect → research_critique → generate → END
```

---

## What this project does

This agent:

1. Receives an essay topic from the user.
2. Creates a high-level essay plan.
3. Generates research queries.
4. Searches the web using Tavily.
5. Writes a first draft.
6. Critiques the draft.
7. Searches again based on the critique.
8. Generates an improved final draft.
9. Stops when the maximum revision count is reached.

---

## Tech stack

- **Node.js**
- **JavaScript ES Modules**
- **LangGraph.js**
- **LangChain.js**
- **Gemini API**
- **Tavily Search API**
- **dotenv**
- **zod**

---

## Project structure

```text
langgraph-essay-agent-js/
  .env
  .gitignore
  package.json
  src/
    index.js
    graph.js
    prompts.js
```

---

## Requirements

Install these before running the project:

- Node.js 20 or later
- npm
- A Gemini API key
- A Tavily API key

Check Node and npm:

```bash
node -v
npm -v
```

---

## Installation

Clone or create the project folder, then install dependencies:

```bash
npm install
```

Required packages:

```bash
npm install @langchain/langgraph @langchain/core @langchain/google-genai @tavily/core dotenv zod
```

---

## Environment variables

Create a `.env` file in the project root:

```env
GOOGLE_API_KEY=your_gemini_api_key_here
TAVILY_API_KEY=your_tavily_api_key_here
```

Do not commit `.env` to GitHub.

Your `.gitignore` should include:

```gitignore
node_modules
.env
```

---

## Run the agent

Start the project:

```bash
npm start
```

Or run with a custom topic:

```bash
npm start -- "How can AI agents improve accessibility testing?"
```

---

## Example output

When the agent runs successfully, you should see logs like:

```text
Starting Essay Writer Agent...

--- PLANNER NODE ---
--- RESEARCH PLAN NODE ---
Searching: ...
--- GENERATE NODE ---
--- SHOULD CONTINUE? ---
--- REFLECTION NODE ---
--- RESEARCH CRITIQUE NODE ---
Searching: ...
--- GENERATE NODE ---

FINAL ESSAY
...
```

---

## Main graph flow

```text
START
  ↓
planner
  ↓
research_plan
  ↓
generate
  ↓
should_continue?
  ├── END
  └── reflect
        ↓
    research_critique
        ↓
      generate
```

---

## State fields

The graph state contains:

| Field | Purpose |
|---|---|
| `task` | The essay topic |
| `plan` | The essay outline |
| `draft` | The current essay draft |
| `critique` | Feedback on the draft |
| `content` | Research content from Tavily |
| `revisionNumber` | Current revision count |
| `maxRevisions` | Maximum allowed revisions |

---

## Main nodes

### `planner`

Creates the essay outline.

Input:

```text
task
```

Output:

```text
plan
```

---

### `research_plan`

Creates research queries from the task and searches Tavily.

Input:

```text
task
```

Output:

```text
content
```

---

### `generate`

Writes the essay using the task, plan, content, and critique.

Input:

```text
task, plan, content, critique
```

Output:

```text
draft, revisionNumber
```

---

### `reflect`

Reviews the draft and creates critique.

Input:

```text
draft
```

Output:

```text
critique
```

---

### `research_critique`

Creates new search queries based on the critique and appends more research content.

Input:

```text
critique
```

Output:

```text
content
```

---

## Useful configuration

In `src/index.js`, you can control how many revision loops the agent runs:

```js
const input = {
  task:
    process.argv.slice(2).join(" ") ||
    "What is the difference between LangChain and LangSmith?",
  maxRevisions: 1,
  revisionNumber: 1,
};
```

For learning, keep:

```js
maxRevisions: 1
```

This reduces API usage.

---

## Gemini model

The project uses Gemini through LangChain:

```js
const model = new ChatGoogleGenerativeAI({
  model: "gemini-2.5-flash-lite",
  temperature: 0,
});
```

If you receive a quota error, try another available Gemini model or check your Google AI Studio quota.

---

## Common errors

### 1. `Cannot use import statement outside a module`

Fix:

Add this to `package.json`:

```json
"type": "module"
```

---

### 2. Gemini quota error / 429

Example:

```text
429 Too Many Requests
Quota exceeded
```

Fix options:

- Use `gemini-2.5-flash-lite`
- Reduce `maxRevisions`
- Wait and retry later
- Check your Google AI Studio quota

---

### 3. Missing API key

Check your `.env` file:

```env
GOOGLE_API_KEY=...
TAVILY_API_KEY=...
```

Also make sure `src/index.js` imports dotenv:

```js
import "dotenv/config";
```

---

### 4. Tavily search error

Check:

- `TAVILY_API_KEY` is correct
- Tavily account has available usage
- Internet connection is working

---

## Learning notes

This project teaches the core LangGraph concepts:

| Concept | Meaning |
|---|---|
| State | Shared memory/data of the graph |
| Node | One step in the workflow |
| Edge | Path from one node to another |
| Conditional edge | Decision point |
| Checkpointer | Saves graph progress |
| Streaming | Shows updates while the graph runs |

---

## Next improvement ideas

After the basic essay agent works, you can extend it by:

- Adding an Express API
- Adding a React frontend
- Saving results to a file
- Adding human approval before final output
- Adding better error handling
- Turning the workflow into an accessibility analysis agent

Example accessibility version:

```text
planner → inspect_component → run_a11y_tests → generate_fix → reflect → test_again → END
```

---

## Git setup

Recommended first commit:

```bash
git init
git add .
git commit -m "Create first working LangGraph essay agent"
```

---

## Status

✅ First working LangGraph.js essay agent  
✅ Node.js backend  
✅ Gemini model connected  
✅ Tavily search connected  
✅ Multi-step graph workflow running  
