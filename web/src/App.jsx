import { useRef, useState } from "react";
import StepCard from "./StepCard.jsx";

const LABELS = {
  planner: "Planning",
  research_plan: "Researching",
  generate: "Drafting",
  reflect: "Reviewing",
  research_critique: "Researching the critique",
};

const initialRun = () => ({ steps: [], final: null, error: null });

export default function App() {
  const [topic, setTopic] = useState("What is the difference between LangChain and LangSmith?");
  const [run, setRun] = useState(initialRun);
  const [running, setRunning] = useState(false);
  const sourceRef = useRef(null);

  function stop() {
    sourceRef.current?.close();
    sourceRef.current = null;
    setRunning(false);
  }

  // Apply an update to the most recent step with the given name.
  function patchStep(name, fn) {
    setRun((r) => {
      const steps = [...r.steps];
      for (let i = steps.length - 1; i >= 0; i--) {
        if (steps[i].name === name) {
          steps[i] = fn(steps[i]);
          break;
        }
      }
      return { ...r, steps };
    });
  }

  function start(e) {
    e.preventDefault();
    if (!topic.trim() || running) return;
    stop();
    setRun(initialRun());
    setRunning(true);

    const es = new EventSource(`/api/run?topic=${encodeURIComponent(topic.trim())}`);
    sourceRef.current = es;
    const on = (type, fn) => es.addEventListener(type, (ev) => fn(JSON.parse(ev.data)));

    on("step", ({ step, status, revision }) => {
      if (status === "running") {
        setRun((r) => ({
          ...r,
          steps: [...r.steps, { id: r.steps.length, name: step, status, revision, queries: [], searches: {}, text: "" }],
        }));
      } else {
        patchStep(step, (s) => ({ ...s, status, waiting: null }));
      }
    });
    on("waiting", ({ step, seconds }) => patchStep(step, (s) => ({ ...s, waiting: seconds })));
    on("plan", ({ text }) => patchStep("planner", (s) => ({ ...s, text })));
    on("queries", ({ step, queries }) => patchStep(step, (s) => ({ ...s, queries })));
    on("search", ({ step, question, status, results = [], error = null }) =>
      patchStep(step, (s) => ({ ...s, searches: { ...s.searches, [question]: { status, results, error } } })));
    on("token", ({ text }) => patchStep("generate", (s) => ({ ...s, text: s.text + text, waiting: null })));
    on("draft", ({ text }) => patchStep("generate", (s) => ({ ...s, text })));
    on("critique", ({ text }) => patchStep("reflect", (s) => ({ ...s, text })));
    on("done", (final) => {
      setRun((r) => ({ ...r, final }));
      stop();
    });
    es.addEventListener("error", (ev) => {
      const message = ev.data ? JSON.parse(ev.data).message : "Connection lost";
      setRun((r) => ({ ...r, error: message }));
      stop();
    });
  }

  return (
    <main className="app">
      <header>
        <h1>Essay agent, live</h1>
        <p className="sub">
          A LangGraph.js agent that plans, researches, drafts, reviews its own work, researches again and revises.
          Every step streams as it happens.
        </p>
      </header>

      <form onSubmit={start} className="topic">
        <input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="What should the essay be about?"
          disabled={running}
        />
        {running ? (
          <button type="button" onClick={stop} className="secondary">Stop</button>
        ) : (
          <button type="submit">Run</button>
        )}
      </form>

      {run.error && <div className="error">{run.error}</div>}

      <ol className="timeline">
        {run.steps.map((s) => (
          <StepCard key={s.id} step={s} label={LABELS[s.name] ?? s.name} />
        ))}
      </ol>

      {run.final && (
        <section className="final">
          <h2>Final essay <span className="state">after {run.final.revisions} drafts</span></h2>
          <pre className="draft">{run.final.draft}</pre>
        </section>
      )}
    </main>
  );
}
