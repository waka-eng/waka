/**
 * PROVING AN EMAIL ADDRESS — everything except putting the letter in the post.
 *
 * WHY THE SENDING IS AN INTERFACE AND NOT A PROVIDER.
 *
 * This repo has never sent an email. Choosing SES over Resend over Postmark is
 * a decision about domains, DKIM records and credentials that belongs to
 * whoever runs the infrastructure, and picking one here would wire the product
 * to send mail from somewhere nobody had agreed to. So the transport is one
 * function behind one type. The default writes the link to the log, which is
 * what a developer wants anyway; a real provider is a single implementation
 * passed in at the edge, and nothing else in this file changes.
 *
 * That also means the security work lands NOW rather than waiting on an
 * infrastructure decision — the gate on joining a group is real from this
 * commit, and it becomes escapable the day a provider is wired.
 *
 * WHAT IS DELIBERATE ABOUT THE TOKEN.
 *
 * It is 32 random bytes, base64url, so guessing is not a strategy. It is
 * stored as a sha-256 hash for the reason a password is: this table is a set
 * of bearer credentials, and a leaked backup would otherwise be a list of
 * working account-takeover links. Lookup is by hash of what the caller
 * presents, so the plaintext exists only in the email that carried it.
 *
 * It expires, because a link that works forever is a credential that leaks
 * into browser history, forwarded mail and screenshots and never stops
 * working. A day is long enough to find the message and short enough that a
 * stale one is useless.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { eq } from "drizzle-orm";

import { accounts, emailVerifications } from "../db/index.js";
import { getDb } from "./db.js";

type WakaDb = ReturnType<typeof getDb>;

/** A day: long enough to find the message, short enough that a stale one dies. */
export const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * The least a caller may wait before asking for another link.
 *
 * Without this, "resend" is an open relay pointed at anyone's inbox: a request
 * per second to a victim's address, sent by us, from our domain. It is also
 * what protects the sending reputation the provider has not been chosen for
 * yet.
 */
export const RESEND_COOLDOWN_MS = 60 * 1000;

export interface VerificationEmail {
  to: string;
  /** the full link, already assembled — the transport never builds URLs */
  link: string;
}

/** The one thing a provider has to supply. */
export type SendVerificationEmail = (message: VerificationEmail) => Promise<void>;

/**
 * The default transport: say the link out loud where a developer can see it.
 *
 * Deliberately not a silent no-op. A no-op would make an unsent email
 * indistinguishable from a sent one, and the first person to wonder why
 * verification "does nothing" would have no thread to pull.
 */
export const logVerificationEmail: SendVerificationEmail = async ({ to, link }) => {
  console.info(
    `[email-verification] no mail provider is configured, so nothing was sent.\n` +
      `  to:   ${to}\n` +
      `  link: ${link}\n` +
      `  Wire a SendVerificationEmail implementation to deliver this.`,
  );
};

const hashToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

export interface IssueVerificationResult {
  /** false when the caller asked again too soon */
  sent: boolean;
  /** the plaintext, returned only so a test can follow the link */
  token: string | null;
}

/**
 * Mint a link for this account, replacing any live one.
 *
 * Replacing rather than adding is the point: a person who clicks "resend"
 * expects the newest mail to be the one that works, and an old link left alive
 * in an old inbox is a credential nobody remembers issuing.
 */
export async function issueVerification(
  db: WakaDb,
  input: { accountId: string; email: string; baseUrl: string },
  deps: { send?: SendVerificationEmail; now?: Date } = {},
): Promise<IssueVerificationResult> {
  const now = deps.now ?? new Date();
  const send = deps.send ?? logVerificationEmail;

  const [existing] = await db
    .select({ sentAt: emailVerifications.sentAt })
    .from(emailVerifications)
    .where(eq(emailVerifications.accountId, input.accountId));
  if (existing && now.getTime() - existing.sentAt.getTime() < RESEND_COOLDOWN_MS) {
    return { sent: false, token: null };
  }

  const token = randomBytes(32).toString("base64url");
  const row = {
    accountId: input.accountId,
    tokenHash: hashToken(token),
    expiresAt: new Date(now.getTime() + VERIFICATION_TTL_MS),
    sentAt: now,
  };
  await db
    .insert(emailVerifications)
    .values(row)
    .onConflictDoUpdate({ target: emailVerifications.accountId, set: row });

  const link = `${input.baseUrl.replace(/\/$/, "")}/verify-email?token=${encodeURIComponent(token)}`;
  await send({ to: input.email, link });
  return { sent: true, token };
}

export type VerificationOutcome = "verified" | "already-verified" | "invalid" | "expired";

/**
 * Spend a token.
 *
 * `invalid` and `expired` are told apart for the person holding a stale link —
 * "this link has expired, ask for another" is actionable where "invalid" is
 * not. Neither reveals whether the account exists, because the token is the
 * only thing being judged.
 */
export async function claimVerification(
  db: WakaDb,
  token: string,
  deps: { now?: Date } = {},
): Promise<VerificationOutcome> {
  const now = deps.now ?? new Date();
  const presented = hashToken(token);

  const [row] = await db
    .select({
      id: emailVerifications.id,
      accountId: emailVerifications.accountId,
      tokenHash: emailVerifications.tokenHash,
      expiresAt: emailVerifications.expiresAt,
    })
    .from(emailVerifications)
    .where(eq(emailVerifications.tokenHash, presented));
  if (!row) return "invalid";

  /* The lookup already matched on a hash, so this is belt and braces rather
     than the load-bearing comparison — but a constant-time check costs
     nothing and keeps the habit where the habit belongs. */
  const a = Buffer.from(row.tokenHash);
  const b = Buffer.from(presented);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return "invalid";

  if (row.expiresAt.getTime() < now.getTime()) return "expired";

  const [account] = await db
    .select({ emailVerifiedAt: accounts.emailVerifiedAt })
    .from(accounts)
    .where(eq(accounts.id, row.accountId));
  if (account?.emailVerifiedAt) return "already-verified";

  await db
    .update(accounts)
    .set({ emailVerifiedAt: now, updatedAt: now })
    .where(eq(accounts.id, row.accountId));
  /* spent: the link is a one-time credential and must not survive its use */
  await db.delete(emailVerifications).where(eq(emailVerifications.id, row.id));
  return "verified";
}
