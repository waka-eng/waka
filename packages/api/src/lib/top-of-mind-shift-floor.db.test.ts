/**
 * THE BOARD SHIFTS AT MOST ONCE A DAY — goal: one-shift-a-day, Phase 2.
 *
 * Four claims, each a behavior the founder named:
 *   (i)  a second `signals_changed` refresh inside the floor writes NO
 *        version, and its row goes back to sleep until exactly
 *        lastShift + TOP_OF_MIND_MIN_SHIFT_HOURS — held, never failed,
 *        the claim's attempt handed back;
 *   (ii) `manual` never waits — the person's own "Read it again" and a
 *        language change version immediately, floor or no floor;
 *   (iii) an aged floor releases: once the content version is older than
 *        the floor, the sleeping row runs on the next drain and versions;
 *   (iv) enqueues during a hold collapse into the held row without pulling
 *        its `run_after` earlier — the debounce and the floor compose.
 *
 * WHAT THIS MOCKS, AND WHY: the model provider — a scripted synthesis,
 * because the subject is the queue's arithmetic around the call, not the
 * call. The queue, the jobs table, and the version chain are real; every
 * claim is read back from rows.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDatabase } from "../../test/helpers/index.js";
import { setDefaultModelProviderForTests } from "./model-provider.js";
import type { ModelProvider } from "./model-provider.js";
import { enqueueTopOfMindRefresh, runBackgroundJobWorker } from "./queue.js";
import { TOP_OF_MIND_MIN_SHIFT_HOURS } from "./top-of-mind-synthesis.js";

let t: TestDatabase;
let seq = 0;

const HOUR_MS = 60 * 60 * 1000;

/** Drain with a clock a second ahead: enqueue stamps `run_after` from the
    DATABASE clock, and in a same-process test the JS clock can trail it by
    more than the microseconds between enqueue and drain. Production never
    sees this — wake latency dwarfs the skew. */
const drain = () => runBackgroundJobWorker({ limit: 10, now: new Date(Date.now() + 1000) });

async function seedProfile(): Promise<string> {
  seq += 1;
  const [account] = await t.sql`
    INSERT INTO accounts (email) VALUES (${`floor-${seq}@example.test`}) RETURNING id`;
  const [p] = await t.sql`
    INSERT INTO profiles (account_id, type, name)
    VALUES (${account.id}, 'human', 'Owner') RETURNING id`;
  return p.id as string;
}

/** Three emerging signals with one evidence each — enough for the cold-start
    selection to speak, no promotion machinery needed. */
async function seedSignals(profileId: string): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < 3; i += 1) {
    const [insp] = await t.sql`
      INSERT INTO inspirations (profile_id, text)
      VALUES (${profileId}, ${`floor witness ${i}`}) RETURNING id`;
    const [sig] = await t.sql`
      INSERT INTO signals (profile_id, statement, status, confidence)
      VALUES (${profileId}, ${`floor pattern ${i}`}, 'emerging', 0) RETURNING id`;
    await t.sql`
      INSERT INTO signal_evidence (profile_id, owner_profile_id, signal_id, inspiration_id)
      VALUES (${profileId}, ${profileId}, ${sig.id}, ${insp.id})`;
    ids.push(sig.id as string);
  }
  return ids;
}

/** A synthesis that always proposes ONE fresh entry citing the first given
    signal — every un-held refresh is a content shift, which is exactly what
    the floor must contain. */
function scriptedSynthesis(signalIds: () => string[]): ModelProvider {
  let n = 0;
  const refuse = () => {
    throw new Error("not this suite's task");
  };
  return {
    name: "scripted",
    async synthesizeTopOfMind() {
      n += 1;
      return {
        noChange: false,
        entries: [
          {
            type: "pattern",
            body: `the board as of pass ${n}`,
            belief: null,
            prompt: null,
            citedSignalIds: [signalIds()[0]!],
          },
        ],
      };
    },
    extractSignalCandidates: refuse,
    judgeSignalMatch: refuse,
    distillPrinciples: refuse,
    judgePrincipleRelation: refuse,
    routeDeclaration: refuse,
  } as unknown as ModelProvider;
}

const contentVersions = async (profileId: string) =>
  t.sql`
    SELECT id, reason, created_at FROM top_of_minds
    WHERE profile_id = ${profileId} AND reason != 'no_change'
    ORDER BY created_at`;

const refreshJobRow = async (profileId: string) =>
  (
    await t.sql`
      SELECT status, attempts, run_after, last_error FROM background_jobs
      WHERE profile_id = ${profileId} AND type = 'refresh_top_of_mind'
      ORDER BY created_at DESC LIMIT 1`
  )[0];

beforeAll(async () => {
  t = await createTestDatabase();
  const url = new URL(process.env.DB_CONNECTION_URL!);
  url.searchParams.set("options", `-c search_path=${t.schemaName}`);
  process.env.DB_CONNECTION_URL = url.toString();
});

afterAll(async () => {
  setDefaultModelProviderForTests(null);
  await t?.cleanup();
});

describe("the shift floor", () => {
  let signalIds: string[] = [];

  beforeEach(async () => {
    await t.truncateAll();
    signalIds = [];
    setDefaultModelProviderForTests(scriptedSynthesis(() => signalIds));
  });

  it("(i) holds the second automatic shift and sleeps to the exact opening moment; (iv) later enqueues collapse in", async () => {
    const profileId = await seedProfile();
    signalIds = await seedSignals(profileId);

    // First shift: no content version exists, the cold start is exempt.
    await enqueueTopOfMindRefresh(profileId, "signals_changed");
    const first = await drain();
    expect(first.succeeded).toBe(1);
    const afterFirst = await contentVersions(profileId);
    expect(afterFirst).toHaveLength(1);
    const shiftAt = new Date(afterFirst[0]!.created_at as string);

    // Second automatic refresh, minutes later: the floor holds.
    await enqueueTopOfMindRefresh(profileId, "signals_changed");
    const second = await drain();
    expect(second.held, "held, never failed").toBe(1);
    expect(second.failed).toBe(0);
    expect(second.retried).toBe(0);

    expect(await contentVersions(profileId), "no version was written").toHaveLength(1);
    const row = await refreshJobRow(profileId);
    expect(row!.status).toBe("pending");
    expect(row!.last_error, "a hold records no error").toBeNull();
    expect(Number(row!.attempts), "the claim's attempt is handed back").toBe(0);
    const runAfter = new Date(row!.run_after as string);
    expect(runAfter.getTime()).toBe(shiftAt.getTime() + TOP_OF_MIND_MIN_SHIFT_HOURS * HOUR_MS);

    // (iv) a burst during the hold collapses into the sleeping row.
    await enqueueTopOfMindRefresh(profileId, "signals_changed");
    await enqueueTopOfMindRefresh(profileId, "signals_changed");
    const rows = await t.sql`
      SELECT run_after FROM background_jobs
      WHERE profile_id = ${profileId} AND type = 'refresh_top_of_mind'
        AND status = 'pending'`;
    expect(rows, "one sleeping row, not three").toHaveLength(1);
    expect(new Date(rows[0]!.run_after as string).getTime(), "run_after never moves earlier").toBe(
      runAfter.getTime(),
    );

    // And the sleeping row is not claimable now.
    const idle = await drain();
    expect(idle.claimed).toBe(0);
  });

  it("(ii) the person never waits: manual versions straight through the floor", async () => {
    const profileId = await seedProfile();
    signalIds = await seedSignals(profileId);

    await enqueueTopOfMindRefresh(profileId, "signals_changed");
    await drain();
    expect(await contentVersions(profileId)).toHaveLength(1);

    await enqueueTopOfMindRefresh(profileId, "manual");
    const manual = await drain();
    expect(manual.succeeded).toBe(1);
    expect(manual.held).toBe(0);
    expect(await contentVersions(profileId), "the manual shift landed").toHaveLength(2);
  });

  it("a manual request wakes an already-held automatic job", async () => {
    const profileId = await seedProfile();
    signalIds = await seedSignals(profileId);
    await enqueueTopOfMindRefresh(profileId, "signals_changed");
    await drain();
    const automatic = await enqueueTopOfMindRefresh(profileId, "signals_changed");
    expect((await drain()).held).toBe(1);
    const manual = await enqueueTopOfMindRefresh(profileId, "manual");
    expect(manual.jobId).toBe(automatic.jobId);
    const result = await drain();
    expect(result.succeeded).toBe(1);
    expect(result.held).toBe(0);
    expect(await contentVersions(profileId)).toHaveLength(2);
  });

  it("(iii) an aged floor releases on the next drain", async () => {
    const profileId = await seedProfile();
    signalIds = await seedSignals(profileId);

    await enqueueTopOfMindRefresh(profileId, "signals_changed");
    await drain();
    await enqueueTopOfMindRefresh(profileId, "signals_changed");
    const held = await drain();
    expect(held.held).toBe(1);

    // A day passes: age both the version chain and the sleeping row's clock.
    await t.sql`
      UPDATE top_of_minds SET created_at = created_at - interval '25 hours'
      WHERE profile_id = ${profileId}`;
    await t.sql`
      UPDATE background_jobs SET run_after = now() - interval '1 hour'
      WHERE profile_id = ${profileId} AND type = 'refresh_top_of_mind'`;

    const released = await drain();
    expect(released.succeeded).toBe(1);
    expect(released.held).toBe(0);
    expect(await contentVersions(profileId), "the deferred shift landed").toHaveLength(2);
  });
});
