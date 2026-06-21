import type { MiddlewareHandler } from "hono";

import type { AuthEnv } from "./middleware.js";
import type { AuthenticatedUser } from "./session.js";

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

export function isAdminUser(user: Pick<AuthenticatedUser, "email"> | null | undefined): boolean {
  if (!user?.email) return false;
  return getAdminEmailAllowlist().has(normalizeEmail(user.email));
}

export const requireAdminUser: MiddlewareHandler<AuthEnv> = async (c, next) => {
  const user = c.get("user");
  if (!isAdminUser(user)) {
    return c.json({ error: "Admin authorization required" }, 403);
  }
  await next();
};
