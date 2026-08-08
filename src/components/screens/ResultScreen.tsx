import type { ActivityStats } from "@/lib/types";
import { AppBar } from "@/components/AppBar";
import { Button, ButtonLink, ButtonRow } from "@/components/Button";
import { VideoPlayer } from "@/components/VideoPlayer";
import { ShareIcon } from "@/components/icons";
import { formatDuration, formatPace, formatShortDate, km, metres } from "@/components/format";

export interface ResultScreenProps {
  /** Stats burned into the video, straight off `ActivityStats`. */
  stats: ActivityStats;
  /** `Job.videoUrl`. Null renders the poster preview instead of a player. */
  videoUrl: string | null;
  posterUrl?: string | null;
  /** Direct download target; defaults to `videoUrl`. */
  downloadHref?: string;
  /** Public share link for the finished flyover. */
  shareHref?: string;
  /** Where "Make another" goes. */
  makeAnotherHref?: string;
  backHref?: string;
  /** Real wall-clock render time, in seconds. */
  renderSeconds?: number;
  /** How long the share link stays live, in days. */
  linkLifetimeDays?: number;
}

export function ResultScreen({
  stats,
  videoUrl,
  posterUrl,
  downloadHref,
  shareHref,
  makeAnotherHref = "/activities",
  backHref = "/activities",
  renderSeconds,
  linkLifetimeDays = 30,
}: ResultScreenProps) {
  const download = downloadHref ?? videoUrl ?? undefined;

  return (
    <div className="shell">
      <AppBar
        title="That's your run"
        backHref={backHref}
        backLabel="Back to your runs"
        trailing={
          shareHref ? (
            <a className="circ sm" href={shareHref} aria-label="Share this flyover">
              <ShareIcon />
            </a>
          ) : undefined
        }
      />

      <div className="body">
        <VideoPlayer
          videoUrl={videoUrl}
          posterUrl={posterUrl}
          stats={{
            caption: `${formatShortDate(stats.date)} · ${stats.name}`,
            distanceKm: km(stats.distance),
            pace: formatPace(stats.paceSecPerKm),
            elevationGain: metres(stats.elevationGain),
          }}
        />
      </div>

      <div className="dock">
        {download ? (
          <ButtonLink href={download} variant="primary" download="stravinator-flyover.mp4">
            Save video
          </ButtonLink>
        ) : (
          <Button variant="primary" disabled>
            Save video
          </Button>
        )}
        <ButtonRow>
          <ButtonLink href={shareHref ?? "#"} variant="quiet" small external>
            Share link
          </ButtonLink>
          <ButtonLink href={makeAnotherHref} small>
            Make another
          </ButtonLink>
        </ButtonRow>
        <p className="dock-note">
          {renderSeconds !== undefined ? `Rendered in ${formatDuration(renderSeconds)} · ` : ""}
          link stays live {linkLifetimeDays} days
        </p>
      </div>
    </div>
  );
}
