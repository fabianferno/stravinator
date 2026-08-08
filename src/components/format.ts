import type { IneligibilityReason } from "@/lib/types";

/** Presentation helpers. Pure formatting only — no data fetching lives here. */

export function km(metres: number): string {
  return (metres / 1000).toFixed(1);
}

export function metres(m: number): string {
  return Math.round(m).toLocaleString("en-GB");
}

export function paceSecPerKm(distanceMetres: number, movingTimeSec: number): number {
  if (distanceMetres <= 0) return 0;
  return movingTimeSec / (distanceMetres / 1000);
}

/** 292 → "4:52" */
export function formatPace(secPerKm: number): string {
  if (!Number.isFinite(secPerKm) || secPerKm <= 0) return "—";
  const total = Math.round(secPerKm);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** 112 → "1 min 52 s" */
export function formatDuration(sec: number): string {
  const total = Math.round(sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m === 0) return `${s} s`;
  return `${m} min ${s} s`;
}

/** ISO date → "Sat 2 Aug" */
export function formatShortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(d);
}

/** The single source of truth for ineligibility copy. */
export const INELIGIBLE_COPY: Record<IneligibilityReason, string> = {
  "no-gps": "No GPS data — indoor activity",
  "too-short": "Too short to render",
  "no-stream": "No GPS data recorded",
};

export function ineligibleReasonText(reason: IneligibilityReason): string {
  return INELIGIBLE_COPY[reason];
}
