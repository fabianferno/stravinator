import { AppBar } from "@/components/AppBar";
import { Attribution } from "@/components/Attribution";
import { ButtonLink } from "@/components/Button";
import { ErrorBlock } from "@/components/ErrorBlock";

export type FailureKind = "no-gps" | "render-failed" | "session-expired";

export interface FailureAction {
  label: string;
  href: string;
}

export interface FailureProps {
  kind: FailureKind;
  /** Overrides the default body copy — use the real `Job.error` when there is one. */
  detail?: string;
  /** Overrides the default recovery action target. */
  action?: FailureAction;
  /** Named so "Reconnect" copy can point back at the right activity. */
  activityName?: string;
}

export interface ErrorScreenProps extends FailureProps {
  backHref?: string;
  title?: string;
}

interface Copy {
  kind: string;
  title: string;
  body: (activityName?: string) => string;
  tone: "neutral" | "hot";
  action: FailureAction;
  actionVariant: "quiet" | "primary";
}

/** Copy table. `hot` is reserved for the one failure the athlete can retry. */
export const FAILURE_COPY: Record<FailureKind, Copy> = {
  "no-gps": {
    kind: "No route data",
    title: "This run has no GPS track.",
    body: () =>
      "Treadmill and indoor activities record distance but not position, so there's no route to fly. Pick an outdoor run instead.",
    tone: "neutral",
    action: { label: "Back to your runs", href: "/activities" },
    actionVariant: "quiet",
  },
  "render-failed": {
    kind: "Render failed",
    title: "We couldn't finish this flyover.",
    body: () =>
      "The map tiles stopped responding partway through, so we stopped rather than hand you a video with holes in it. Try again — if it fails twice, tell us.",
    tone: "hot",
    action: { label: "Try again", href: "/activities" },
    actionVariant: "quiet",
  },
  "session-expired": {
    kind: "Session expired",
    title: "Strava signed you out.",
    body: (activityName) =>
      `Connections expire every six hours. Reconnect and we'll take you straight back to ${
        activityName ?? "where you left off"
      }.`,
    tone: "neutral",
    action: { label: "Reconnect Strava", href: "/api/strava/authorize" },
    actionVariant: "primary",
  },
};

/** One failure, rendered as a card. Reusable inside other screens. */
export function Failure({ kind, detail, action, activityName }: FailureProps) {
  const copy = FAILURE_COPY[kind];
  const act = action ?? copy.action;
  return (
    <ErrorBlock
      kind={copy.kind}
      title={copy.title}
      body={detail ?? copy.body(activityName)}
      tone={copy.tone}
      action={
        <ButtonLink href={act.href} variant={copy.actionVariant} small>
          {act.label}
        </ButtonLink>
      }
    />
  );
}

export function ErrorScreen({
  kind,
  detail,
  action,
  activityName,
  backHref = "/activities",
  title = "Something stopped",
}: ErrorScreenProps) {
  return (
    <div className="shell">
      <AppBar title={title} backHref={backHref} backLabel="Back to your runs" />
      <div className="body">
        <Failure kind={kind} detail={detail} action={action} activityName={activityName} />
      </div>
      <div className="dock dock-footer">
        <Attribution className="attrib-note" />
      </div>
    </div>
  );
}

/** Gallery view: all three failure states, matching screen 06 of the design. */
export function ErrorGalleryScreen({ activityName }: { activityName?: string }) {
  return (
    <div className="shell">
      <AppBar title="Something stopped" backHref="/activities" backLabel="Back to your runs" />
      <div className="body">
        <Failure kind="no-gps" />
        <Failure kind="render-failed" />
        <Failure kind="session-expired" activityName={activityName} />
      </div>
      <div className="dock dock-footer">
        <Attribution className="attrib-note" />
      </div>
    </div>
  );
}
