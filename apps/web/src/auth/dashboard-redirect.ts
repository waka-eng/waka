const AUTH_SESSION_COOKIE_NAMES = new Set([
  "__Secure-authjs.session-token",
  "authjs.session-token",
  "__Secure-next-auth.session-token",
  "next-auth.session-token",
]);

export const DASHBOARD_SIGN_IN_PATH = "/auth/signin";

export function hasAuthSessionCookie(cookieNames: Iterable<string>): boolean {
  for (const cookieName of cookieNames) {
    if (AUTH_SESSION_COOKIE_NAMES.has(cookieName)) {
      return true;
    }
  }

  return false;
}

export function getDashboardRedirectPath(
  cookieNames: Iterable<string>,
): string | null {
  if (hasAuthSessionCookie(cookieNames)) {
    return null;
  }

  return DASHBOARD_SIGN_IN_PATH;
}
