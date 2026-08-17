/**
 * PROVING AN ADDRESS, AGAINST A REAL DATABASE.
 *
 * The interesting behaviour here is all in rows: a unique index that makes
 * "resend" replace rather than accumulate, a token stored only as a hash, and
 * a link that is spent when used. A mocked query builder would assert that
 * this file calls what this file calls and prove none of it.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDatabase } from "../../test/helpers/index.js";
import {
  RESEND_COOLDOWN_MS,
  claimVerification,
  issueVerification,
  VERIFICATION_TTL_MS,
} from "./email-verification.js";

let t: TestDatabase;
let seq = 0;
const sent: string[] = [];
const send = async ({ link }: { link: string }) => {
  sent.push(link);
};

async function seedAccount(): Promise<{ id: string; email: string }> {
  seq += 1;
  const email = `verify-${seq}@example.test`;
  const [row] = await t.sql`INSERT INTO accounts (email) VALUES (${email}) RETURNING id`;
  return { id: row.id as string, email };
}

const issue = (account: { id: string; email: string }, now?: Date) =>
  issueVerification(
    t.db as never,
    { accountId: account.id, email: account.email, baseUrl: "https://waka.test" },
    { send, ...(now ? { now } : {}) },
  );

const verifiedAt = async (id: string) => {
  const [row] = await t.sql`SELECT email_verified_at FROM accounts WHERE id = ${id}`;
  return row.email_verified_at as Date | null;
};

describe("email verification", () => {
  beforeEach(async () => {
    t ??= await createTestDatabase();
    await t.truncateAll();
    sent.length = 0;
  });
  afterAll(async () => {
    await t?.sql.end();
  });

  it("starts unproven, which is the honest default", async () => {
    const account = await seedAccount();
    expect(await verifiedAt(account.id)).toBeNull();
  });

  it("proves the address when the link is followed", async () => {
    const account = await seedAccount();
    const { token } = await issue(account);

    expect(await claimVerification(t.db as never, token!)).toBe("verified");
    expect(await verifiedAt(account.id)).not.toBeNull();
  });

  /** The plaintext lives in the email and nowhere else. */
  it("stores the token only as a hash", async () => {
    const account = await seedAccount();
    const { token } = await issue(account);

    const [row] = await t.sql`SELECT token_hash FROM email_verifications`;
    expect(row.token_hash).not.toBe(token);
    expect(String(row.token_hash)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("spends the link, so a forwarded one cannot be used twice", async () => {
    const account = await seedAccount();
    const { token } = await issue(account);
    await claimVerification(t.db as never, token!);

    expect(await claimVerification(t.db as never, token!)).toBe("invalid");
  });

  it("tells an expired link apart from a wrong one, because only one is actionable", async () => {
    const account = await seedAccount();
    const { token } = await issue(account);
    const later = new Date(Date.now() + VERIFICATION_TTL_MS + 1000);

    expect(await claimVerification(t.db as never, token!, { now: later })).toBe("expired");
    expect(await claimVerification(t.db as never, "not-a-real-token")).toBe("invalid");
  });

  /**
   * Without a cooldown, "resend" is an open relay pointed at anyone's inbox —
   * a request per second, sent by us, from our domain.
   */
  it("refuses to send again immediately", async () => {
    const account = await seedAccount();
    await issue(account);

    const again = await issue(account);

    expect(again.sent).toBe(false);
    expect(sent).toHaveLength(1);
  });

  it("replaces the old link rather than adding one, once the wait is over", async () => {
    const account = await seedAccount();
    const first = await issue(account);
    const later = new Date(Date.now() + RESEND_COOLDOWN_MS + 1000);

    const second = await issue(account, later);

    const rows = await t.sql`SELECT id FROM email_verifications WHERE account_id = ${account.id}`;
    expect(rows).toHaveLength(1);
    expect(await claimVerification(t.db as never, first.token!)).toBe("invalid");
    expect(await claimVerification(t.db as never, second.token!)).toBe("verified");
  });
});
