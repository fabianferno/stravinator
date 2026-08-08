import type { ReactNode } from "react";
import "./ErrorBlock.css";

export interface ErrorBlockProps {
  /** Short uppercase classification, e.g. "Render failed". */
  kind: string;
  title: string;
  body: string;
  /**
   * `hot` paints the fire gradient and is reserved for the RECOVERABLE failure,
   * so the colour keeps its meaning. Everything else stays `neutral`.
   */
  tone?: "neutral" | "hot";
  action?: ReactNode;
}

export function ErrorBlock({ kind, title, body, tone = "neutral", action }: ErrorBlockProps) {
  return (
    <section className={tone === "hot" ? "err err-hot" : "err err-neutral"} role="group">
      <span className="err-kind">{kind}</span>
      <h2 className="err-title">{title}</h2>
      <p className="err-body">{body}</p>
      {action ? <div className="err-action">{action}</div> : null}
    </section>
  );
}
