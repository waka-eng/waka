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
import { AuthProvider } from "./lib/auth-context";
import SurfacePage from "./pages/Surface";
import LoginPage from "./pages/Login";
import OnboardingPage from "./pages/Onboarding";
import ProfilePage from "./pages/Profile";
import PublicProfilePage from "./pages/PublicProfile";
import "./styles/global.css";

/*
  The admin pages load on demand.

  MeaningGraph pulls in reactflow and d3-force, which were 73% of a single
  500kB bundle — shipped to every visitor of a route none of them can open,
  since all three are behind `requireAuth requireAdmin`. Splitting them out
  takes the surface's own chunk from 156kB to 40kB gzip and lifts reactflow's
  stylesheet out of the render-blocking CSS.

  These are the only lazy routes on purpose. Everything else here is on the
  path a signed-in person actually walks, where a second request would cost
  more than the bytes it saved.
*/
const AdminHomePage = lazy(() => import("./pages/AdminHome"));
const AdminWowStatusPage = lazy(() => import("./pages/AdminWowStatus"));
const MeaningGraphPage = lazy(() => import("./pages/MeaningGraph"));
// Loaded after global.css and deliberately wins. See the header of that file
// for what it supersedes and why it is separable rather than merged.
import "./styles/system.css";
import "./styles/surface.css";
/* The orbit board's skin (goal/two-modes) — separate from surface.css on
   purpose: the quiet-paper language is deliberately not the current wall's,
   and the old wall stays intact until it is retired on purpose. */
import "./styles/orbit.css";
import "./styles/ambition.css";

/* These routes are internal and admin-gated, so the wait says what it is
   rather than pretending to be the page that is arriving. */
function AdminLoading() {
  return <div style={{ padding: "2rem", opacity: 0.6 }}>Loading…</div>;
}

function ProtectedSurface() {
  return (
    <RequireAuth>
      <SurfacePage />
    </RequireAuth>
  );
}

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
          <Route path="/:handle" element={<PublicProfilePage />} />
          <Route
            path="/onboarding"
            element={
              <RequireAuth>
                <OnboardingPage />
              </RequireAuth>
            }
          />
          <Route
            path="/profile"
            element={
              <RequireAuth>
                <ProfilePage />
              </RequireAuth>
            }
          />
          {/*
            The home route is protected. <RequireAuth> handles three cases:
              - still hydrating  → render a neutral loading state,
              - anonymous        → <Navigate> to /login with state.from set,
              - authenticated    → render the underlying page.
          */}
          <Route element={<ProtectedSurface />}>
            <Route path="/" />
            <Route path="/capture" />
            {/* Solo like capture: sitting with today's saves belongs to the
                person, so the path carries no room. Declared here or the
                public-profile route reads "sit" as a handle. */}
            <Route path="/sit" />
            <Route path="/inspirations" />
            <Route path="/inspirations/:signalId" />
            <Route path="/readings/:readingId" />
            <Route path="/rooms/:roomId" />
            {/*
              Legacy. Capture is no longer nested under a room — a save belongs
              to the person who made it, not to the wall they were looking at —
              but this stays routable so a tab or bookmark from before the
              change still opens the composer instead of dying.
            */}
            <Route path="/rooms/:roomId/capture" />
            <Route path="/rooms/:roomId/inspirations" />
            <Route path="/rooms/:roomId/inspirations/:signalId" />
            <Route path="/rooms/:roomId/readings/:readingId" />
            <Route path="/rooms/:roomId/direction" />
          </Route>
          <Route
            path="/admin"
            element={
              <RequireAuth requireAdmin>
                <Suspense fallback={<AdminLoading />}>
                  <AdminHomePage />
                </Suspense>
              </RequireAuth>
            }
          />
          <Route
            path="/admin/wow-status"
            element={
              <RequireAuth requireAdmin>
                <Suspense fallback={<AdminLoading />}>
                  <AdminWowStatusPage />
                </Suspense>
              </RequireAuth>
            }
          />
          <Route
            path="/admin/meaning-graph"
            element={
              <RequireAuth requireAdmin>
                <Suspense fallback={<AdminLoading />}>
                  <MeaningGraphPage />
                </Suspense>
              </RequireAuth>
            }
          />
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
