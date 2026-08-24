/**
 * <SurfaceBoundary> — the net under a lazily-loaded screen.
 *
 * WHAT IT EXISTS TO PREVENT, precisely: on 2026-08-22 a signed-in visitor
 * whose network could not reach `fonts.googleapis.com` OR `cdn.jsdelivr.net`
 * — either one alone was enough — got `/` as a black rectangle. No spinner,
 * no message, no retry. `#root` had zero children. The account was fine, the
 * session was fine, and the flat surfaces still worked; only the world, which
 * is the product, was gone.
 *
 * The mechanism is worth stating because the fix looks disproportionate
 * otherwise. `HomePage` is `lazy()`, so React suspends on it. `ProtectedHome`
 * gave that suspension `fallback={null}` — correct, and deliberate: the
 * layout's own first frame IS its loading state, and a spinner before it
 * would be the half-appearance the page forbids everywhere inside itself.
 * But a `fallback` answers "not yet". It does not answer "never": when the
 * lazy import REJECTS, React has nothing to render and no boundary to hand
 * the error to, so `null` becomes permanent. Loading forever and failing
 * instantly look identical from the outside, and the product picked the one
 * that says nothing.
 *
 * So this is not a font fix. Any rejection of any lazy chunk produced that
 * same black rectangle, and the likeliest one in production is not a CDN at
 * all — it is a visitor holding an `index.html` from before the last deploy,
 * asking for a hashed chunk that no longer exists. That is a normal Tuesday,
 * and it looked like the app was dead.
 *
 * WHY IT IS A CLASS. React has exactly one way to catch a render-phase error
 * — `getDerivedStateFromError` / `componentDidCatch` — and both are class
 * lifecycle methods. There is no hook equivalent and there is not going to
 * be. This is the one place in `packages/web` that has to be a class.
 *
 * WHY IT BORROWS THE FLAT SCREENS' CHROME. `.login-shell` / `.login-card`
 * live in `chrome.css`, which is in the entry bundle and has therefore
 * already loaded by the time anything here can render. Reaching for the
 * world's own stylesheet would be reaching for the file that may be exactly
 * what failed, and the error state would then have no styling of its own —
 * a broken page apologising in unstyled stacked text.
 *
 * WHAT IT MAY NEVER BECOME. It must not retry on its own. A boundary that
 * silently re-mounts a failing chunk spins, and a chunk that fails because
 * the deploy moved will fail identically every time. The person presses the
 * button, or nothing happens.
 */

import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

import { readStoredLocale, t } from "../lib/locales";

export interface SurfaceBoundaryProps {
  children: ReactNode;
  /** Names the screen in the console line, so a report says which one died. */
  surface: string;
}

interface SurfaceBoundaryState {
  failed: boolean;
}

export class SurfaceBoundary extends Component<SurfaceBoundaryProps, SurfaceBoundaryState> {
  state: SurfaceBoundaryState = { failed: false };

  static getDerivedStateFromError(): SurfaceBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    /* The console is the only reporting channel this app has. Keep the
       surface name in the line: "the world failed" and "the account screen
       failed" arrive here as the same stack otherwise. */
    console.error(`[waka] ${this.props.surface} failed to render`, error, info.componentStack);
  }

  /**
   * A full reload rather than a re-mount, because the failure this is built
   * for is usually the document itself being stale: re-mounting would ask
   * for the same missing chunk from the same cached `index.html` and fail
   * the same way. Going back to the server is what actually changes the
   * inputs.
   */
  private readonly retry = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;

    const locale = readStoredLocale();
    return (
      <main className="login-shell">
        <section className="login-card" aria-labelledby="surface-error-title">
          <h1 id="surface-error-title" className="login-title">
            {t(locale, "surfaceUnavailableTitle")}
          </h1>
          {/* role=alert so the failure is spoken, not just drawn. The world
              has no live regions at all, which is its own finding; this one
              screen is where silence is least affordable. */}
          <p className="login-subtitle" role="alert">
            {t(locale, "surfaceUnavailableBody")}
          </p>
          <button className="btn-primary" type="button" onClick={this.retry}>
            {t(locale, "surfaceUnavailableRetry")}
          </button>
        </section>
      </main>
    );
  }
}
