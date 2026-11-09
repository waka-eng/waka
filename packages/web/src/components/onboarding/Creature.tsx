/** The three glyphs the bar answers with, drawn as the frames draw them. */
export function Glyph({ kind, size = 20 }: { kind: "write" | "photo" | "voice" | "close" | "down"; size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={kind === "close" ? 1.8 : 1.6} aria-hidden="true" focusable="false">
      {kind === "write" ? <path d="M4 6h16M4 12h16M4 18h10" /> : null}
      {kind === "photo" ? <><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="M21 16l-5-5-8 8" /></> : null}
      {kind === "voice" ? <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></> : null}
      {kind === "close" ? <path d="M6 6l12 12M18 6L6 18" /> : null}
      {kind === "down" ? <path d="M12 5v14M6 13l6 6 6-6" /> : null}
    </svg>
  );
}

/** Progress as dots — states render, numerals never. */
export function Dots({ count, on, className = "" }: { count: number; on: number; className?: string }): JSX.Element {
  return (
    <span className={`onb-dots ${className}`.trim()} aria-hidden="true">
      {Array.from({ length: count }, (_, at) => (
        <span key={at} className={`onb-dot${at < on ? " onb-dot--on" : ""}`} />
      ))}
    </span>
  );
}
