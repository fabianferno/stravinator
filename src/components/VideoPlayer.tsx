import { Attribution } from "./Attribution";
import "./VideoPlayer.css";

export interface VideoPlayerStats {
  /** e.g. "Sat 2 Aug · Morning Run" */
  caption: string;
  distanceKm: string;
  pace: string;
  elevationGain: string;
}

export interface VideoPlayerProps {
  /** Signed URL from `Job.videoUrl`. When absent the poster/HUD preview shows. */
  videoUrl?: string | null;
  posterUrl?: string | null;
  stats: VideoPlayerStats;
}

/**
 * The result surface. When the encoded file exists it is played directly — the
 * HUD is burned into the video. Before that we show the same HUD over poster
 * terrain, so the athlete sees exactly what they are going to get.
 */
export function VideoPlayer({ videoUrl, posterUrl, stats }: VideoPlayerProps) {
  if (videoUrl) {
    return (
      <div className="player player-live">
        <video
          className="player-video"
          src={videoUrl}
          poster={posterUrl ?? undefined}
          controls
          playsInline
          preload="metadata"
        />
        <Attribution withMap className="player-credit" />
      </div>
    );
  }

  return (
    <div className="player">
      <div className="terrain" aria-hidden="true">
        <svg viewBox="0 0 350 452" fill="none" preserveAspectRatio="none">
          <rect width="350" height="452" fill="#0B120D" />
          <path d="M-10 352 60 334l80 12 76-30 74 12 80-24v170H-10z" fill="#26362B" />
          <path d="M-10 268 70 234l64 20 82-44 74 20 80-28v150H-10z" fill="#1F2D24" />
          <path d="M-10 190 86 158l86 20 84-38 114 22v116H-10z" fill="#19241E" />
          <path
            d="M150 430c-40-52 62-80 24-132-32-44-96-52-76-96 16-38 96-42 108-80"
            stroke="#C8F135"
            strokeWidth="5"
            strokeLinecap="round"
          />
          <circle cx="174" cy="298" r="8" fill="#fff" />
        </svg>
      </div>
      <div className="scrim" aria-hidden="true" />
      <div className="hud">
        <span className="hud-date">{stats.caption}</span>
        <div className="hud-stats">
          <span className="hud-stat">
            <span className="hud-n">{stats.distanceKm}</span>
            <span className="hud-l">km</span>
          </span>
          <span className="hud-stat">
            <span className="hud-n">{stats.pace}</span>
            <span className="hud-l">pace</span>
          </span>
          <span className="hud-stat">
            <span className="hud-n">{stats.elevationGain}</span>
            <span className="hud-l">m gain</span>
          </span>
        </div>
        <Attribution withMap />
      </div>
    </div>
  );
}
