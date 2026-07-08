import { useState } from "react";
import type { Severity } from "../types.js";

const SEVERITIES: Severity[] = ["issue", "suggestion", "question", "nit", "praise"];

export function ThreadComposer({
  onSubmit,
  onCancel,
}: {
  onSubmit: (input: { severity: Severity; title: string; body: string }) => Promise<void>;
  onCancel: () => void;
}) {
  const [severity, setSeverity] = useState<Severity>("issue");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = title.trim().length > 0 && !submitting;

  return (
    <form
      className="thread-composer"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!canSubmit) return;
        setSubmitting(true);
        await onSubmit({ severity, title: title.trim(), body });
        setSubmitting(false);
      }}
    >
      <div className="composer-row">
        <select value={severity} onChange={(e) => setSeverity(e.target.value as Severity)}>
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Thread title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
        />
      </div>
      <textarea placeholder="Comment (markdown)" value={body} onChange={(e) => setBody(e.target.value)} rows={3} />
      <div className="composer-actions">
        <button type="submit" disabled={!canSubmit}>
          Comment
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
