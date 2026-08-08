import "./Card.css";

export type RouteBedVariant = "landing" | "confirm";

/**
 * Decorative route line that sits at the foot of a hero card.
 * Placeholder art until the real polyline is available; purely presentational.
 */
export function RouteBed({ variant = "landing" }: { variant?: RouteBedVariant }) {
  return (
    <div className="route-bed" aria-hidden="true">
      <svg viewBox="0 0 350 190" fill="none" preserveAspectRatio="xMidYMax meet">
        {variant === "landing" ? (
          <>
            <path
              d="M40 178C10 132 96 118 74 78 56 44 128 34 152 8"
              stroke="rgba(255,255,255,.26)"
              strokeWidth="12"
              strokeLinecap="round"
            />
            <path
              d="M40 178C10 132 96 118 74 78 56 44 128 34 152 8"
              stroke="#fff"
              strokeWidth="3"
              strokeLinecap="round"
            />
            <circle cx="74" cy="78" r="6" fill="#C8F135" />
            <path
              d="M206 170c18-20 48-16 62-36"
              stroke="rgba(255,255,255,.22)"
              strokeWidth="2"
              strokeDasharray="3 6"
              strokeLinecap="round"
            />
          </>
        ) : (
          <>
            <path
              d="M52 180C22 140 104 126 84 88 66 54 150 44 176 14"
              stroke="rgba(255,255,255,.24)"
              strokeWidth="12"
              strokeLinecap="round"
            />
            <path
              d="M52 180C22 140 104 126 84 88 66 54 150 44 176 14"
              stroke="#fff"
              strokeWidth="3"
              strokeLinecap="round"
            />
            <circle cx="52" cy="180" r="6" fill="#fff" />
            <circle cx="176" cy="14" r="6" fill="#C8F135" />
          </>
        )}
      </svg>
    </div>
  );
}
