/**
 * The standing credential an agent holds — minting, and the auth path.
 *
 * Meeting decision, 2026-08-17: per-agent names and API keys, so permission
 * separation runs between PROFILES. The name lives on the agent's profile;
 * this file is the key's whole lifecycle except the HTTP handlers (which
 * live in `routes/agent-keys.ts`, per the routes-own-handlers rule).
 *
 * THE SHAPE OF THE SECRET. `waka_agent_` + 48 hex characters (24 random
 * bytes). The prefix is load-bearing twice over: `requireAuth` uses it to
 * route a bearer credential to this lookup instead of the JWT path without
 * spending a signature check on every request, and a leaked key in a log or
 * a repo is greppable by shape — the reason GitHub-style prefixes exist.
 *
 * WHAT A KEY MAY BE. Bound to an AGENT profile only, enforced at issue time
 * and re-checked at lookup (`profiles.type = 'agent'`), so a key can never
 * impersonate the human even if a row were hand-written. The session it
 * resolves to is an ordinary agent-bound `AuthenticatedSession`: the access
 * matrix, `humanSessionsOnly`, and the sibling-grant door all apply to it
 * exactly as they do to a consent-flow agent login — this file adds a way
 * IN, never a wider set of things the agent may do once in.
 */
import { and, eq, isNull } from "drizzle-orm";

import { accounts, agentKeys, profiles } from "../db/index.js";
import { getDb } from "./db.js";
import { hashSessionToken, type AuthenticatedSession } from "./session.js";
import { normalizeSupportedLocale } from "./locales.js";

export const AGENT_KEY_PREFIX = "waka_agent_";

/** How much of the secret a list may show. Enough to tell keys apart. */
export const AGENT_KEY_DISPLAY_CHARS = 16;

export interface MintedAgentKey {
  /** The whole secret. Exists in memory now and never again. */
  secret: string;
  tokenHash: string;
  prefix: string;
}

export async function mintAgentKey(): Promise<MintedAgentKey> {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  let hex = "";
  for (let i = 0; i < bytes.length; i++) hex += bytes[i]!.toString(16).padStart(2, "0");
  const secret = `${AGENT_KEY_PREFIX}${hex}`;
  return {
    secret,
    tokenHash: await hashSessionToken(secret),
    prefix: secret.slice(0, AGENT_KEY_DISPLAY_CHARS),
  };
}

/** Is this bearer credential shaped like an agent key at all? */
export function looksLikeAgentKey(token: string): boolean {
  return token.startsWith(AGENT_KEY_PREFIX);
}

/**
 * Resolve a presented key to the agent session it stands for.
 *
 * Null for anything that is not a live key: unknown, revoked, or bound to a
 * row whose profile is somehow not an agent. `lastUsedAt` is touched
 * best-effort, like the session table's `lastSeenAt` — a bookkeeping write
 * must never turn a successful read into a 500.
 */
export async function lookupAgentKeySession(
  token: string,
  db: ReturnType<typeof getDb> = getDb(),
): Promise<AuthenticatedSession | null> {
  const tokenHash = await hashSessionToken(token);
  const rows = await db
    .select({
      keyId: agentKeys.id,
      profileId: profiles.id,
      profileType: profiles.type,
      profileName: profiles.name,
      preferredLocale: profiles.preferredLocale,
      accountId: accounts.id,
      accountEmail: accounts.email,
    })
    .from(agentKeys)
    .innerJoin(profiles, eq(profiles.id, agentKeys.profileId))
    .innerJoin(accounts, eq(accounts.id, profiles.accountId))
    .where(
      and(
        eq(agentKeys.tokenHash, tokenHash),
        isNull(agentKeys.revokedAt),
        eq(profiles.type, "agent"),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  void db
    .update(agentKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(agentKeys.id, row.keyId))
    .catch(() => {
      /* bookkeeping only */
    });

  /* the same session shape a consent-flow agent login resolves to — email
     included, because the matrix (not this lookup) is what governs access */
  return {
    sessionId: `agent-key:${row.keyId}`,
    account: { id: row.accountId, email: row.accountEmail },
    profile: {
      id: row.profileId,
      accountId: row.accountId,
      type: "agent",
      name: row.profileName,
      preferredLocale: normalizeSupportedLocale(row.preferredLocale),
    },
  };
}
