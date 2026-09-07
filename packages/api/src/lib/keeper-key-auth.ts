/**
 * The keeper's standing key — the human's own way into their memory from a
 * terminal, minting and the auth path.
 *
 * Founder ask, 2026-08-29, and it completes that day's ruling: with agents
 * unable to capture into the human profile, the person needs a first-class
 * credential of their own for MCP — one that survives session expiry, needs
 * no browser consent dance to re-mint, and can be revoked from the account.
 *
 * THE SHAPE OF THE SECRET. `waka_keeper_` + 48 hex characters, minted by the
 * same `mintStandingKey` an agent key uses — one entropy-and-hash dance for
 * every key kind. The prefix routes it in `requireAuth` without a signature
 * check and makes a leaked key greppable by shape.
 *
 * WHAT A KEEPER KEY MAY BE, and why it is LESS than the person. A browser
 * session bound to the human profile is the account's admin — every profile,
 * every verb, every account decision. A standing credential sitting in an
 * MCP config file on disk must not be that. So the session this lookup
 * resolves carries `keyScoped`, and the access matrix answers it with
 * exactly two verbs on exactly one profile: READ and CAPTURE on the keeper's
 * own. No curation, no other profiles, no account decisions
 * (`humanSessionsOnly` refuses it) — keep and recall, which is the whole of
 * what the person's MCP tools do, and nothing a stolen config file could
 * escalate. Bound to a HUMAN profile only, enforced at issue time and
 * re-checked at lookup, mirroring the agent key's discipline in the other
 * direction.
 */
import { and, eq, isNull } from "drizzle-orm";

import { accounts, keeperKeys, profiles } from "../db/index.js";
import { getDb } from "./db.js";
import { AGENT_KEY_DISPLAY_CHARS, mintStandingKey, type MintedAgentKey } from "./agent-key-auth.js";
import { hashSessionToken, type AuthenticatedSession } from "./session.js";
import { normalizeSupportedLocale } from "./locales.js";

export const KEEPER_KEY_PREFIX = "waka_keeper_";

/** Same display budget as an agent key; a list needs no more to tell keys apart. */
export const KEEPER_KEY_DISPLAY_CHARS = AGENT_KEY_DISPLAY_CHARS;

export async function mintKeeperKey(): Promise<MintedAgentKey> {
  return mintStandingKey(KEEPER_KEY_PREFIX);
}

/** Is this bearer credential shaped like a keeper key at all? */
export function looksLikeKeeperKey(token: string): boolean {
  return token.startsWith(KEEPER_KEY_PREFIX);
}

/**
 * Resolve a presented keeper key to the scoped human session it stands for.
 *
 * Null for anything that is not a live key: unknown, revoked, or bound to a
 * row whose profile is somehow not the human — a hand-written row cannot
 * make a keeper key act as an agent, the mirror of the agent key's rule.
 */
export async function lookupKeeperKeySession(
  token: string,
  db: ReturnType<typeof getDb> = getDb(),
): Promise<AuthenticatedSession | null> {
  const tokenHash = await hashSessionToken(token);
  const rows = await db
    .select({
      keyId: keeperKeys.id,
      profileId: profiles.id,
      profileName: profiles.name,
      preferredLocale: profiles.preferredLocale,
      accountId: accounts.id,
      accountEmail: accounts.email,
    })
    .from(keeperKeys)
    .innerJoin(profiles, eq(profiles.id, keeperKeys.profileId))
    .innerJoin(accounts, eq(accounts.id, profiles.accountId))
    .where(
      and(
        eq(keeperKeys.tokenHash, tokenHash),
        isNull(keeperKeys.revokedAt),
        eq(profiles.type, "human"),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  void db
    .update(keeperKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(keeperKeys.id, row.keyId))
    .catch(() => {
      /* bookkeeping only */
    });

  return {
    sessionId: `keeper-key:${row.keyId}`,
    account: { id: row.accountId, email: row.accountEmail },
    profile: {
      id: row.profileId,
      accountId: row.accountId,
      type: "human",
      name: row.profileName,
      preferredLocale: normalizeSupportedLocale(row.preferredLocale),
    },
    keyScoped: true,
  };
}
