import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronLeft } from "./icons";

export interface AppBarProps {
  title: string;
  /** Renders a back affordance pointing at this route. */
  backHref?: string;
  backLabel?: string;
  /** Optional leading slot; ignored when `backHref` is set. */
  leading?: ReactNode;
  /** Optional trailing slot. A spacer is rendered when absent, to keep the title centred. */
  trailing?: ReactNode;
}

export function AppBar({ title, backHref, backLabel = "Back", leading, trailing }: AppBarProps) {
  return (
    <header className="appbar">
      {backHref ? (
        <Link className="circ" href={backHref} aria-label={backLabel}>
          <ChevronLeft />
        </Link>
      ) : (
        (leading ?? <span className="circ spacer" aria-hidden="true" />)
      )}
      <h1>{title}</h1>
      {trailing ?? <span className="circ sm spacer" aria-hidden="true" />}
    </header>
  );
}
