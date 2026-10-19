/**
 * <SurfaceBoundary> — the net under a lazily-loaded screen.
 *
 * WHAT IT EXISTS TO PREVENT, precisely: on 2026-08-22 a signed-in visitor
 * whose network could not reach `fonts.googleapis.com` OR `cdn.jsdelivr.net`
 * — either one alone was enough — got `/` as a black rectangle. No spinner,
 * no message, no retry. `#root` had zero children. The account was fine and
 * the session was fine; only the world, which is the product, was gone.
 *
 * ("and the flat surfaces still worked" stood here until 2026-08-26, when
 * they were deleted. `surface` in this file's name has never meant those
 * screens — it means a lazily-loaded one, and the world is the only one left.)
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
 * WHAT IT MAY NEVER BECOME. It must not RE-MOUNT on its own. A boundary that
 * silently re-mounts a failing chunk spins, and a chunk that fails because
 * the deploy moved will fail identically every time.
 *
 * ── AND YET IT RELOADS ONCE, WHICH IS NOT THAT ────────────────────────────
 *
 * That rule said "retry" and meant re-mount, and the distinction turned out
 * to be the whole thing. `retry` below has always reloaded the DOCUMENT, with
 * a note saying why: re-mounting asks for the same missing chunk from the
 * same stale `index.html` and fails identically, while going back to the
 * server is what actually changes the inputs. So this file already held that
 * reloading is the correct act for this failure. What it required was a
 * person to press a button to perform it.
 *
 * On 2026-10-10 that cost a working product. A dev server that had been up
 * for fifty-four days was still serving a dep hash from before the imports
 * changed; `react-dom.js?v=8027d2fd` 504'd, `Home.tsx` could not be
 * dynamically imported, and the founder got this screen instead of their
 * world. Vite's own recovery for exactly this is to force a reload — and
 * this boundary caught the rejection first and replaced a self-healing
 * refresh with a dead end. The same shape is a normal Tuesday in production,
 * and the header above names it: a visitor holding an `index.html` from
 * before the last deploy.
 *
 * So a module-load failure reloads the document ONCE, and the guard is what
 * keeps it honest: a `sessionStorage` key written before the reload and
 * cleared only on a successful mount, so the second failure in a row shows
 * the screen and the button. It cannot spin, because it cannot happen twice.
 * Anything that is not a module-load failure — a render error in the world's
 * own code — shows the screen immediately, since reloading would be a guess
 * about a bug that is going to happen again.
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
  /** The caught error's own words, shown small under the copy. */
  message: string;
}

/** The one-shot guard. Session-scoped, so a new tab gets its own attempt and
    nothing survives the browser being closed. */
const RELOADED = "waka:surface-reloaded";

/**
 * THE FAILURES A RELOAD CAN ACTUALLY FIX, and no others.
 *
 * Every one of these means "the file I asked for is not the file the server
 * has" — a stale document, a moved deploy, a re-optimised dependency. They
 * are the failures where the inputs change if you ask again. A `TypeError`
 * from inside the world's own render is not here on purpose: reloading would
 * reproduce it, and the person would watch the screen flicker and come back.
 */
function looksLikeAStaleModule(message: string): boolean {
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported|Failed to fetch/i.test(
    message,
  );
}

export class SurfaceBoundary extends Component<SurfaceBoundaryProps, SurfaceBoundaryState> {
  state: SurfaceBoundaryState = { failed: false, message: "" };

  componentDidMount(): void {
    /**
     * ONLY WHEN SOMETHING ACTUALLY RENDERED.
     *
     * `this.state.failed` is load-bearing and was missing for one commit,
     * which a test caught. React runs the lifecycle in this order:
     *
     *   render (throws) -> getDerivedStateFromError -> render the error
     *   screen -> componentDidMount -> componentDidCatch
     *
     * So the boundary DOES mount while showing the failure, before it is
     * told what the failure was — and clearing unconditionally wiped the
     * guard a moment before the next reload would read it. The protection
     * against spinning would have been removed by the very failure it exists
     * to bound.
     *
     * Reaching here with `failed` false means a screen is on the page, which
     * is the only honest evidence that a reload worked. That keeps this one
     * automatic reload per FAILURE rather than one per session.
     */
    if (this.state.failed) return;
    try {
      sessionStorage.removeItem(RELOADED);
    } catch {
      /* Private browsing refuses storage. Then the guard cannot be written
         either, so the branch below never fires and the button still works —
         the degradation is "no automatic reload", which is where this file
         started. */
    }
  }

  static getDerivedStateFromError(error: unknown): SurfaceBoundaryState {
    return {
      failed: true,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    /* ONCE, AND ONLY FOR A FAILURE A RELOAD CAN CHANGE. Written before the
       reload so the attempt is recorded even though nothing after this line
       survives. */
    if (looksLikeAStaleModule(error instanceof Error ? error.message : String(error))) {
      let already = true;
      try {
        already = sessionStorage.getItem(RELOADED) !== null;
        if (!already) sessionStorage.setItem(RELOADED, "1");
      } catch {
        already = true;
      }
      if (!already) {
        console.warn(`[waka] ${this.props.surface} could not load its code; reloading once`);
        window.location.reload();
        return;
      }
    }
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

  /**
   * THE SECOND WAY OUT: somewhere that is not here. A reload is the right
   * first answer and the wrong only answer — when the failure is in THIS
   * page (a bad link into a conversation, a day page that cannot draw), a
   * reload rebuilds the same failure, and the screen used to offer nothing
   * else. Home is a full navigation for the same reason the reload is: it
   * goes back to the server rather than re-mounting from a stale document.
   */
  private readonly goHome = (): void => {
    window.location.assign("/");
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
          {/* Not offered on a clean home itself, where it would be the reload
              again under a second name. `/?open=…` or `/#…` is NOT home: the
              query may be what breaks the page, and a clean `/` drops it. */}
          {window.location.pathname !== "/" || window.location.search !== "" || window.location.hash !== "" ? (
            <p className="login-footer">
              <button className="login-link" type="button" onClick={this.goHome}>
                {t(locale, "surfaceUnavailableHome")}
              </button>
            </p>
          ) : null}
          {/* THE ERROR'S OWN WORDS, small and untranslated. This screen's
              copy guesses at a cause ("usually a dropped connection...") and
              the guess was all a person could report — a founder hit a
              failure here and the only thing they could say about it was a
              screenshot of the guess. The message names the actual error, so
              a report carries the cause instead of the apology. */}
          {this.state.message !== "" ? (
            <p
              style={{
                marginTop: 14,
                fontSize: 11,
                opacity: 0.55,
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                wordBreak: "break-word",
              }}
            >
              {this.state.message}
            </p>
          ) : null}
        </section>
      </main>
    );
  }
}
