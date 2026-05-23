/**
 * <AppHeader /> — top-of-page header strip.
 *
 * Mirrors the prototype's:
 *
 *   <header>
 *     <h1>WAKA <em>— your inspirations</em></h1>
 *     <div class="header-right">
 *       <button class="capture-trigger" id="captureTrigger">…</button>
 *       <div class="meta" id="metaCount">50 inspirations saved</div>
 *     </div>
 *   </header>
 *
 * Layout responsibilities only:
 *   - h1 + italicized "— your inspirations" tagline (Instrument Serif, the
 *     project's display face).
 *   - "Capture" pill button (plus glyph + label, label hides on narrow
 *     viewports per the prototype's media query).
 *   - "N inspirations saved" meta count, clickable so the parent can open
 *     the history drawer.
 *
 * Behavior is delegated to the parent through `onCaptureClick` and
 * `onMetaClick` so the header has no opinions about state. Keeping it
 * stateless makes it trivial to re-use in future surfaces (e.g. an empty
 * state screen) and trivial to test.
 *
 * The `count` prop accepts a number rather than a pre-formatted string so
 * the "1 inspiration / N inspirations" pluralization stays a single source
 * of truth here.
 */

import { useState } from "react";

import { useOptionalAuth } from "../../lib/auth-context";
import { DEFAULT_LOCALE, supportedLocales, t } from "../../lib/locales";
import type { SupportedLocale } from "../../lib/locales";

export interface AppHeaderProps {
  /** Total saved inspirations to surface in the meta counter. */
  count: number;
  /** Italicized title suffix after "WAKA". */
  tagline?: string;
  /**
   * `true` while the inspirations list is still being hydrated. Hides
   * the "0 INSPIRATIONS SAVED" copy that would otherwise lie to the
   * user before the fetch resolves; renders a placeholder ellipsis
   * instead.
   */
  loading?: boolean;
  /** Fires when the user clicks the "Capture" pill button. */
  onCaptureClick: () => void;
  /** Fires when the user clicks the meta counter (opens history drawer). */
  onMetaClick: () => void;
}

export function AppHeader({
  count,
  tagline = "your inspirations",
  loading = false,
  onCaptureClick,
  onMetaClick,
}: AppHeaderProps): JSX.Element {
  const auth = useOptionalAuth();
  const user = auth?.user ?? null;
  const [localeSaving, setLocaleSaving] = useState(false);
  const locale = user?.preferredLocale ?? DEFAULT_LOCALE;
  const localizedTagline = tagline === "your inspirations" ? t(locale, "tagline") : tagline;
  // Single-source pluralization. Matches the prototype's copy verbatim
  // ("50 inspirations saved") while staying honest at count=1. While
  // `loading`, swap to a placeholder so the page doesn't read
  // "0 inspirations saved" before the server has answered.
  const metaLabel = loading
    ? t(locale, "loadingInspirations")
    : locale === "ko-KR"
      ? `${count}${t(locale, count === 1 ? "inspirationSaved" : "inspirationsSaved")}`
      : `${count} ${t(locale, count === 1 ? "inspirationSaved" : "inspirationsSaved")}`;

  const handleLocaleChange = async (nextLocale: SupportedLocale): Promise<void> => {
    if (!user || nextLocale === user.preferredLocale) return;
    setLocaleSaving(true);
    try {
      await auth?.updatePreferredLocale(nextLocale);
    } finally {
      setLocaleSaving(false);
    }
  };

  return (
    <header>
      <h1>
        WAKA <em>— {localizedTagline}</em>
      </h1>
      <div className="header-right">
        <button
          type="button"
          className="capture-trigger"
          id="captureTrigger"
          aria-label={t(locale, "captureAria")}
          onClick={onCaptureClick}
        >
          {/*
            Plus glyph SVG copied verbatim from the prototype. Inline so the
            stroke color inherits from `currentColor`, matching the muted →
            ink hover transition declared in CSS.
          */}
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          <span className="capture-trigger-label">{t(locale, "capture")}</span>
        </button>
        {user ? (
          <label className="locale-setting">
            <span>{t(locale, "languageLabel")}</span>
            <select
              value={locale}
              aria-label={t(locale, "languageLabel")}
              disabled={localeSaving}
              onChange={(event) => {
                void handleLocaleChange(event.currentTarget.value as SupportedLocale);
              }}
            >
              {supportedLocales.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.nativeLabel}
                </option>
              ))}
            </select>
            {localeSaving ? <span className="sr-only">{t(locale, "languageSaving")}</span> : null}
          </label>
        ) : null}
        <div
          className="meta"
          id="metaCount"
          role="button"
          tabIndex={0}
          onClick={onMetaClick}
          onKeyDown={(event) => {
            // Keyboard parity with the visual click affordance — Enter or
            // Space opens the history drawer, matching the implicit
            // semantics of `role="button"`.
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onMetaClick();
            }
          }}
        >
          {metaLabel}
        </div>
      </div>
    </header>
  );
}

export default AppHeader;
