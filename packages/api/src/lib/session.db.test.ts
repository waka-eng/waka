/** Real session lookup and revocation on a disposable schema. The audit
 * trigger counts physical row updates, including concurrent requests. */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createTestDatabase, type TestDatabase } from "../../test/helpers/db.js";
import type { getDb } from "./db.js";

const state = vi.hoisted(() => ({ db: undefined as unknown as ReturnType<typeof getDb> }));
vi.mock("./db.js", () => ({ getDb: () => state.db }));
import { createSessionRow, lookupSession, revokeSessionByToken } from "./session.js";

let fixture: TestDatabase;
let token: string;
beforeAll(async () => {
  fixture = await createTestDatabase();
  state.db = fixture.db as unknown as ReturnType<typeof getDb>;
  await fixture.sql.unsafe(`
    CREATE TABLE session_touch_audit (id uuid);
    CREATE FUNCTION audit_session_touch() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN INSERT INTO session_touch_audit VALUES (NEW.id); RETURN NEW; END $$;
    CREATE TRIGGER audit_session_touch AFTER UPDATE ON sessions
      FOR EACH ROW EXECUTE FUNCTION audit_session_touch();
  `);
});
beforeEach(async () => {
  await fixture.truncateAll();
  await fixture.sql`TRUNCATE session_touch_audit`;
  const [account] = await fixture.sql`INSERT INTO accounts(email) VALUES ('session-test@example.test') RETURNING id`;
  const [profile] = await fixture.sql`INSERT INTO profiles(account_id, type, name) VALUES (${account.id}, 'agent', 'Synthetic agent') RETURNING id`;
  token = randomUUID();
  await createSessionRow({ profileId: profile.id, token });
});
afterAll(async () => { await fixture?.cleanup(); });

async function updates() {
  // The fixture has one connection; this read follows all queued touches.
  return (await fixture.sql`SELECT count(*)::int AS n FROM session_touch_audit`)[0].n as number;
}
async function makeStale() {
  await fixture.sql`UPDATE sessions SET last_seen_at = now() - interval '2 minutes'`;
  await fixture.sql`TRUNCATE session_touch_audit`;
}

it("authenticates a burst without rewriting a recently used session", async () => {
  for (let i = 0; i < 100; i++) expect(await lookupSession(token)).not.toBeNull();
  expect(await updates()).toBe(0);
});

it("coalesces concurrent stale touches and refreshes the last-used time", async () => {
  await makeStale();
  const before = Date.now();
  const results = await Promise.all(Array.from({ length: 20 }, () => lookupSession(token)));
  expect(results.every(Boolean)).toBe(true);
  expect(await updates()).toBe(1);
  const [row] = await fixture.sql`SELECT last_seen_at FROM sessions`;
  expect(new Date(row.last_seen_at).getTime()).toBeGreaterThanOrEqual(before);
  expect(await lookupSession(token)).not.toBeNull();
  expect(await updates()).toBe(1);
  await makeStale();
  expect(await lookupSession(token)).not.toBeNull();
  expect(await updates()).toBe(1);
});

it("checks revocation and expiry on every request even within the touch interval", async () => {
  expect(await lookupSession(token)).not.toBeNull();
  await revokeSessionByToken(token);
  expect(await lookupSession(token)).toBeNull();
  const [profile] = await fixture.sql`SELECT id FROM profiles LIMIT 1`;
  await createSessionRow({ profileId: profile.id, token });
  await fixture.sql`UPDATE sessions SET expires_at = now() - interval '1 second'`;
  expect(await lookupSession(token)).toBeNull();
  expect(await lookupSession("unknown-token")).toBeNull();
});

it("keeps authentication available if the informational touch fails", async () => {
  await makeStale();
  await fixture.sql.unsafe(`CREATE OR REPLACE FUNCTION audit_session_touch() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'Synthetic activity-write failure'; END $$;`);
  expect(await lookupSession(token)).not.toBeNull();
  expect(await updates()).toBe(0);
});
