/**
 * Web app entry point.
 *
 * Mounts React, boots the AuthProvider, and configures the React Router
 * route table that ships in the SST StaticSite bundle.
 *
 * Routes
 * ------
 *   /login   → public. Hosts the signup + login forms. Authenticated users
 *              that wander here are nudged onward via the success-path
 *              logic inside <LoginPage />, but the route itself stays
 *              reachable so users can sign out and back in.
 *
 *   /        → protected. Wrapped in <RequireAuth> so anonymous visitors
 *              are redirected to /login (with the attempted path captured
 *              in `location.state.from` for post-auth round-tripping).
 *
 *   *        → catch-all. Anything else is treated as a typo'd protected
 *              URL — the guard handles the redirect for unauthenticated
 *              users, and authenticated users get sent to "/" so the app
 *              stays self-healing instead of leaving 404 dead-ends.
 *
 * Pulls in the global stylesheet that defines the WAKA color tokens and
 * the shared page layout primitives.
 */

import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { RequireAuth } from "./components/RequireAuth";
import { SurfaceBoundary } from "./components/SurfaceBoundary";
import { AuthProvider } from "./lib/auth-context";
import { installPreloadRecovery } from "./lib/preload-recovery";
import LoginPage, { ResetPage } from "./pages/Login";
import OnboardingPage from "./pages/Onboarding";
import ProfilePage from "./pages/Profile";
import PublicProfilePage from "./pages/PublicProfile";
// FIRST, ALWAYS: declares the layer order every other stylesheet relies on.
// A @layer statement must precede the rules it orders, so this import cannot
// move without silently restoring bundle-order precedence.
import "./styles/layers.css";
import "./styles/global.css";
// Loaded after global.css and deliberately wins. See the header of that file
// for what it supersedes and why it is separable rather than merged.
import "./styles/system.css";
// `surface.css` was imported here, before chrome.css, because chrome.css
// declared itself "the final word over surface.css". Both the stylesheet and
// the screens it dressed were deleted on 2026-08-25 — see the note beside the
// routes below. chrome.css stays: it dresses `/login` and `/profile`, which
// are not flat screens in the sense that was retired. There is no memory to
// stand in before you are authenticated.
import "./styles/chrome.css";

/*
  THE WORLD IS HOME.

  It is canvas-heavy and carries its own stylesheet, so it splits out of the
  main bundle: the login screen and the public profile must not pay for a
  renderer they never start. Everything it draws is the same three layers the
  rest of the app is built on — captures in the field, patterns in the sky,
  the one artifact in between — read through `lib/data`.

  THERE ARE NO LIST SURFACES ANY MORE. This comment used to end "`/inspirations`
  and `/signals` remain addressable", and on 2026-08-26 that stopped being
  true: the flat screens were deleted and all eleven of their routes now
  redirect here. A comment that names an address which answers with a redirect
  is worse than no comment — it is a map of a building that has been pulled
  down, and the next person reads it as the current shape of the product.
*/
const HomePage = lazy(() => import("./pages/Home"));

/**
 * THE WORLD CAN BE LOOKED AT WITHOUT A SESSION, IN DEV ONLY.
 *
 * Every wall-specific behaviour in this product — a room's ground, the
 * per-member hues, the legend, pixelated agent memories, the machine hand,
 * the crossing quantization — was unreachable without signing in, so it could
 * only ever be checked by the person holding the password. Several of them
 * shipped broken because of exactly that.
 *
 * In dev the guard steps aside and the world renders its fixture, which now
 * describes all four rooms. `import.meta.env.DEV` is compiled out of a
 * production build entirely, so this cannot open a real deployment: there,
 * RequireAuth is the only path and a signed-out visitor still gets the door.
 */
function ProtectedHome() {
  /* The boundary sits OUTSIDE the Suspense on purpose. `fallback` answers
     "not yet"; only a boundary answers "never", and until one existed a
     rejected lazy import left `fallback={null}` on screen permanently — the
     black rectangle of 2026-08-22. Loading forever and failing instantly
     rendered identically, and the product chose the silent one. */
  if (import.meta.env.DEV) {
    return (
      <SurfaceBoundary surface="the world">
        <Suspense fallback={null}>
          <HomePage />
        </Suspense>
      </SurfaceBoundary>
    );
  }
  return (
    <RequireAuth>
      {/* No spinner: the layout's own first frame IS its loading state, and a
          flash of chrome before it would be the half-appearance the page
          forbids everywhere inside itself. That stays true — it is the
          *failure* case, not the loading case, that the boundary answers. */}
      <SurfaceBoundary surface="the world">
        <Suspense fallback={null}>
          <HomePage />
        </Suspense>
      </SurfaceBoundary>
    </RequireAuth>
  );
}


/* Before React mounts, so a stylesheet that never arrives cannot cost the
   screen that needed it. See lib/preload-recovery.ts for why this is narrow
   rather than a blanket ignore. */
installPreloadRecovery();

const root = document.getElementById("root");
if (!root) {
  throw new Error(
    "Could not find #root element to mount the React app. Check index.html.",
  );
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <BrowserRouter>
      {/*
        AuthProvider wraps the router so every route — public or private —
        can call useAuth() without prop drilling. It hydrates from
        localStorage synchronously and re-validates against /auth/me on mount.
      */}
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/reset" element={<ResetPage />} />
          <Route path="/:handle" element={<PublicProfilePage />} />
          <Route
            path="/onboarding"
            element={
              <RequireAuth>
                <OnboardingPage />
              </RequireAuth>
            }
          />
          {/* The account screen is checkable in dev for the same reason the
              layout is: its look could otherwise only be verified by whoever
              holds the password, which is how several things shipped here
              unobserved. `import.meta.env.DEV` is compiled out of production,
              so RequireAuth remains the only path in a real deployment. */}
          <Route
            path="/profile"
            element={
              import.meta.env.DEV ? (
                <ProfilePage />
              ) : (
                <RequireAuth>
                  <ProfilePage />
                </RequireAuth>
              )
            }
          />
          {/*
            The home route is protected. <RequireAuth> handles three cases:
              - still hydrating  → render a neutral loading state,
              - anonymous        → <Navigate> to /login with state.from set,
              - authenticated    → render the underlying page.
          */}
          {/* Home is the layout. */}
          <Route path="/" element={<ProtectedHome />} />
          {/* the same world, opened standing at a named wall — reload lands
              where you stood. Two segments, so the public-handle route
              (`/:handle`) never swallows it. */}
          <Route path="/w/:wall" element={<ProtectedHome />} />
          {/*
            THE ARCHIVE IS GONE. It was the same three layers in a list — the
            layout does everything it did, verified affordance by affordance
            rather than by call site, and every one of its verbs has an
            equivalent here: search is the seek line, "read this again" is
            reflecting, "take it down" is letting a pattern go, and both
            inline edits are the panel's own.

            Its four paths are deliberately NOT redirected to "/". They fall
            to the catch-all below, which routes through the guard so an
            anonymous visitor still lands on /login with their path kept. A
            bookmark to /inspirations now opens the layout, which is where
            those memories actually are.
          */}
          {/*
            THE FLAT SCREENS ARE GONE, AND THIS IS WHERE THEY WERE.

            Eleven routes stood here — `/capture`, `/inspirations`, `/signals`,
            `/principles`, `/top-of-mind`, `/rooms`, `/agents`, `/graph` — under
            a comment saying the world kept what was spatial and the flat
            screens kept what was a list. `everything-in-the-world.md` then
            called them a parking lot: a feature waited here until it had been
            designed into the world, and the routes stayed addressable
            throughout.

            The founder closed that on 2026-08-25 (`one-product-one-system.md`):
            the routes go. Every capability they held was built into the world
            first and each was seen working in a browser before anything was
            deleted — agent credentials, a pattern's own words, the five
            principle verbs, a room's board re-read, and the one edge the graph
            existed for. One was deliberately NOT migrated and says so there:
            a hard `deleteSignal` contradicts `fading never deletes`, and the
            world already answers a wrong pattern better, with a counted stance
            that can be undone.

            The catch-all below now takes these paths, so an old bookmark
            lands at `/` rather than nowhere.
          */}
          {/*
            Catch-all: route the visitor through "/" so the guard makes the
            decision in one place. Authenticated users land on home;
            anonymous users get bounced to /login with their attempted path
            preserved. Using replace avoids polluting browser history with
            unreachable URLs.
          */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
