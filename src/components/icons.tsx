import type { ReactElement } from "react";

/** Line icons lifted verbatim from the approved design mockup. */

export function ChevronLeft(): ReactElement {
  return (
    <svg width="10" height="17" viewBox="0 0 10 17" fill="none" aria-hidden="true">
      <path
        d="M8 1.5 2 8.5l6 7"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ChevronRight({ dim = false }: { dim?: boolean }): ReactElement {
  return (
    <svg width="9" height="15" viewBox="0 0 9 15" fill="none" aria-hidden="true">
      <path
        d="M1.5 1.5 7 7.5l-5.5 6"
        stroke={dim ? "rgba(255,255,255,.55)" : "#fff"}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ClockIcon(): ReactElement {
  return (
    <svg width="17" height="17" viewBox="0 0 17 17" fill="none" aria-hidden="true">
      <circle cx="8.5" cy="8.5" r="6.4" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8.5 4.4v4.1l2.7 1.7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function MenuIcon(): ReactElement {
  return (
    <svg width="18" height="12" viewBox="0 0 18 12" fill="none" aria-hidden="true">
      <path
        d="M1 1.2h16M1 6h16M1 10.8h11"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function SearchIcon(): ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="5.2" stroke="currentColor" strokeWidth="1.5" />
      <path d="m11 11 3.2 3.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function InfoIcon(): ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6.4" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 5v3.4M8 11h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function PlusIcon(): ReactElement {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
      <path
        d="M6.5 1.5v10M1.5 6.5h10"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function ShareIcon(): ReactElement {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
      <path
        d="M7.5 10V2m0 0L4.6 4.9M7.5 2l2.9 2.9"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M2 10v2.5h11V10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function CheckIcon(): ReactElement {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path
        d="m2.5 6.2 2.5 2.4 4.5-5"
        stroke="#10130A"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const SQUIGGLES = [
  "M8 24c-4-6 9-5 5-11-3-5 8-3 8-7",
  "M22 24c4-7-10-6-6-12 3-4-6-4-7-8",
  "M6 20c6-2 5-11 11-9 4 1 3 8 7 6",
  "M7 8c3 6 11 2 9 8-1 4-8 3-9 8",
];

/** Deterministic route squiggle used as an activity thumbnail. */
export function RouteGlyph({ seed, muted = false }: { seed: number; muted?: boolean }): ReactElement {
  const d = SQUIGGLES[Math.abs(seed) % SQUIGGLES.length];
  return (
    <svg width="30" height="30" viewBox="0 0 30 30" fill="none" aria-hidden="true">
      <path
        d={d}
        stroke={muted ? "rgba(255,255,255,.22)" : "#fff"}
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
