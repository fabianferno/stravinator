import type { ReactNode } from "react";

/** Ambient glow + stacking context shared by every athlete-facing screen. */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="glow" aria-hidden="true" />
      {children}
    </>
  );
}
