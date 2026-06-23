/**
 * <AppShell /> — top-level layout chrome for the authenticated home page.
 *
 * Composes the prototype's outer markup in the same z-order:
 *
 *   <body>
 *     <BackgroundField />           ← .bg-field + .noise (z 0/1)
 *     <DropOverlay />               ← .drop-overlay (z 50)
 *     <HistoryPanel />              ← .history-overlay (z 200)
 *     <main class="wrap">
 *       <AppHeader />               ← <header>
 *       {children}                  ← <ClusterGrid /> + dialogs
 *     </main>
 *   </body>
 *
 * Why pull this together into one shell?
 *
 *   - The prototype's CSS expects every layer (bg-field, noise, drop-overlay,
 *     history-overlay, .wrap) to be siblings. Putting them behind a single
 *     component keeps that invariant honest — pages cannot accidentally re-
 *     order or omit a layer and still typecheck.
 *
 *   - Ownership of the cross-cutting state — header counter, capture trigger,
 *     and history drawer open/close — bubbles up exactly one level (to
 *     <HomePage />) instead of being scattered between several siblings.
 *
 * State that lives *in* the shell:
 *   - `historyOpen` — local, because nothing outside the shell needs to read
 *     it. Toggled by the meta-count click and the drawer's close button.
 *
 * State that is delegated *up* via props:
 *   - `count` of inspirations (the parent owns the data fetch).
 *   - `onCaptureClick` (the parent owns the capture modal).
 *   - `historyContent` (parent renders the list once data is wired).
 */
import type { ReactNode } from "react";

import { useEffect, useState } from "react";

import type { SupportedLocale } from "../../lib/locales";
import { AppHeader } from "./AppHeader";
import { BackgroundField } from "./BackgroundField";
import { DropOverlay } from "./DropOverlay";
import { HistoryPanel } from "./HistoryPanel";

export interface AppShellProps {
  /** Inspirations count to surface in the header meta counter. */
  count: number;
  /** Optional header title suffix; defaults to the inspiration-grid copy. */
  headerTagline?: string;
  /**
   * `true` while the parent is still hydrating the inspirations list.
   * The header swaps the meta counter to a placeholder so the page
   * never reads "0 INSPIRATIONS SAVED" before the fetch resolves.
   */
  loading?: boolean;
  /** Fires when the user clicks the header "Capture" pill. */
  onCaptureClick: () => void;
  /**
   * Optional pre-rendered history list. When provided, replaces the empty
   * state inside the drawer. Parent components own the data fetch so the
   * shell stays decoupled from API wiring.
   */
  historyContent?: ReactNode;
  /**
   * Optional detail view rendered inside the history drawer. Forwarded
   * verbatim to `<HistoryPanel>` so a parent can mount the wired
   * `<InspirationDetail>` when a saved row is selected.
   */
  historyDetail?: ReactNode;
  /** Main content slot — typically <ClusterGrid> + dialogs. */
  children?: ReactNode;
  /** Current UI locale for shared shell copy. */
  locale?: SupportedLocale;
}

export function AppShell({
  count,
  headerTagline,
  loading = false,
  onCaptureClick,
  historyContent,
  historyDetail,
  children,
  locale,
}: AppShellProps): JSX.Element {
  // Drawer open/close lives here because no sibling needs to read it. If a
  // future sub-AC needs the state externally (e.g. to suppress hotkeys when
  // the drawer is open), lift this into a context — but YAGNI for now.
  const [historyOpen, setHistoryOpen] = useState(false);

  // Auto-open the drawer whenever the parent mounts a detail view. This
  // covers the path where the user clicks a cluster tile on the home grid
  // (the parent flips the selected id, the detail is rendered, and we
  // surface the panel) without forcing the parent to manage the
  // open/close flag itself.
  useEffect(() => {
    if (historyDetail) setHistoryOpen(true);
  }, [historyDetail]);

  return (
    <>
      <BackgroundField />
      <DropOverlay />
      <HistoryPanel
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        detail={historyDetail}
      >
        {historyContent}
      </HistoryPanel>
      {/*
        `<main class="wrap">` is the prototype's content well: 1480px max
        width, padded for the header rhythm, sitting at z-index 2 above the
        background layers. The header lives inside the well so its bottom
        border aligns with the grid below.
      */}
      <main className="wrap">
        <AppHeader
          count={count}
          tagline={headerTagline}
          loading={loading}
          onCaptureClick={onCaptureClick}
          onMetaClick={() => setHistoryOpen(true)}
          locale={locale}
        />
        {children}
      </main>
    </>
  );
}

export default AppShell;
