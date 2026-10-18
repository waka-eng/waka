/**
 * WHERE A VISITOR LANDS AFTER SIGNING IN — and which answers we refuse.
 *
 * Three places on /login ask the same question: the login form, the signup
 * form, and the Google button (which has to hand the destination to the API
 * so it survives the trip through Google's consent screen). All three used to
 * ask it by calling a helper defined halfway up the page component, which
 * meant the one rule here that has security consequences lived where nothing
 * could execute it.
 *
 * That rule is `safeInAppPath`. A post-sign-in destination arrives from two
 * places a visitor can influence — `location.state.from`, set by the route
 * guard when it bounces an anonymous visitor, and a `?returnTo=` query param —
 * and a destination we accept becomes a navigation we perform on a session
 * that has just been authenticated. Accept `https://elsewhere.example` there
 * and sign-in becomes an open redirect: the visitor types their password on
 * our page and arrives on someone else's, at the moment they are most primed
 * to trust what they see.
 *
 * WHY A URL PARSE RATHER THAN A STRING TEST. The obvious check is
 * `value.startsWith("/")`, and it is not enough on its own: `//evil.example`
 * starts with "/" and is a protocol-relative URL that browsers happily treat
 * as another origin. So the value is resolved against a base origin that
 * cannot exist, and anything whose resolved origin is not that base is
 * rejected. The `startsWith` test is kept as a cheap first gate, not as the
 * decision. `/login` is refused separately for a different reason — it is not
 * unsafe, it is just a loop: signing in and landing back on the sign-in page.
 *
 * `docs/architecture.md`: "A rule nobody can execute is a rule nobody has
 * checked." This file is that rule made executable.
 */

import type { Location } from "react-router-dom";

export const DEFAULT_REDIRECT = "/";

export function safeInAppPath(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("/") || value.length > 2_048) {
    return null;
  }
  try {
    const internalOrigin = "https://waka.invalid";
    const target = new URL(value, internalOrigin);
    if (target.origin !== internalOrigin || target.pathname === "/login") return null;
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return null;
  }
}

/**
 * Resolve the post-auth destination. Honours `location.state.from` if it
 * looks like an in-app path the route-guard set when bouncing the user to
 * /login; otherwise falls back to the home route. We refuse anything that
 * doesn't start with "/" so a malicious referrer cannot steer the user to
 * an external site after they sign in.
 */
export function resolveRedirect(location: Location, signedInAccountId?: string | null): string {
  const state = location.state as { from?: unknown; expiredFor?: unknown } | null;
  /* A `from` written because a session EXPIRED belongs to the account whose
     session it was (`expiredFor`). Anybody else signing in at that door —
     or a destination asked for before we know who (the Google button) —
     goes home rather than onto the previous person's page. */
  const foreign = Boolean(state && "expiredFor" in state && state.expiredFor !== signedInAccountId);
  const from = foreign ? null : safeInAppPath(state?.from);
  if (from) return from;
  const queryReturnTo = new URLSearchParams(location.search).get("returnTo");
  const returnTo = safeInAppPath(queryReturnTo);
  if (returnTo) return returnTo;
  return DEFAULT_REDIRECT;
}
