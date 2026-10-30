const STATE_LABEL = { running: "in progress", done: "done" };

export default function StepCard({ step, label }) {
  const isResearch = step.name.startsWith("research");
  const isText = ["planner", "generate", "reflect"].includes(step.name);

  return (
    <li className={`step ${step.status}`}>
      <span className="dot" aria-hidden="true" />
      <div className="body">
        <div className="head">
          <strong>
            {label}
            {step.revision ? ` (draft ${step.revision})` : ""}
          </strong>
          <span className="state">{STATE_LABEL[step.status] ?? step.status}</span>
        </div>
        {step.waiting && step.status === "running" && (
          <p className="hint">Rate limited by the LLM provider, retrying in {step.waiting}s</p>
        )}

        {isResearch && step.queries.length > 0 && (
          <ul className="searches">
            {step.queries.map((q) => {
              const sr = step.searches[q];
              return (
                <li key={q} className={sr?.status ?? "pending"}>
                  <div className="q">{q}</div>
                  {sr?.error && <div className="hint">Search failed: {sr.error}</div>}
                  {sr?.results?.length > 0 && (
                    <ul className="sources">
                      {sr.results.map((r) => (
                        <li key={r.url}>
                          <a href={r.url} target="_blank" rel="noreferrer">{r.title || r.url}</a>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {isText && step.text && (
          <pre className="draft">
            {step.text}
            {step.status === "running" && <span className="cursor" />}
          </pre>
        )}
      </div>
    </li>
  );
}
