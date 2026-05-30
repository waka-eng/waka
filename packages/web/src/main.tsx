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
import AdminWowStatusPage from "./pages/AdminWowStatus";
import HomePage from "./pages/Home";
import LoginPage from "./pages/Login";
import MeaningGraphPage from "./pages/MeaningGraph";
import SavedSignalsArchivePage from "./pages/SavedSignalsArchive";
import TopOfMindSharePage from "./pages/TopOfMindShare";
import "./styles/global.css";

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
          {/*
            The home route is protected. <RequireAuth> handles three cases:
              - still hydrating  → render a neutral loading state,
              - anonymous        → <Navigate> to /login with state.from set,
              - authenticated    → render the underlying page.
          */}
          <Route
            path="/"
            element={
              <RequireAuth>
                <HomePage />
              </RequireAuth>
            }
          />
          <Route
            path="/signals"
            element={
              <RequireAuth>
                <SavedSignalsArchivePage />
              </RequireAuth>
            }
          />
          <Route
            path="/top-of-mind/share"
            element={
              <RequireAuth>
                <TopOfMindSharePage />
              </RequireAuth>
            }
          />
          <Route
            path="/admin"
            element={
              <RequireAuth>
                <MeaningGraphPage />
              </RequireAuth>
            }
          />
          <Route
            path="/admin/wow-status"
            element={
              <RequireAuth>
                <AdminWowStatusPage />
              </RequireAuth>
            }
          />
          <Route
            path="/admin/meaning-graph"
            element={
              <RequireAuth>
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
