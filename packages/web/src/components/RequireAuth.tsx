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
import { LoadingHome } from "./LoadingHome";

export interface RequireAuthProps {
  children: ReactNode;
  requireAdmin?: boolean;
}

export function RequireAuth({ children, requireAdmin = false }: RequireAuthProps): JSX.Element {
  const { isAuthenticated, isLoading, account } = useAuth();
  const location = useLocation();

  if (isLoading) {
    // The splash was a white page with a word on it — the product changing
    // clothes between the door and the world (founder, 2026-08-27: "loading
    // page should be this black color … can we have the character already
    // there"). It is the world's own early face now, shared with Home's
    // pre-ready frame, so the way in never flashes.
    return <LoadingHome />;
  }

  if (!isAuthenticated) {
    // Preserve the attempted destination so the login page can send the
    // visitor back after a successful auth round-trip. `pathname + search +
    // hash` together form the smallest faithful round-trip key — anything
    // less drops query params and fragment-based UI state.
    const from = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to="/login" replace state={{ from }} />;
  }

  if (account && !account.onboardingCompletedAt && location.pathname !== "/onboarding") {
    const from = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to="/onboarding" replace state={{ from }} />;
  }

  if (account?.onboardingCompletedAt && location.pathname === "/onboarding") {
    return <Navigate to="/" replace />;
  }

  if (requireAdmin && !account?.isAdmin) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

export default RequireAuth;
