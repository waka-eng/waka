/**
 * Who may reach the internal admin surfaces.
 *
 * Two independent gates, deliberately: an environment opt-in decides whether
 * the routes exist at all in this deployment, and this allowlist decides who
 * gets past them. Either alone is one mistake away from exposure — a
 * misconfigured stage with the flag on, or a production allowlist someone
 * pasted an extra address into.
 *
 * The allowlist is keyed by **account email**, not by profile: an agent
 * profile and its human share one login, and administering the queue is the
 * account's privilege rather than something an agent session inherits.
 */

import type { MiddlewareHandler } from "hono";

import type { AuthEnv } from "./middleware.js";
import type { AuthenticatedSession } from "./session.js";

const ADMIN_EMAIL_ENV_KEYS = ["WAKA_ADMIN_EMAILS", "WAKA_ADMIN_ALLOWLIST"] as const;

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function getAdminEmailAllowlist(): Set<string> {
  const entries = ADMIN_EMAIL_ENV_KEYS.flatMap((key) =>
    (process.env[key] ?? "")
      .split(/[\s,;]+/)
      .map(normalizeEmail)
      .filter(Boolean),
  );
  return new Set(entries);
}

export function isAdminUser(
  account: Pick<AuthenticatedSession["account"], "email"> | null | undefined,
): boolean {
  if (!account?.email) return false;
  return getAdminEmailAllowlist().has(normalizeEmail(account.email));
}

export const requireAdminUser: MiddlewareHandler<AuthEnv> = async (c, next) => {
  const session = c.get("session");
  if (!isAdminUser(session?.account)) {
    return c.json({ error: "Admin authorization required" }, 403);
  }
  await next();
};
