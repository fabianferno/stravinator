import "./Attribution.css";

export interface AttributionProps {
  /** Include the map credits — required anywhere map imagery is shown. */
  withMap?: boolean;
  /** Extra trailing note, e.g. "Invite-only beta". */
  note?: string;
  className?: string;
}

/**
 * Strava attribution. Must appear on every surface that displays Strava data.
 * Mirrors ATTRIBUTION in src/lib/types.ts.
 */
export function Attribution({ withMap = false, note, className }: AttributionProps) {
  const parts = ["Powered by Strava"];
  if (withMap) parts.push("© Cesium ion", "© Microsoft Bing", "© Maxar");
  if (note) parts.push(note);
  return <span className={["attrib", className ?? ""].filter(Boolean).join(" ")}>{parts.join(" · ")}</span>;
}
