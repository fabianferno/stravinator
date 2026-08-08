/**
 * HUD formatting. Pure and locale-independent on purpose: the render worker's
 * headless Chromium may not carry the same ICU data as a developer's machine,
 * and a video whose date reads differently in CI than in dev is a bug that only
 * shows up in the artifact. So every string here is assembled by hand.
 */

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** metres -> "14.2" (kilometres, one decimal) */
export function formatDistanceKm(metres: number): string {
  return (metres / 1000).toFixed(1);
}

/** seconds per km -> "4:52" */
export function formatPace(secPerKm: number): string {
  const total = Math.round(secPerKm);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** metres -> "685" */
export function formatElevation(metres: number): string {
  return String(Math.round(metres));
}

/** seconds -> "1:14:08" or "42:19" */
export function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * ISO 8601 -> "19 Jul 2026". Parsed textually rather than through `Date` so the
 * activity's own local date survives regardless of the renderer's timezone.
 */
export function formatDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const year = m[1];
  const month = MONTHS[Number(m[2]) - 1] ?? m[2];
  const day = String(Number(m[3]));
  return `${day} ${month} ${year}`;
}
