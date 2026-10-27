import { approveReadingReview } from '../../test/helpers/top-of-mind-review.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "../../test/helpers/index.js";
import { setDefaultModelProviderForTests, type ModelProvider } from "./model-provider.js";
import { enqueueTopOfMindRefresh, postgresBackgroundJobStore, processBackgroundJob, runBackgroundJobWorker } from "./queue.js";
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
/* The `destinationId` / `owners` parameters went with the rooms (founder:
   "방 없애"). They existed so this helper could aim material at a room's mind
   and spread its evidence across two members; there is one destination now,
   the person, and one owner, the same person. */
async function material({ active = false } = {}) {
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) {
    const [signal] = await t.sql`INSERT INTO signals (profile_id, statement)
      VALUES (${profileId}, 'Small steps recur') RETURNING id`;
    ids.push(signal.id as string);
    for (let j = 0; j < (active ? 3 : 1); j++) {
      const [inspiration] = await t.sql`INSERT INTO inspirations (profile_id, text, visibility)
        VALUES (${profileId}, ${`An independent fixture ${i}-${j}`}, 'private') RETURNING id`;
      await t.sql`INSERT INTO signal_evidence (profile_id, owner_profile_id, signal_id, inspiration_id)
        VALUES (${profileId}, ${profileId}, ${signal.id}, ${inspiration.id})`;
    }
    if (active) await t.sql`UPDATE signals SET status = 'active' WHERE id = ${signal.id}`;
  }
  return ids;
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
    reviewTopOfMind: approveReadingReview, synthesizeTopOfMind: async (input: { signals: Array<{ id: string }> }) => {
      await beforeSynthesis?.();
      return noChange ? { noChange: true, entries: [] } : {
        entries: [{ type: "pattern", body: "You keep making room for small experiments.", citedSignalIds: input.signals.map(row => row.id) }],
      };
    },
  } as unknown as ModelProvider);
});
afterAll(async () => { setDefaultModelProviderForTests(null); await t?.cleanup(); });

describe("top of mind completion receipts", () => {
  /* ONE TARGET NOW, NOT TWO. This was `it.each(['group', 'principles'])`:
     the same lease argument run once against a room's synthesis and once
     against principles, because those were the two workers that could be
     reclaimed mid-generation. Founder: "방 없애" — the room arm stood up a
     room, a second member, a room's mind as the derivation destination and a
     `refresh_group_top_of_mind` row, and all four are gone. The principles
     arm is the whole test now. The ARGUMENT it carries is untouched: a worker
     whose lease was stolen while the provider was thinking must not persist
     what came back, however good it is. */
  it('a reclaimed principles worker cannot persist generated output', async () => {
    const ids = await material({ active: true });
    const [artifact] = await t.sql`INSERT INTO top_of_minds(profile_id) VALUES (${profileId}) RETURNING id`;
    const [entry] = await t.sql`INSERT INTO top_of_mind_entries(top_of_mind_id, type, body)
      VALUES (${artifact.id}, 'pattern', 'A current reading') RETURNING id`;
    for (const id of ids) await t.sql`INSERT INTO top_of_mind_entry_signals(entry_id, signal_id) VALUES (${entry.id}, ${id})`;
    const [job] = await t.sql`INSERT INTO background_jobs(profile_id, type, payload)
      VALUES (${profileId}, 'refresh_principles', ${JSON.stringify({ profileId })}::jsonb) RETURNING id`;
    const claimed = await postgresBackgroundJobStore.claimNext(new Date(Date.now() + 1000));
    expect(claimed?.id).toBe(job.id);
    const steal = async () => { await t.sql`UPDATE background_jobs SET locked_at = now() + interval '2 seconds', attempts = attempts + 1 WHERE id = ${job.id}`; };
    setDefaultModelProviderForTests({
      distillPrinciples: async () => { await steal(); return { candidates: [{ type: 'maxim', statement: 'A stale principle', citedSignalIds: ids }] }; },
    } as unknown as ModelProvider);
    await expect(processBackgroundJob(claimed!)).rejects.toThrow(/ownership changed/i);
    expect(await t.sql`SELECT id FROM top_of_minds`).toHaveLength(1);
    expect(await t.sql`SELECT id FROM principles`).toHaveLength(0);
  });
  it("a reclaimed job cannot commit an artifact even when its source inputs did not change", async () => {
    await material();
    const { jobId } = await enqueueTopOfMindRefresh(profileId, "manual");
    const claimed = await postgresBackgroundJobStore.claimNext(new Date(Date.now() + 1000));
    expect(claimed?.id).toBe(jobId);
    beforeSynthesis = async () => {
      await t.sql`UPDATE background_jobs SET locked_at = now() + interval '2 seconds', attempts = attempts + 1 WHERE id = ${jobId}`;
    };
    await expect(processBackgroundJob(claimed!)).rejects.toThrow(/ownership changed/i);
    expect(await t.sql`SELECT id FROM top_of_minds WHERE profile_id = ${profileId}`).toHaveLength(0);
    expect((await state(jobId))?.status).toBe("running");
  });
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

  it('retries rejected output without a success receipt or an empty replacement', async () => {
    const ids = await material();
    await enqueueTopOfMindRefresh(profileId, 'manual'); await drain();
    setDefaultModelProviderForTests({ reviewTopOfMind: approveReadingReview,
      synthesizeTopOfMind: async () => ({ noChange: false, entries: [{ type: 'pattern',
        body: 'An independent fixture 0-0', citedSignalIds: ids }] }),
    } as unknown as ModelProvider);
    const { jobId } = await enqueueTopOfMindRefresh(profileId, 'manual');
    await drain();
    expect(await state(jobId)).toMatchObject({ status: 'pending', result: null });
    expect(await t.sql`SELECT id FROM top_of_minds WHERE profile_id=${profileId}`).toHaveLength(1);
    const [job] = await t.sql`SELECT attempts,last_error FROM background_jobs WHERE id=${jobId}`;
    expect(job!.attempts).toBe(1);
    expect(job!.last_error).toContain('publication checks');
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
