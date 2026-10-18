import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createTestDatabase, type TestDatabase } from "../../test/helpers/index.js";

/* THE ROOM ENGINE IS RETIRED, AND WORK QUEUED BEFORE THAT MUST NOT WAKE IT.
   Rows of every room shape were enqueued in dev and prod while rooms were
   live. The worker settles them as done without running anything and
   without throwing, which would have burned three attempts into a `failed`
   row per room. The enum value `refresh_group_top_of_mind` is kept (an
   ALTER TYPE is a migration).

   Every handler a room-shaped row could otherwise reach is replaced by a
   recorder, so both directions are observed as behaviour: a room row is
   settled succeeded at the head of the queue WITHOUT being claimed (no
   attempt, no `started_at`, so nothing on the model budget's meter) and
   reaches no handler; a personal or agent row of the same type reaches its
   handler.
   Rows are inserted after the worker module loaded and drained like any
   other, so nothing here depends on a startup pass. */
const reached = vi.hoisted(() => [] as Array<{ handler: string; profileId?: string; inspirationId?: string }>);
vi.mock("./principle-generation.js", async (original) => ({
  ...(await original<typeof import("./principle-generation.js")>()),
  refreshPrinciplesForProfile: vi.fn(async (input: { profileId: string }) => {
    reached.push({ handler: "refresh_principles", profileId: input.profileId });
    return { status: "below_bar", minted: 0, attached: 0, conflicts: 0, redeemed: 0, dropped: 0 };
  }),
}));
vi.mock("./signal-gardener.js", async (original) => ({
  ...(await original<typeof import("./signal-gardener.js")>()),
  tendSignalGarden: vi.fn(async (_db: unknown, input: { profileId: string }) => {
    reached.push({ handler: "tend_signal_garden", profileId: input.profileId });
    return {};
  }),
}));
vi.mock("./signal-derivation.js", async (original) => ({
  ...(await original<typeof import("./signal-derivation.js")>()),
  deriveSignalsForInspiration: vi.fn(async (input: { inspirationId: string; supportOnly?: boolean }) => {
    reached.push({ handler: input.supportOnly ? "review_signal_support" : "derive_signals", inspirationId: input.inspirationId });
    return { status: "no_candidates", inspirationId: input.inspirationId, profileId: null, candidateCount: 0,
      matchedSignalIds: [], mintedSignalIds: [], promotedSignalIds: [] };
  }),
  reembedSignal: vi.fn(async (input: { profileId: string }) => {
    reached.push({ handler: "reembed_signal", profileId: input.profileId });
  }),
}));
vi.mock("./signal-support-batches.js", async (original) => ({
  ...(await original<typeof import("./signal-support-batches.js")>()),
  // Reached only after the payload parsed as well-formed and its source was
  // found; answering "not current" then drops it, which is a handler outcome.
  supportBatchInputsCurrent: vi.fn(async (_db: unknown, ownerProfileId: string, payload: { inspirationId: string }) => {
    reached.push({ handler: "assess_signal_support", profileId: ownerProfileId, inspirationId: payload.inspirationId });
    return false;
  }),
}));

import { sql } from "drizzle-orm";
import { runBackgroundJobWorker } from "./queue.js";
import { hasLegacyGroupDestination, isRetiredGroupWork, retiredGroupWork, withoutLegacyGroupDestination } from "./retired-group-work.js";
import { MODEL_BUDGET_JOBS_PER_ACCOUNT } from "./model-budget.js";

let t: TestDatabase;
let seq = 0;

beforeAll(async () => {
  t = await createTestDatabase();
  const url = new URL(process.env.DB_CONNECTION_URL!);
  url.searchParams.set("options", `-c search_path=${t.schemaName}`);
  process.env.DB_CONNECTION_URL = url.toString();
});
beforeEach(async () => {
  await t.truncateAll();
  reached.length = 0;
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); });
afterAll(async () => { await t?.cleanup(); });

const HASH = "a".repeat(64);
async function enqueue(profileId: string, type: string, payload: Record<string, unknown>) {
  const [job] = await t.sql`INSERT INTO background_jobs (profile_id, type, payload)
    VALUES (${profileId}, ${type}::background_job_type, ${JSON.stringify(payload)}::jsonb) RETURNING id`;
  return job.id as string;
}
const drain = () => runBackgroundJobWorker({ limit: 30, now: new Date(Date.now() + 1000) });

async function legacyGroup() {
  const [account] = await t.sql`INSERT INTO accounts (email) VALUES (${`retired-${++seq}@example.test`}) RETURNING id`;
  const [member] = await t.sql`INSERT INTO profiles (account_id, type, name) VALUES (${account.id}, 'human', 'Member') RETURNING id`;
  const [group] = await t.sql`INSERT INTO groups (name, join_code, created_by_profile_id)
    VALUES ('Legacy room', ${`retired-${seq}-${Math.random().toString(36).slice(2, 8)}`}, ${member.id}) RETURNING id`;
  const [mind] = await t.sql`INSERT INTO profiles (account_id, type, name, group_id) VALUES (NULL, 'group', 'Legacy room', ${group.id}) RETURNING id`;
  await t.sql`INSERT INTO group_members (group_id, profile_id, role) VALUES (${group.id}, ${member.id}, 'owner')`;
  const [source] = await t.sql`INSERT INTO inspirations (profile_id, text, visibility) VALUES (${member.id}, 'A public memory', 'public') RETURNING id`;
  const [signal] = await t.sql`INSERT INTO signals (profile_id, statement) VALUES (${member.id}, 'A claim') RETURNING id`;
  return { memberId: member.id as string, groupId: group.id as string, mindId: mind.id as string,
    sourceId: source.id as string, signalId: signal.id as string };
}
const assessPayload = (inspirationId: string, signalId: string, extra: Record<string, unknown> = {}) => ({
  inspirationId, signalIds: [signalId], materialRevision: "1", materialHash: HASH,
  statements: [{ id: signalId, revision: "1", hash: HASH }], ...extra,
});

it("settles every room-shaped job at the head, unclaimed, reaching no handler", async () => {
  const legacy = await legacyGroup();
  // a queue that has already drained once: the guard is per claim, not per process
  await drain();
  const ids = [
    await enqueue(legacy.memberId, "refresh_group_top_of_mind", { groupId: legacy.groupId, reason: "shares_changed" }),
    await enqueue(legacy.memberId, "derive_signals", { inspirationId: legacy.sourceId, reason: "created", deriveIntoProfileId: legacy.mindId }),
    await enqueue(legacy.memberId, "review_signal_support", { inspirationId: legacy.sourceId, deriveIntoProfileId: legacy.mindId }),
    await enqueue(legacy.memberId, "assess_signal_support",
      assessPayload(legacy.sourceId, legacy.signalId, { deriveIntoProfileId: legacy.mindId, membershipId: legacy.groupId })),
    await enqueue(legacy.memberId, "refresh_principles", { profileId: legacy.mindId }),
    // a mind's id in another case still names another profile
    await enqueue(legacy.memberId, "refresh_principles", { profileId: legacy.mindId.toUpperCase() }),
    // any job whose TENANT is the mind, whatever its type — known from the claim
    await enqueue(legacy.mindId, "refresh_principles", { profileId: legacy.mindId }),
    await enqueue(legacy.mindId, "tend_signal_garden", {}),
    await enqueue(legacy.mindId, "reembed_signal", { signalId: legacy.signalId }),
    await enqueue(legacy.mindId, "refresh_top_of_mind", { reason: "signals_changed" }),
  ];

  expect(await drain()).toMatchObject({ claimed: 0, succeeded: ids.length, failed: 0, retried: 0, deferred: 0 });
  for (const row of await t.sql`SELECT status::text, attempts, started_at, last_error FROM background_jobs`) {
    expect(row).toMatchObject({ status: "succeeded", attempts: 0, started_at: null, last_error: null });
  }
  expect(reached).toEqual([]);
  expect(await t.sql`SELECT id FROM top_of_minds`).toHaveLength(0);
});

it("never settles a personal or agent job of the same types as room work", async () => {
  /* One owner holds a room seat, the other is an agent: neither changes
     what its own jobs are. A blank `deriveIntoProfileId` is absent, as it is
     in the support-state SQL. */
  const legacy = await legacyGroup();
  const [account] = await t.sql`INSERT INTO accounts (email) VALUES (${`retired-agent-${++seq}@example.test`}) RETURNING id`;
  const [agent] = await t.sql`INSERT INTO profiles (account_id, type, name) VALUES (${account.id}, 'agent', 'Agent') RETURNING id`;
  const [agentSource] = await t.sql`INSERT INTO inspirations (profile_id, text) VALUES (${agent.id}, 'An agent note') RETURNING id`;
  const [agentSignal] = await t.sql`INSERT INTO signals (profile_id, statement) VALUES (${agent.id}, 'An agent claim') RETURNING id`;
  const owners = [
    { profileId: legacy.memberId, sourceId: legacy.sourceId, signalId: legacy.signalId },
    { profileId: agent.id as string, sourceId: agentSource.id as string, signalId: agentSignal.id as string },
  ];
  const expected: typeof reached = [];
  for (const owner of owners) {
    await enqueue(owner.profileId, "refresh_principles", { profileId: owner.profileId });
    await enqueue(owner.profileId, "tend_signal_garden", {});
    await enqueue(owner.profileId, "reembed_signal", { signalId: owner.signalId });
    await enqueue(owner.profileId, "derive_signals", { inspirationId: owner.sourceId, reason: "created", deriveIntoProfileId: "  " });
    await enqueue(owner.profileId, "review_signal_support", { inspirationId: owner.sourceId });
    // well-formed, including the legacy `membershipId: null` older rows carry
    await enqueue(owner.profileId, "assess_signal_support", assessPayload(owner.sourceId, owner.signalId, { membershipId: null }));
    expected.push(
      { handler: "refresh_principles", profileId: owner.profileId },
      { handler: "tend_signal_garden", profileId: owner.profileId },
      { handler: "reembed_signal", profileId: owner.profileId },
      { handler: "derive_signals", inspirationId: owner.sourceId },
      { handler: "review_signal_support", inspirationId: owner.sourceId },
      { handler: "assess_signal_support", profileId: owner.profileId, inspirationId: owner.sourceId },
    );
  }

  // The member's own principles named in upper case are still their own; the
  // agent's names no one (a non-string), so they run for the tenant.
  await t.sql`UPDATE background_jobs SET payload = jsonb_build_object('profileId', upper(profile_id::text))
    WHERE type = 'refresh_principles' AND profile_id = ${legacy.memberId}`;
  await t.sql`UPDATE background_jobs SET payload = '{"profileId": 7}'::jsonb
    WHERE type = 'refresh_principles' AND profile_id = ${agent.id}`;
  await drain();

  const key = (row: (typeof reached)[number]) => JSON.stringify([row.handler, row.profileId ?? null, row.inspirationId ?? null]);
  expect(reached.map(key).sort()).toEqual(expected.map(key).sort());
});

it("the worker's room test and the SQL filter agree on every destination shape", async () => {
  const shapes: Array<Record<string, unknown>> = [
    {}, { deriveIntoProfileId: null }, { deriveIntoProfileId: "" }, { deriveIntoProfileId: "  \t" },
    { deriveIntoProfileId: "1f0e4c1e-0000-4000-8000-000000000000" }, { deriveIntoProfileId: 7 },
    // not ASCII whitespace on either side, so a destination on both
    { deriveIntoProfileId: "\u00a0" }, { deriveIntoProfileId: " \u00a0 " },
  ];
  for (const payload of shapes) {
    const [row] = await t.db.execute<{ own: boolean }>(
      sql`SELECT ${withoutLegacyGroupDestination(sql`${JSON.stringify(payload)}::jsonb`)} AS own`);
    expect(row!.own, JSON.stringify(payload)).toBe(!hasLegacyGroupDestination(payload));
  }
});

it("room work neither spends nor is blocked by the model budget", async () => {
  const legacy = await legacyGroup();
  const recent = new Date(Date.now() - 60_000).toISOString();
  async function started(profileId: string, type: string, payload: Record<string, unknown>, count: number) {
    for (let i = 0; i < count; i++) {
      await t.sql`INSERT INTO background_jobs (profile_id, type, payload, status, started_at)
        VALUES (${profileId}, ${type}::background_job_type, ${JSON.stringify(payload)}::jsonb, 'succeeded', ${recent})`;
    }
  }
  // One start short of the cap with personal work, and room work that ran in
  // the window before the retirement: the room starts must not be counted.
  await started(legacy.memberId, "tend_signal_garden", {}, MODEL_BUDGET_JOBS_PER_ACCOUNT - 1);
  await started(legacy.memberId, "refresh_group_top_of_mind", { groupId: legacy.groupId, reason: "manual" }, 5);
  const retired = [
    await enqueue(legacy.memberId, "refresh_group_top_of_mind", { groupId: legacy.groupId, reason: "shares_changed" }),
    await enqueue(legacy.memberId, "derive_signals", { inspirationId: legacy.sourceId, reason: "created", deriveIntoProfileId: legacy.mindId }),
    await enqueue(legacy.memberId, "refresh_principles", { profileId: legacy.mindId }),
  ];
  const personal = await enqueue(legacy.memberId, "refresh_principles", { profileId: legacy.memberId });

  expect(await drain()).toMatchObject({ claimed: 1, succeeded: retired.length + 1, deferred: 0 });
  expect(reached).toEqual([{ handler: "refresh_principles", profileId: legacy.memberId }]);
  for (const id of retired) {
    expect((await t.sql`SELECT status::text, attempts, started_at FROM background_jobs WHERE id = ${id}`)[0])
      .toMatchObject({ status: "succeeded", attempts: 0, started_at: null });
  }
  expect((await t.sql`SELECT status::text FROM background_jobs WHERE id = ${personal}`)[0]!.status).toBe("succeeded");

  // Now at the cap: the personal job is deferred, the room rows still settle
  // where they stand and are not pushed back with the account's backlog.
  reached.length = 0;
  const later = await enqueue(legacy.memberId, "refresh_principles", { profileId: legacy.memberId });
  const retiredLater = await enqueue(legacy.memberId, "refresh_group_top_of_mind", { groupId: legacy.groupId, reason: "manual" });
  expect(await drain()).toMatchObject({ claimed: 0, succeeded: 1, deferred: 1 });
  expect(reached).toEqual([]);
  expect((await t.sql`SELECT status::text FROM background_jobs WHERE id = ${retiredLater}`)[0]!.status).toBe("succeeded");
  const [deferred] = await t.sql`SELECT status::text, run_after FROM background_jobs WHERE id = ${later}`;
  expect(deferred!.status).toBe("pending");
  expect(new Date(deferred!.run_after as string).getTime()).toBeGreaterThan(Date.now());
});

it("the worker's rule and the queue's SQL agree on what is retired room work", async () => {
  const legacy = await legacyGroup();
  const tenant = legacy.memberId;
  const cases: Array<{ type: string; profileId: string; payload: Record<string, unknown> }> = [
    { type: "refresh_group_top_of_mind", profileId: tenant, payload: {} },
    { type: "tend_signal_garden", profileId: legacy.mindId, payload: {} },
    { type: "tend_signal_garden", profileId: tenant, payload: {} },
    { type: "derive_signals", profileId: tenant, payload: { deriveIntoProfileId: legacy.mindId } },
    { type: "derive_signals", profileId: tenant, payload: { deriveIntoProfileId: " \t" } },
    { type: "refresh_top_of_mind", profileId: tenant, payload: { deriveIntoProfileId: legacy.mindId } },
    { type: "refresh_principles", profileId: tenant, payload: {} },
    { type: "refresh_principles", profileId: tenant, payload: { profileId: 7 } },
    { type: "refresh_principles", profileId: tenant, payload: { profileId: "   " } },
    { type: "refresh_principles", profileId: tenant, payload: { profileId: ` ${tenant.toUpperCase()}\n` } },
    { type: "refresh_principles", profileId: tenant, payload: { profileId: legacy.mindId } },
    { type: "refresh_principles", profileId: tenant, payload: { profileId: `\u00a0${tenant}` } },
  ];
  for (const job of cases) {
    const id = await enqueue(job.profileId, job.type, job.payload);
    const [row] = await t.db.execute<{ retired: boolean; group: boolean }>(sql`SELECT ${retiredGroupWork(sql`job`)} AS retired,
      EXISTS (SELECT 1 FROM profiles p WHERE p.id = job.profile_id AND p.type::text = 'group') AS "group"
      FROM background_jobs job WHERE job.id = ${id}::uuid`);
    expect(row!.retired, JSON.stringify(job)).toBe(isRetiredGroupWork({ ...job, tenantIsGroup: row!.group }));
  }
});
