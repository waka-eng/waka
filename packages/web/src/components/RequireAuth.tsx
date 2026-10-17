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

import { Fragment, useState, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";

import { useAuth } from "../lib/auth-context";
import { LoadingHome } from "./LoadingHome";
import { readStoredLocale, t } from "../lib/locales";

export interface RequireAuthProps {
  children: ReactNode;
  requireAdmin?: boolean;
}

export function RequireAuth({ children, requireAdmin = false }: RequireAuthProps): JSX.Element {
  const { isAuthenticated, isLoading, account, profile, serverUnreachable, sessionExpired, refresh } = useAuth();
  const location = useLocation();
  const [checking, setChecking] = useState(false);

  if (isLoading) {
    // The splash was a white page with a word on it — the product changing
    // clothes between the door and the world (founder, 2026-08-27: "loading
    // page should be this black color … can we have the character already
    // there"). It is the world's own early face now, shared with Home's
    // pre-ready frame, so the way in never flashes.
    return <LoadingHome />;
  }

  /* ═══ COULD NOT ASK IS NOT SIGNED OUT ═════════════════════════════════
     A dead network at startup used to fall straight through to the redirect
     below, so a person with a perfectly good session was sent to the sign-in
     form — "Welcome back. Sign in to return to what you kept." — and had no
     way to get back except to type a password they had not needed, or to
     reload and hope. Access is still refused (nothing protected renders off
     a cached hint); what changes is that the screen says what is known and
     asks the server again when told to. A successful answer lands the person
     where they were going, without the door in between. */
  if (!isAuthenticated && serverUnreachable && !sessionExpired) {
    const locale = readStoredLocale();
    return <LoadingHome problem={{
      message: t(locale, "unreachableTitle"),
      actions: [{
        label: t(locale, checking ? "unreachableChecking" : "homeTryAgain"),
        busy: checking,
        onClick: () => {
          setChecking(true);
          void refresh().catch(() => undefined).finally(() => setChecking(false));
        },
      }],
    }} />;
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

  // A different identity receives fresh route state, caches and pending work.
  return <Fragment key={`${account?.id ?? ""}:${profile?.id ?? ""}`}>{children}</Fragment>;
}
