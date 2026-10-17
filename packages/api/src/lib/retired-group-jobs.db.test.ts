import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createTestDatabase, type TestDatabase } from "../../test/helpers/index.js";
import { setDefaultModelProviderForTests, type ModelProvider } from "./model-provider.js";
import { runBackgroundJobWorker } from "./queue.js";

/* THE ROOM ENGINE IS RETIRED, AND WORK QUEUED BEFORE THAT MUST NOT WAKE IT.
   Rows of every room shape were enqueued in dev and prod while rooms were
   live. The worker settles them as done without running anything — no model
   call, no artifact, no follow-on job — and without throwing, which would
   have burned three attempts into a `failed` row per room. The enum value
   `refresh_group_top_of_mind` is kept (an ALTER TYPE is a migration). */

let t: TestDatabase;
let seq = 0;

beforeAll(async () => {
  t = await createTestDatabase();
  const url = new URL(process.env.DB_CONNECTION_URL!);
  url.searchParams.set("options", `-c search_path=${t.schemaName}`);
  process.env.DB_CONNECTION_URL = url.toString();
  setDefaultModelProviderForTests(new Proxy({}, {
    // `then` stays undefined so awaiting the provider does not treat it as a promise.
    get: (_target, name) => name === "then" ? undefined : name === "name" ? "retired-room-guard" : async () => {
      throw new Error(`Retired room work reached the model: ${String(name)}`);
    },
  }) as unknown as ModelProvider);
});
beforeEach(async () => { await t.truncateAll(); });
afterEach(() => { vi.restoreAllMocks(); });
afterAll(async () => { setDefaultModelProviderForTests(null); await t?.cleanup(); });

async function legacyGroup() {
  const [account] = await t.sql`INSERT INTO accounts (email) VALUES (${`retired-room-${++seq}@example.test`}) RETURNING id`;
  const [member] = await t.sql`INSERT INTO profiles (account_id, type, name) VALUES (${account.id}, 'human', 'Member') RETURNING id`;
  const [group] = await t.sql`INSERT INTO groups (name, join_code, created_by_profile_id)
    VALUES ('Legacy room', ${`retired-${seq}-${Math.random().toString(36).slice(2, 8)}`}, ${member.id}) RETURNING id`;
  const [mind] = await t.sql`INSERT INTO profiles (account_id, type, name, group_id) VALUES (NULL, 'group', 'Legacy room', ${group.id}) RETURNING id`;
  await t.sql`INSERT INTO group_members (group_id, profile_id, role) VALUES (${group.id}, ${member.id}, 'owner')`;
  const [source] = await t.sql`INSERT INTO inspirations (profile_id, text, visibility) VALUES (${member.id}, 'A public memory', 'public') RETURNING id`;
  return { memberId: member.id as string, groupId: group.id as string, mindId: mind.id as string, sourceId: source.id as string };
}

it("settles every queued room-shaped job as done without running it", async () => {
  const legacy = await legacyGroup();
  const queued: Array<[string, string, Record<string, unknown>]> = [
    [legacy.memberId, "refresh_group_top_of_mind", { groupId: legacy.groupId, reason: "shares_changed" }],
    [legacy.memberId, "derive_signals", { inspirationId: legacy.sourceId, reason: "created", deriveIntoProfileId: legacy.mindId }],
    [legacy.memberId, "review_signal_support", { inspirationId: legacy.sourceId, deriveIntoProfileId: legacy.mindId }],
    [legacy.memberId, "assess_signal_support", { inspirationId: legacy.sourceId, deriveIntoProfileId: legacy.mindId,
      signalIds: [legacy.mindId], materialRevision: "1", materialHash: "0".repeat(64), membershipId: null,
      statements: [{ id: legacy.mindId, revision: "1", hash: "0".repeat(64) }] }],
    [legacy.memberId, "refresh_principles", { profileId: legacy.mindId }],
    /* a mind as its own tenant: settled where the branch loads the profile */
    [legacy.mindId, "refresh_principles", { profileId: legacy.mindId }],
    [legacy.mindId, "tend_signal_garden", {}],
  ];
  for (const [profileId, type, payload] of queued) {
    await t.sql`INSERT INTO background_jobs (profile_id, type, payload)
      VALUES (${profileId}, ${type}::background_job_type, ${JSON.stringify(payload)}::jsonb)`;
  }

  const result = await runBackgroundJobWorker({ limit: 10, now: new Date(Date.now() + 1000) });

  expect(result).toMatchObject({ claimed: queued.length, succeeded: queued.length, failed: 0, retried: 0 });
  const rows = await t.sql`SELECT type::text, status::text, attempts, last_error FROM background_jobs ORDER BY type::text`;
  expect(rows).toHaveLength(queued.length);
  for (const row of rows) expect(row).toMatchObject({ status: "succeeded", attempts: 1, last_error: null });
  expect(await t.sql`SELECT id FROM top_of_minds`).toHaveLength(0);
  expect(await t.sql`SELECT id FROM signals`).toHaveLength(0);
  expect(await t.sql`SELECT id FROM principles`).toHaveLength(0);
});

/* THE NEGATIVE HALF. The same job types on a personal or an agent profile —
   including one that HOLDS a room seat — must reach their own handler, never
   the retirement path. Observed through the retirement log line: whatever a
   handler then does (succeed, drop a malformed payload, fail on the throwing
   provider and retry), it was not settled as room work. */
it("never settles a personal or agent job of the same types as room work", async () => {
  const legacy = await legacyGroup();
  const [account] = await t.sql`INSERT INTO accounts (email) VALUES (${`retired-agent-${++seq}@example.test`}) RETURNING id`;
  const [agent] = await t.sql`INSERT INTO profiles (account_id, type, name) VALUES (${account.id}, 'agent', 'Agent') RETURNING id`;
  const [agentSource] = await t.sql`INSERT INTO inspirations (profile_id, text) VALUES (${agent.id}, 'An agent note') RETURNING id`;
  const owners = [[legacy.memberId, legacy.sourceId], [agent.id as string, agentSource.id as string]] as const;
  const ids: string[] = [];
  for (const [profileId, sourceId] of owners) {
    for (const [type, payload] of [
      ["refresh_principles", { profileId }],
      ["tend_signal_garden", {}],
      ["derive_signals", { inspirationId: sourceId, reason: "created" }],
      ["assess_signal_support", { inspirationId: sourceId }],
    ] as const) {
      const [job] = await t.sql`INSERT INTO background_jobs (profile_id, type, payload)
        VALUES (${profileId}, ${type}::background_job_type, ${JSON.stringify(payload)}::jsonb) RETURNING id`;
      ids.push(job.id as string);
    }
  }
  const settled: string[] = [];
  vi.spyOn(console, "info").mockImplementation((message: unknown, detail: unknown) => {
    if (typeof message === "string" && message.includes("settling retired")) settled.push((detail as { jobId: string }).jobId);
  });

  const result = await runBackgroundJobWorker({ limit: 20, now: new Date(Date.now() + 1000) });

  expect(result.claimed).toBe(ids.length);
  expect(settled).toEqual([]);
  // The throwing provider proves derive reached its handler: it got as far
  // as asking for extraction, which only a run (never a settle) does.
  expect(await t.sql`SELECT status::text, last_error FROM background_jobs
    WHERE type = 'derive_signals' ORDER BY profile_id`).toHaveLength(2);
  expect((await t.sql`SELECT count(*)::int AS n FROM background_jobs
    WHERE type = 'derive_signals' AND last_error IS NOT NULL`)[0]!.n).toBe(2);
});
