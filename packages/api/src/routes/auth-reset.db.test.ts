/**
 * The way back in, proven against real rows.
 *
 * The claims: a letter carries a working token; the token opens the door
 * exactly once, inside its window; every session on the account ends when it
 * does; a Google-only account gains its password door; an unknown address
 * gets the identical 200 and no letter; the letter budget goes quiet after
 * three in an hour — still behind the identical 200.
 */
import { Hono } from "hono";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDatabase } from "../../test/helpers/index.js";
import { verifyPassword } from "../lib/auth.js";
import { setEmailSenderForTests, type OutgoingEmail } from "../lib/email.js";
import type { AuthEnv } from "../lib/middleware.js";
import { resetConfirmHandler, resetRequestHandler } from "./auth-reset.js";

let t: TestDatabase;
let seq = 0;
let letters: OutgoingEmail[] = [];

const app = new Hono<AuthEnv>();
app.post("/api/auth/reset/request", resetRequestHandler);
app.post("/api/auth/reset/confirm", resetConfirmHandler);

async function seedAccount(input: { passwordHash?: string | null } = {}): Promise<{
  accountId: string;
  profileId: string;
  email: string;
}> {
  seq += 1;
  const email = `reset-${seq}@example.test`;
  const [account] = await t.sql`
    INSERT INTO accounts (email, password_hash)
    VALUES (${email}, ${input.passwordHash ?? "$2a$10$existinghashexistinghashexistingha"})
    RETURNING id`;
  const [profile] = await t.sql`
    INSERT INTO profiles (account_id, type, name)
    VALUES (${account.id}, 'human', 'Reset Tester') RETURNING id`;
  return { accountId: account.id as string, profileId: profile.id as string, email };
}

async function post(path: string, body: unknown): Promise<Response> {
  return app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** The token, read the only place it exists: out of the letter. */
function tokenFromLetter(letter: OutgoingEmail): string {
  const match = /reset\?token=([A-Za-z0-9_-]+)/.exec(letter.text);
  if (!match) throw new Error("the letter carries no link");
  return match[1]!;
}

beforeAll(async () => {
  t = await createTestDatabase();
  /* the handlers reach the database through getDb(), which reads the env —
     point it at this suite's schema the way pipeline-eval does */
  const url = new URL(process.env.DB_CONNECTION_URL!);
  url.searchParams.set("options", `-c search_path=${t.schemaName}`);
  process.env.DB_CONNECTION_URL = url.toString();
});

beforeEach(async () => {
  await t.truncateAll();
  letters = [];
  setEmailSenderForTests(async (email) => {
    letters.push(email);
    return { posted: true };
  });
});

afterEach(() => setEmailSenderForTests(null));

afterAll(async () => {
  await t?.cleanup();
});

describe("the way back in", () => {
  it("a letter opens the door once, and every session ends when it does", async () => {
    const person = await seedAccount();
    await t.sql`
      INSERT INTO sessions (profile_id, token_hash, device_label, expires_at)
      VALUES (${person.profileId}, 'stale-session-hash', 'the attacker maybe', now() + interval '30 days')`;

    const requested = await post("/api/auth/reset/request", { email: person.email });
    expect(requested.status).toBe(200);
    expect(letters).toHaveLength(1);
    expect(letters[0]!.to).toBe(person.email);

    const token = tokenFromLetter(letters[0]!);
    const confirmed = await post("/api/auth/reset/confirm", {
      token,
      password: "a-new-way-in-1!",
    });
    expect(confirmed.status).toBe(200);
    const body = (await confirmed.json()) as { token: string; account: { email: string } };
    expect(body.account.email).toBe(person.email);
    expect(body.token.length).toBeGreaterThan(20);

    const [account] = await t.sql`
      SELECT password_hash FROM accounts WHERE id = ${person.accountId}`;
    expect(await verifyPassword("a-new-way-in-1!", account.password_hash as string)).toBe(true);

    const stale = await t.sql`
      SELECT id FROM sessions WHERE token_hash = 'stale-session-hash'`;
    expect(stale, "the old sessions are gone").toHaveLength(0);

    const again = await post("/api/auth/reset/confirm", { token, password: "second-try-1!" });
    expect(again.status, "a spent letter opens nothing").toBe(400);
  });

  it("an expired letter is refused with the same words as a spent one", async () => {
    const person = await seedAccount();
    await post("/api/auth/reset/request", { email: person.email });
    const token = tokenFromLetter(letters[0]!);
    await t.sql`
      UPDATE password_resets SET expires_at = now() - interval '1 minute'
      WHERE account_id = ${person.accountId}`;
    const confirmed = await post("/api/auth/reset/confirm", { token, password: "too-late-now-1!" });
    expect(confirmed.status).toBe(400);
    const spent = (await (await post("/api/auth/reset/confirm", { token: "not-a-real-token-at-all", password: "whatever-1!" })).json()) as { error: string };
    const expired = (await confirmed.json()) as { error: string };
    expect(expired.error, "one message for every bad token").toBe(spent.error);
  });

  it("a Google-only account gains its password door", async () => {
    const person = await seedAccount({ passwordHash: null });
    await post("/api/auth/reset/request", { email: person.email });
    const token = tokenFromLetter(letters[0]!);
    const confirmed = await post("/api/auth/reset/confirm", { token, password: "now-two-doors-1!" });
    expect(confirmed.status).toBe(200);
    const [account] = await t.sql`
      SELECT password_hash FROM accounts WHERE id = ${person.accountId}`;
    expect(account.password_hash).not.toBeNull();
  });

  it("an unknown address gets the identical 200 and no letter", async () => {
    const known = await seedAccount();
    const forKnown = await post("/api/auth/reset/request", { email: known.email });
    const forUnknown = await post("/api/auth/reset/request", {
      email: "nobody-here@example.test",
    });
    expect(forUnknown.status).toBe(200);
    expect(await forUnknown.json()).toEqual(await forKnown.json());
    expect(letters, "one letter — the known address's").toHaveLength(1);
  });

  it("the letter budget goes quiet after three in an hour, behind the same 200", async () => {
    const person = await seedAccount();
    for (let i = 0; i < 4; i += 1) {
      const res = await post("/api/auth/reset/request", { email: person.email });
      expect(res.status).toBe(200);
    }
    expect(letters, "the fourth request posted nothing").toHaveLength(3);
  });

  it("speaks the letter in the person's own language", async () => {
    const person = await seedAccount();
    await t.sql`
      UPDATE profiles SET preferred_locale = 'ko-KR' WHERE id = ${person.profileId}`;
    await post("/api/auth/reset/request", { email: person.email });
    expect(letters[0]!.subject).toBe("메모리로 돌아가는 길");
    expect(letters[0]!.text).toContain("본인이 아니라면");
  });
});
