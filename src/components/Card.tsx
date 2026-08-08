import type { CSSProperties, ReactNode } from "react";
import "./Card.css";

export type CardTone = "raised" | "magenta" | "blue";

export interface CardProps {
  tone?: CardTone;
  /** 386px minimum height, matching the hero cards in the approved design. */
  tall?: boolean;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}

export function Card({ tone = "raised", tall = false, className, style, children }: CardProps) {
  return (
    <div
      className={["card", `card-${tone}`, tall ? "card-tall" : "", className ?? ""]
        .filter(Boolean)
        .join(" ")}
      style={style}
    >
      {children}
    </div>
  );
}

export function CardTop({ children }: { children: ReactNode }) {
  return <div className="card-top">{children}</div>;
}

export function CardTitle({ children }: { children: ReactNode }) {
  return <span className="card-title">{children}</span>;
}

export function CardMeta({ children }: { children: ReactNode }) {
  return <span className="card-meta">{children}</span>;
}

/** Centred hero figure + unit caption. */
export function Readout({ children, flush = false }: { children: ReactNode; flush?: boolean }) {
  return <div className={flush ? "readout readout-flush" : "readout"}>{children}</div>;
}

export function ReadoutUnit({ children }: { children: ReactNode }) {
  return <span className="readout-unit">{children}</span>;
}

export interface StatTileProps {
  label: string;
  value: string;
  unit?: string;
  tone?: "raised" | "blue";
}

export function StatTile({ label, value, unit, tone = "raised" }: StatTileProps) {
  return (
    <div className={tone === "blue" ? "mini mini-blue" : "mini"}>
      <span className="mini-label">{label}</span>
      <span className="mini-value">
        <span className="mini-n">{value}</span>
        {unit ? <span className="mini-u">{unit}</span> : null}
      </span>
    </div>
  );
}

export function StatPair({ children }: { children: ReactNode }) {
  return <div className="duo">{children}</div>;
}
