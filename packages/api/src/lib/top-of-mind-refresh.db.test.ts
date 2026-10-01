import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "../../test/helpers/index.js";
import { setDefaultModelProviderForTests, type ModelProvider } from "./model-provider.js";
import { enqueueTopOfMindRefresh, postgresBackgroundJobStore, runBackgroundJobWorker } from "./queue.js";
import { loadTopOfMindRefreshStatus } from "./top-of-mind-refresh-status.js";
import { ShiftFloorHeldError } from "./top-of-mind-synthesis.js";

let t: TestDatabase;
let seq = 0;
let profileId: string;
let beforeSynthesis: (() => Promise<void>) | null = null;
let noChange = false;
const drain = () => runBackgroundJobWorker({ limit: 1, now: new Date(Date.now() + 1000) });

async function person() {
  const [a] = await t.sql`INSERT INTO accounts (email) VALUES (${`read-receipt-${++seq}@example.test`}) RETURNING id`;
  const [p] = await t.sql`INSERT INTO profiles (account_id, type, name) VALUES (${a.id}, 'human', 'Owner') RETURNING id`;
  return p.id as string;
}
async function material() {
  for (let i = 0; i < 3; i++) {
    const [inspiration] = await t.sql`INSERT INTO inspirations (profile_id, text) VALUES (${profileId}, 'A public fixture') RETURNING id`;
    const [signal] = await t.sql`INSERT INTO signals (profile_id, statement) VALUES (${profileId}, 'Small steps recur') RETURNING id`;
    await t.sql`INSERT INTO signal_evidence (profile_id, owner_profile_id, signal_id, inspiration_id)
      VALUES (${profileId}, ${profileId}, ${signal.id}, ${inspiration.id})`;
  }
}
const state = (jobId: string) => loadTopOfMindRefreshStatus(t.db as never, profileId, jobId);

beforeAll(async () => {
  t = await createTestDatabase();
  const url = new URL(process.env.DB_CONNECTION_URL!);
  url.searchParams.set("options", `-c search_path=${t.schemaName}`);
  process.env.DB_CONNECTION_URL = url.toString();
});
beforeEach(async () => {
  await t.truncateAll();
  profileId = await person(); noChange = false; beforeSynthesis = null;
  setDefaultModelProviderForTests({
    synthesizeTopOfMind: async (input: { signals: Array<{ id: string }> }) => {
      await beforeSynthesis?.();
      return noChange ? { noChange: true, entries: [] } : {
        entries: [{ type: "pattern", body: "You keep making room for small experiments.", citedSignalIds: [input.signals[0]!.id] }],
      };
    },
  } as unknown as ModelProvider);
});
afterAll(async () => { setDefaultModelProviderForTests(null); await t?.cleanup(); });

describe("top of mind completion receipts", () => {
  it("exposes a completed artifact only after the worker finishes", async () => {
    await material();
    const { jobId } = await enqueueTopOfMindRefresh(profileId, "manual");
    expect(await state(jobId)).toMatchObject({ status: "pending", result: null });
    expect((await drain()).succeeded).toBe(1);
    const [artifact] = await t.sql`SELECT id, version FROM top_of_minds WHERE profile_id = ${profileId} AND status = 'live'`;
    expect(await state(jobId)).toMatchObject({ status: "succeeded", result: {
      outcome: "changed", topOfMindId: artifact.id, version: artifact.version,
    } });
  });

  it("keeps unchanged wording when the provider returns noChange with no entries", async () => {
    await material();
    await enqueueTopOfMindRefresh(profileId, "manual"); await drain();
    noChange = true;
    const { jobId } = await enqueueTopOfMindRefresh(profileId, "manual"); await drain();
    expect(await state(jobId)).toMatchObject({ status: "succeeded", result: { outcome: "unchanged", version: 2 } });
    const entries = await t.sql`SELECT e.body FROM top_of_mind_entries e JOIN top_of_minds m ON m.id = e.top_of_mind_id
      WHERE m.profile_id = ${profileId} AND m.status = 'live'`;
    expect(entries.map((row) => row.body)).toEqual(["You keep making room for small experiments."]);
  });

  it("separates empty completion from failure and legacy unknown completion", async () => {
    const { jobId } = await enqueueTopOfMindRefresh(profileId, "manual"); await drain();
    expect(await state(jobId)).toMatchObject({ status: "succeeded", result: { outcome: "empty", topOfMindId: null, version: 0 } });
    await t.sql`UPDATE background_jobs SET result = NULL WHERE id = ${jobId}`;
    expect(await state(jobId)).toMatchObject({ status: "unknown", result: null });
    await t.sql`UPDATE background_jobs SET status = 'failed', last_error = 'PRIVATE provider text' WHERE id = ${jobId}`;
    expect(await state(jobId)).toMatchObject({ status: "failed", result: null });
    expect(JSON.stringify(await state(jobId))).not.toContain("PRIVATE");
    await t.sql`UPDATE background_jobs SET status = 'succeeded', result =
      ${JSON.stringify({ kind: "top_of_mind", topOfMindId: null, version: 0, outcome: "empty", private: "PRIVATE payload" })}::jsonb WHERE id = ${jobId}`;
    expect(JSON.stringify(await state(jobId))).not.toContain("PRIVATE");
    await t.sql`UPDATE background_jobs SET result = ${JSON.stringify({ kind: "top_of_mind", topOfMindId: null, version: 4, outcome: "changed" })}::jsonb WHERE id = ${jobId}`;
    expect(await state(jobId)).toMatchObject({ status: "unknown", result: null });
  });

  it("does not expose another profile's job or a different job type", async () => {
    const { jobId } = await enqueueTopOfMindRefresh(profileId, "manual");
    expect(await loadTopOfMindRefreshStatus(t.db as never, await person(), jobId)).toBeNull();
    await t.sql`UPDATE background_jobs SET type = 'derive_signals' WHERE id = ${jobId}`;
    expect(await state(jobId)).toBeNull();
  });

  it("does not acknowledge a newer request with the first pass's result", async () => {
    await material();
    const { jobId } = await enqueueTopOfMindRefresh(profileId, "manual");
    beforeSynthesis = async () => { await enqueueTopOfMindRefresh(profileId, "manual"); };
    await drain();
    expect(await state(jobId)).toMatchObject({ status: "pending", result: null });
    beforeSynthesis = null;
    await drain();
    expect(await state(jobId)).toMatchObject({ status: "succeeded", result: { version: 2 } });
  });

  it("does not let an automatic trailing request inherit manual floor bypass", async () => {
    await material();
    const { jobId } = await enqueueTopOfMindRefresh(profileId, "manual");
    beforeSynthesis = async () => { await enqueueTopOfMindRefresh(profileId, "signals_changed"); };
    await drain(); beforeSynthesis = null;
    expect((await drain()).held).toBe(1);
    expect(await state(jobId)).toMatchObject({ status: "pending", result: null });
    expect(await t.sql`SELECT id FROM top_of_minds WHERE profile_id = ${profileId}`).toHaveLength(1);
  });

  it("keeps a manual request awake if it arrives while the old pass is being held", async () => {
    await material();
    await enqueueTopOfMindRefresh(profileId, "manual"); await drain();
    const { jobId } = await enqueueTopOfMindRefresh(profileId, "signals_changed");
    await runBackgroundJobWorker({ limit: 1, now: new Date(Date.now() + 1000), processor: async () => {
      await enqueueTopOfMindRefresh(profileId, "manual");
      throw new ShiftFloorHeldError(new Date(Date.now() + 86_400_000));
    } });
    expect((await drain()).succeeded).toBe(1);
    expect(await state(jobId)).toMatchObject({ status: "succeeded", result: { version: 2 } });
  });

  it("rejects completion, failure and hold writes from a worker that lost its lease", async () => {
    const { jobId } = await enqueueTopOfMindRefresh(profileId, "manual");
    const claimed = await postgresBackgroundJobStore.claimNext(new Date(Date.now() + 1000));
    expect(claimed?.id).toBe(jobId);
    await t.sql`UPDATE background_jobs SET locked_at = locked_at + interval '1 second', attempts = attempts + 1 WHERE id = ${jobId}`;
    expect(await postgresBackgroundJobStore.markSucceeded(claimed!, { kind: "top_of_mind", topOfMindId: null, version: 0, outcome: "empty" })).toBe(false);
    await postgresBackgroundJobStore.markFailedOrPending(claimed!, new Error("stale"), true, new Date());
    await postgresBackgroundJobStore.holdJob(claimed!, new Date(Date.now() + 86_400_000));
    expect(await state(jobId)).toMatchObject({ status: "running", result: null });
  });
});
