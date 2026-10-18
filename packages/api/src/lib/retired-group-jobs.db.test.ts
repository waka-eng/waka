import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createTestDatabase, type TestDatabase } from "../../test/helpers/index.js";

/* THE ROOM ENGINE IS RETIRED, AND WORK QUEUED BEFORE THAT MUST NOT WAKE IT.
   Rows of every room shape were enqueued in dev and prod while rooms were
   live. The worker settles them as done without running anything and
   without throwing, which would have burned three attempts into a `failed`
   row per room. The enum value `refresh_group_top_of_mind` is kept (an
   ALTER TYPE is a migration).

   Every handler a room-shaped row could otherwise reach is replaced by a
   recorder, so both directions are observed as behaviour: a room row ends
   succeeded — by the bulk sweep (with its `last_error` note) or by the
   in-handler guard (claimed, settled, no note) — and reaches no handler; a
   personal or agent row of the same type reaches its handler and is never
   touched by either. */
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
import { RETIRED_GROUP_JOB_NOTE, runBackgroundJobWorker, settleRetiredGroupBacklog } from "./queue.js";
import { hasLegacyGroupDestination, withoutLegacyGroupDestination } from "./retired-group-work.js";

let t: TestDatabase;
let seq = 0;

beforeAll(async () => {
  t = await createTestDatabase();
  const url = new URL(process.env.DB_CONNECTION_URL!);
  url.searchParams.set("options", `-c search_path=${t.schemaName}`);
  process.env.DB_CONNECTION_URL = url.toString();
  // The worker sweeps the backlog once per process, before its first drain.
  // Spend that once here, on an empty queue, so each case below chooses its
  // path explicitly: the sweep by calling it, the guard by draining.
  await t.truncateAll();
  await runBackgroundJobWorker({ limit: 1 });
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

it("the backlog sweep settles every queued room-shaped job, reaching no handler", async () => {
  const legacy = await legacyGroup();
  const ids = [
    await enqueue(legacy.memberId, "refresh_group_top_of_mind", { groupId: legacy.groupId, reason: "shares_changed" }),
    await enqueue(legacy.memberId, "derive_signals", { inspirationId: legacy.sourceId, reason: "created", deriveIntoProfileId: legacy.mindId }),
    await enqueue(legacy.memberId, "review_signal_support", { inspirationId: legacy.sourceId, deriveIntoProfileId: legacy.mindId }),
    await enqueue(legacy.memberId, "assess_signal_support",
      assessPayload(legacy.sourceId, legacy.signalId, { deriveIntoProfileId: legacy.mindId, membershipId: legacy.groupId })),
    await enqueue(legacy.memberId, "refresh_principles", { profileId: legacy.mindId }),
    // any job whose tenant is the mind, whatever its type
    await enqueue(legacy.mindId, "refresh_principles", { profileId: legacy.mindId }),
    await enqueue(legacy.mindId, "tend_signal_garden", {}),
    await enqueue(legacy.mindId, "refresh_top_of_mind", { reason: "signals_changed" }),
  ];

  // a live lease is its worker's; a stale one is the sweep's
  const live = await enqueue(legacy.mindId, "tend_signal_garden", {});
  await t.sql`UPDATE background_jobs SET status = 'running', locked_at = now() WHERE id = ${live}`;
  const stale = await enqueue(legacy.mindId, "tend_signal_garden", {});
  await t.sql`UPDATE background_jobs SET status = 'running', locked_at = now() - interval '1 day' WHERE id = ${stale}`;

  expect(await settleRetiredGroupBacklog(t.db as never)).toBe(ids.length + 1);

  const rows = await t.sql`SELECT id, status::text, last_error FROM background_jobs`;
  for (const row of rows.filter((row) => row.id !== live)) {
    expect(row).toMatchObject({ status: "succeeded", last_error: RETIRED_GROUP_JOB_NOTE });
  }
  expect(rows.find((row) => row.id === live)).toMatchObject({ status: "running", last_error: null });
  expect(await drain()).toMatchObject({ claimed: 0 });
  expect(reached).toEqual([]);
});

it("the in-handler guard settles room rows the sweep has not seen, with no query and no handler", async () => {
  const legacy = await legacyGroup();
  const ids = [
    await enqueue(legacy.memberId, "refresh_group_top_of_mind", { groupId: legacy.groupId, reason: "manual" }),
    await enqueue(legacy.memberId, "derive_signals", { inspirationId: legacy.sourceId, reason: "edited", deriveIntoProfileId: legacy.mindId }),
    // a mind's id in another case still names another profile
    await enqueue(legacy.memberId, "refresh_principles", { profileId: legacy.mindId.toUpperCase() }),
  ];

  expect(await drain()).toMatchObject({ claimed: ids.length, succeeded: ids.length, failed: 0, retried: 0 });
  for (const row of await t.sql`SELECT status::text, attempts, last_error FROM background_jobs`) {
    expect(row).toMatchObject({ status: "succeeded", attempts: 1, last_error: null });
  }
  expect(reached).toEqual([]);
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
    await enqueue(owner.profileId, "derive_signals", { inspirationId: owner.sourceId, reason: "created", deriveIntoProfileId: "  " });
    await enqueue(owner.profileId, "review_signal_support", { inspirationId: owner.sourceId });
    // well-formed, including the legacy `membershipId: null` older rows carry
    await enqueue(owner.profileId, "assess_signal_support", assessPayload(owner.sourceId, owner.signalId, { membershipId: null }));
    expected.push(
      { handler: "refresh_principles", profileId: owner.profileId },
      { handler: "tend_signal_garden", profileId: owner.profileId },
      { handler: "derive_signals", inspirationId: owner.sourceId },
      { handler: "review_signal_support", inspirationId: owner.sourceId },
      { handler: "assess_signal_support", profileId: owner.profileId, inspirationId: owner.sourceId },
    );
  }

  // the member's own principles, named in upper case, are still their own
  await t.sql`UPDATE background_jobs SET payload = jsonb_build_object('profileId', upper(profile_id::text))
    WHERE type = 'refresh_principles' AND profile_id = ${legacy.memberId}`;
  expect(await settleRetiredGroupBacklog(t.db as never)).toBe(0);
  await drain();

  expect(await t.sql`SELECT id FROM background_jobs WHERE last_error = ${RETIRED_GROUP_JOB_NOTE}`).toHaveLength(0);
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
