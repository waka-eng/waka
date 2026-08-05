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

import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { RequireAuth } from "./components/RequireAuth";
import { AuthProvider } from "./lib/auth-context";
import AdminHomePage from "./pages/AdminHome";
import AdminWowStatusPage from "./pages/AdminWowStatus";
import SurfacePage from "./pages/Surface";
import LoginPage from "./pages/Login";
import OnboardingPage from "./pages/Onboarding";
import ProfilePage from "./pages/Profile";
import PublicProfilePage from "./pages/PublicProfile";
import MeaningGraphPage from "./pages/MeaningGraph";
import "./styles/global.css";
// Loaded after global.css and deliberately wins. See the header of that file
// for what it supersedes and why it is separable rather than merged.
import "./styles/system.css";
import "./styles/surface.css";

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
            <Route path="/inspirations" />
            <Route path="/inspirations/:signalId" />
            <Route path="/readings/:readingId" />
            <Route path="/rooms/:roomId" />
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
                <AdminHomePage />
              </RequireAuth>
            }
          />
          <Route
            path="/admin/wow-status"
            element={
              <RequireAuth requireAdmin>
                <AdminWowStatusPage />
              </RequireAuth>
            }
          />
          <Route
            path="/admin/meaning-graph"
            element={
              <RequireAuth requireAdmin>
                <MeaningGraphPage />
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
