/**
 * Visual-diff pair configuration.
 *
 * Each entry describes ONE matched (legacy ↔ react) screenshot pair:
 *   - `name`         : output file slug, e.g. "home-default"
 *   - `legacyPath`   : path appended to `--legacy-base-url` (default the
 *                      static server serving the original `index.html`)
 *   - `reactPath`    : path appended to `--react-base-url`  (default
 *                      `http://localhost:5173`)
 *   - `viewports`    : list of viewports to capture this pair at
 *   - `fullPage`     : when true, capture full scroll height (default true)
 *   - `waitForMs`    : delay after `domcontentloaded` for animations to
 *                      settle (default 600 ms — the legacy app has a
 *                      900 ms blob fade-in)
 *   - `legacyPrep`   : optional raw JS evaluated in the legacy page after
 *                      load (e.g. to dismiss a modal so it matches the
 *                      React equivalent)
 *   - `reactPrep`    : optional raw JS evaluated in the react page after
 *                      load
 *
 * Routes intentionally cover the *publicly reachable* surfaces — the
 * legacy index.html has no auth, and on the React side `/` now answers an
 * anonymous visitor with the landing page rather than redirecting to
 * `/login` (2026-08-28; the redirect it used to do is what "see AC 3" here
 * described). Somebody the door remembers is still sent to `/login` from
 * `/`, so the door keeps its own pair below. The authenticated board is captured
 * by passing `--session-cookie` to `capture.ts`, which threads the cookie
 * onto the React page before navigation; legacy has no equivalent so its
 * board is rendered directly from `index.html`.
 */

export type Viewport = {
  name: string;
  width: number;
  height: number;
  deviceScaleFactor?: number;
};

export type Pair = {
  name: string;
  legacyPath: string;
  reactPath: string;
  viewports: Viewport[];
  fullPage?: boolean;
  waitForMs?: number;
  legacyPrep?: string;
  reactPrep?: string;
};

// Standard viewport matrix. Desktop is the design target; tablet + mobile
// catch responsive regressions in the home grid (which falls back to a
// 2-column layout under 760 px — see index.html line 79).
export const VIEWPORTS: Record<string, Viewport> = {
  desktop: { name: "desktop", width: 1440, height: 900, deviceScaleFactor: 1 },
  tablet:  { name: "tablet",  width: 768,  height: 1024, deviceScaleFactor: 1 },
  mobile:  { name: "mobile",  width: 390,  height: 844, deviceScaleFactor: 2 },
};

export const DEFAULT_PAIRS: Pair[] = [
  {
    // Default landing state. Legacy: cluster grid. React: the door, which
    // is what `/` answered with for anonymous visitors until the landing
    // page existed. Addressed directly now rather than reached by redirect,
    // so this pair keeps measuring the same screen it always did. This is
    // the visual baseline that EVERY commit should preserve.
    name: "landing",
    legacyPath: "/",
    reactPath: "/login",
    viewports: [VIEWPORTS.desktop, VIEWPORTS.tablet, VIEWPORTS.mobile],
    fullPage: true,
    waitForMs: 700,
  },
  {
    // THE PAGE THAT SAYS WHAT WAKA IS. It has no legacy counterpart — the
    // original app never explained itself to a stranger — so it is paired
    // against the legacy front page, and the diff for this row is expected
    // to be total. It is here to be CAPTURED on every run rather than to be
    // matched: it is the first screen a new person sees, and a landing page
    // nobody looks at is how one rots.
    //
    // `?landing` because the dev server steps the route guard aside, so `/`
    // there is always the world (see `ProtectedHome` in `main.tsx`).
    name: "landing-page",
    legacyPath: "/",
    reactPath: "/?landing",
    viewports: [VIEWPORTS.desktop, VIEWPORTS.tablet, VIEWPORTS.mobile],
    fullPage: true,
    waitForMs: 900,
  },
  {
    // Authenticated home grid. Only meaningful when the React app is
    // primed with a real session cookie via `--session-cookie`; without
    // one the React side will simply screenshot /login again, which is
    // still useful as a contradiction signal in the diff report.
    name: "home-grid",
    legacyPath: "/",
    reactPath: "/",
    viewports: [VIEWPORTS.desktop],
    fullPage: true,
    waitForMs: 700,
  },
];
