/**
 * <RequireAuth> — protected route guard.
 *
 * Wrapping a route element in this component ensures the underlying page
 * renders only when the AuthContext reports an authenticated user. The guard
 * has three observable states:
 *
 *   1. `isLoading` is true → render a neutral placeholder. We must NOT
 *      redirect here because that would bounce a logged-in visitor to /login
 *      every time they hard-reload (the cookie -> /auth/me round-trip has
 *      not finished yet, and the cached user is only an optimistic hint).
 *
 *   2. `isAuthenticated` is false → redirect to /login, recording the
 *      pathname the user *tried* to reach in `location.state.from`. The
 *      login page reads that field on success so the visitor lands back on
 *      their original destination instead of always being dumped onto "/".
 *
 *   3. otherwise → render the protected children as-is.
 *
 * The guard intentionally renders nothing (other than a tiny "Loading…"
 * affordance) during state #1: showing the protected UI prematurely would
 * leak its layout to anonymous visitors for one frame, and showing /login
 * would flash the wrong page to authenticated visitors. A minimal neutral
 * frame is the only honest answer.
 */

import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";

import { useAuth } from "../lib/auth-context";
import { readStoredLocale, t } from "../lib/locales";

export interface RequireAuthProps {
  children: ReactNode;
  requireAdmin?: boolean;
}

export function RequireAuth({ children, requireAdmin = false }: RequireAuthProps): JSX.Element {
  const { isAuthenticated, isLoading, user } = useAuth();
  const location = useLocation();
  const locale = readStoredLocale();

  if (isLoading) {
    // Neutral splash. Kept deliberately minimal — once Home renders its own
    // skeleton we can lift this to a shared <PageLoading /> primitive, but
    // for now any non-flashing surface is enough to satisfy the guard
    // contract.
    return (
      <div
        role="status"
        aria-live="polite"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          // The splash is the first frame of the product and it was set in
          // serif italic on parchment -- an editorial flourish for a moment
          // that should be furniture. Sans, small, quiet, on the same white
          // the surface uses, so the app does not appear to change clothes
          // between the splash and the first paint.
          background: "#fcfcfb",
          fontFamily:
            '"Inter Tight", -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
          fontSize: 13,
          letterSpacing: 0,
          color: "rgba(23, 22, 19, 0.4)",
        }}
      >
        {t(locale, "loadingAuth")}
      </div>
    );
  }

  if (!isAuthenticated) {
    // Preserve the attempted destination so the login page can send the
    // visitor back after a successful auth round-trip. `pathname + search +
    // hash` together form the smallest faithful round-trip key — anything
    // less drops query params and fragment-based UI state.
    const from = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to="/login" replace state={{ from }} />;
  }

  if (user && !user.onboardingCompletedAt && location.pathname !== "/onboarding") {
    const from = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to="/onboarding" replace state={{ from }} />;
  }

  if (user?.onboardingCompletedAt && location.pathname === "/onboarding") {
    return <Navigate to="/" replace />;
  }

  if (requireAdmin && !user?.isAdmin) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

export default RequireAuth;
