import { AppBar } from "@/components/AppBar";
import { Attribution } from "@/components/Attribution";
import {
  Card,
  CardTitle,
  CardTop,
  Readout,
  ReadoutUnit,
  StatPair,
  StatTile,
} from "@/components/Card";
import { DotMatrix } from "@/components/DotMatrix";
import { RouteBed } from "@/components/RouteBed";
import { ClockIcon, MenuIcon, PlusIcon } from "@/components/icons";
import { ConnectForm } from "./ConnectForm";

export interface LandingScreenProps {
  /** The athlete's most recent flyover. `null` for a brand-new visitor. */
  lastFlyover: {
    /** metres */
    distance: number;
  } | null;
  /** Lifetime/among-this-year counters shown in the tile pair. */
  runsFlown: number;
  /** metres */
  elevationClimbed: number;
  /** OAuth start route. */
  connectHref: string;
}

export function LandingScreen({
  lastFlyover,
  runsFlown,
  elevationClimbed,
  connectHref,
}: LandingScreenProps) {
  const distanceKm = lastFlyover ? (lastFlyover.distance / 1000).toFixed(1) : "0.0";

  return (
    <div className="shell">
      <AppBar
        title="Stravinator"
        leading={
          <span className="circ" aria-hidden="true">
            <ClockIcon />
          </span>
        }
        trailing={
          <span className="circ" aria-hidden="true">
            <MenuIcon />
          </span>
        }
      />

      <div className="body">
        <Card tone="magenta" tall>
          <CardTop>
            <CardTitle>{lastFlyover ? "Last flyover" : "Your first flyover"}</CardTitle>
            <span className="circ ghost" aria-hidden="true">
              <PlusIcon />
            </span>
          </CardTop>
          <Readout>
            <DotMatrix text={distanceKm} label={`${distanceKm} kilometres`} />
            <ReadoutUnit>Kilometres</ReadoutUnit>
          </Readout>
          <RouteBed variant="landing" />
        </Card>

        <StatPair>
          <StatTile label="Runs flown" value={String(runsFlown)} unit="this year" />
          <StatTile
            label="Climbed"
            value={Math.round(elevationClimbed).toLocaleString("en-GB")}
            unit="m"
            tone="blue"
          />
        </StatPair>
      </div>

      <ConnectForm connectHref={connectHref} />
      <div className="dock dock-footer">
        <Attribution note="Beta" className="attrib-note" />
      </div>
    </div>
  );
}
