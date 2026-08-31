/**
 * THE LOOP, PROVEN LIVE — goal: one-shift-a-day, Phase 4.
 *
 *     pnpm --filter @waka/api eval:pipeline
 *
 * The judge and extraction have benches; this is the LOOP's: real
 * inspirations through the real enqueue path, drained by the real worker
 * against the real model road, asserting the rows the canon promises —
 * because "signals are properly created and top of minds are properly
 * generated when new inspirations are added" (the founder's words) must be
 * a measurement, not an inference from unit tests with scripted providers.
 *
 * What one run proves, in order — the MACHINERY's promises, never model
 * variance (whether the distinct fourth capture mints its own signal is
 * extraction's business, priced by the extraction bench's two-pattern
 * cases; the count is logged here, never asserted — goal revision,
 * founder-approved 2026-08-31):
 *   1. Keeps derive: captures produce signals with evidence.
 *   2. Recurrence promotes: the shared pattern accumulates three witnesses
 *      and stands `active` — the db's own promotion guard on the real path.
 *   3. A top of mind is written whose entries cite only real signal ids,
 *      in the profile's language.
 *   4. The floor holds live: two more captures inside the day write NO new
 *      content version — the refresh sleeps to the exact opening moment.
 *   5. The floor releases: age the chain past a day and the held refresh
 *      runs and versions (content or honest no_change).
 *
 * Spend per run: ~15–25 model calls (extractions, judges, two syntheses)
 * plus embeddings — under $0.05 on the pinned road. Excluded from hermetic
 * runs; CI's credentialed step runs it, blocking; skips visibly without
 * keys (generation needs OPENROUTER or GEMINI; embeddings need GEMINI).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDatabase } from "./helpers/index.js";
import {
  enqueueDeriveSignals,
  runBackgroundJobWorker,
} from "../src/lib/queue.js";
import { TOP_OF_MIND_MIN_SHIFT_HOURS } from "../src/lib/top-of-mind-synthesis.js";

const HAS_KEYS = Boolean(
  process.env.GEMINI_API_KEY?.trim() &&
    (process.env.OPENROUTER_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim()),
);

const THEME = [
  "Skipped the gym again to finish someone else's urgent request. My own plans always lose to other people's urgency.",
  "I said yes to three favors today while my own morning writing went undone. Other people's asks keep outranking my own work.",
  "Blocked my calendar for deep work, then gave the slot away the moment a colleague pinged. I protect everyone's time except my own.",
];
const APART =
  "The long walk untangled the pricing question again — moving is how my stuck problems come loose.";
const LATER = [
  "Read two chapters before bed instead of scrolling, and slept better for it — evenings shaped by paper instead of feeds.",
  "Again last night: a book in hand, the phone in the drawer, and the morning after felt clearer.",
];

let t: TestDatabase;

/** Drain with a clock a second ahead (enqueue stamps run_after from the DB
    clock; a same-process JS clock can trail it), repeatedly until quiet —
    derivations enqueue syntheses, so one pass is never the whole story. */
async function drainUntilQuiet(maxPasses = 12): Promise<{ held: number }> {
  let held = 0;
  for (let i = 0; i < maxPasses; i += 1) {
    const pass = await runBackgroundJobWorker({
      limit: 25,
      now: new Date(Date.now() + 1000),
    });
    held += pass.held;
    if (pass.claimed === 0) break;
  }
  return { held };
}

async function keep(profileId: string, text: string): Promise<void> {
  const [row] = await t.sql`
    INSERT INTO inspirations (profile_id, text) VALUES (${profileId}, ${text}) RETURNING id`;
  await enqueueDeriveSignals(profileId, row.id as string, "created");
}

const contentVersions = async (profileId: string) =>
  t.sql`
    SELECT id, reason, created_at FROM top_of_minds
    WHERE profile_id = ${profileId} AND reason != 'no_change'
    ORDER BY created_at`;

beforeAll(async () => {
  t = await createTestDatabase();
  const url = new URL(process.env.DB_CONNECTION_URL!);
  url.searchParams.set("options", `-c search_path=${t.schemaName}`);
  process.env.DB_CONNECTION_URL = url.toString();
});

afterAll(async () => {
  await t?.cleanup();
});

describe.skipIf(!HAS_KEYS)("the pipeline, live", () => {
  it(
    "keeps become signals, recurrence promotes, a top of mind is written, and the floor holds",
    { timeout: 420_000 },
    async () => {
      await t.truncateAll();
      const [account] = await t.sql`
        INSERT INTO accounts (email) VALUES ('pipeline-eval@example.test') RETURNING id`;
      const [profile] = await t.sql`
        INSERT INTO profiles (account_id, type, name)
        VALUES (${account.id}, 'human', 'Eval') RETURNING id`;
      const profileId = profile.id as string;

      // ---- 1 + 2: four keeps through the real road ----
      for (const text of [...THEME, APART]) await keep(profileId, text);
      await drainUntilQuiet();

      const signals = await t.sql`
        SELECT id, statement, status FROM signals WHERE profile_id = ${profileId}`;
      console.log(
        "[pipeline-eval] signals:",
        signals.map((s) => `${s.status}: ${s.statement}`).join(" | "),
      );
      expect(signals.length, "the captures produced signals").toBeGreaterThanOrEqual(1);
      /* breadth is logged, not gated — extraction variance is the extraction
         bench's to price (goal one-shift-a-day, Phase 4 revision) */
      console.log(`[pipeline-eval] distinct signals: ${signals.length}`);

      const evidence = await t.sql`
        SELECT signal_id, count(*)::int AS n FROM signal_evidence
        WHERE profile_id = ${profileId} GROUP BY signal_id ORDER BY n DESC`;
      expect(Number(evidence[0]?.n ?? 0), "recurrence accumulated").toBeGreaterThanOrEqual(3);

      const active = signals.filter((s) => s.status === "active");
      expect(active.length, "three witnesses promoted the shared pattern").toBeGreaterThanOrEqual(
        1,
      );

      // ---- 3: the artifact, citing real signals, in the profile's language ----
      const versions = await contentVersions(profileId);
      expect(versions.length, "a top of mind was written").toBeGreaterThanOrEqual(1);
      const entries = await t.sql`
        SELECT e.id, e.body FROM top_of_mind_entries e
        JOIN top_of_minds v ON v.id = e.top_of_mind_id
        WHERE v.id = ${versions[versions.length - 1]!.id}`;
      expect(entries.length).toBeGreaterThanOrEqual(1);
      console.log("[pipeline-eval] board:", entries.map((e) => e.body).join(" | "));
      for (const entry of entries) {
        expect(/[가-힣]/.test(entry.body as string), "en profile speaks English").toBe(false);
      }
      const signalIds = new Set(signals.map((s) => s.id as string));
      const cited = await t.sql`
        SELECT es.signal_id FROM top_of_mind_entry_signals es
        JOIN top_of_mind_entries e ON e.id = es.entry_id
        JOIN top_of_minds v ON v.id = e.top_of_mind_id
        WHERE v.profile_id = ${profileId} AND es.signal_id IS NOT NULL`;
      expect(cited.length, "entries cite their grounds").toBeGreaterThanOrEqual(1);
      for (const row of cited) {
        expect(signalIds.has(row.signal_id as string), "no invented citation").toBe(true);
      }
      const versionsBefore = versions.length;

      // ---- 4: the floor holds live ----
      for (const text of LATER) await keep(profileId, text);
      const drained = await drainUntilQuiet();
      /* diagnosability before judgment: when this step fails, the job table
         says WHY — later derivations that died on a bad road (visible as
         failed derive rows since the failure-honesty change) are a provider
         problem, not a floor problem, and the two must never be confused
         in a gate verdict again */
      const jobLedger = await t.sql`
        SELECT type, status, count(*)::int AS n, max(left(last_error, 90)) AS sample_error
        FROM background_jobs WHERE profile_id = ${profileId}
        GROUP BY type, status ORDER BY type, status`;
      console.log("[pipeline-eval] job ledger:", JSON.stringify(jobLedger));
      expect(drained.held, "the early shift was held, not run").toBeGreaterThanOrEqual(1);
      expect(
        (await contentVersions(profileId)).length,
        "no content shift inside the day",
      ).toBe(versionsBefore);
      const [sleeping] = await t.sql`
        SELECT run_after FROM background_jobs
        WHERE profile_id = ${profileId} AND type = 'refresh_top_of_mind'
          AND status = 'pending'`;
      expect(sleeping, "the refresh sleeps").toBeDefined();
      const lastShift = new Date(
        (await contentVersions(profileId))[versionsBefore - 1]!.created_at as string,
      );
      expect(new Date(sleeping!.run_after as string).getTime()).toBe(
        lastShift.getTime() + TOP_OF_MIND_MIN_SHIFT_HOURS * 60 * 60 * 1000,
      );

      // ---- 5: the floor releases ----
      // The machinery's guarantee is that the held refresh RUNS once the
      // floor opens — whether the board then moves is the model's honest
      // call (`noChange` is a legal, versioned answer; run 2 of this eval
      // answered exactly that). So the assertions are: the sleeper ran
      // (a new VERSION row of any reason exists), and nothing is left
      // sleeping.
      const allVersionsBefore = (
        await t.sql`SELECT count(*)::int AS n FROM top_of_minds WHERE profile_id = ${profileId}`
      )[0]!.n as number;
      await t.sql`
        UPDATE top_of_minds SET created_at = created_at - interval '25 hours'
        WHERE profile_id = ${profileId}`;
      await t.sql`
        UPDATE background_jobs SET run_after = now() - interval '1 hour'
        WHERE profile_id = ${profileId} AND type = 'refresh_top_of_mind' AND status = 'pending'`;
      await drainUntilQuiet();
      const allVersionsAfter = (
        await t.sql`SELECT count(*)::int AS n FROM top_of_minds WHERE profile_id = ${profileId}`
      )[0]!.n as number;
      expect(
        Number(allVersionsAfter),
        "the released refresh ran and versioned (content or honest no_change)",
      ).toBeGreaterThanOrEqual(Number(allVersionsBefore) + 1);
      const stillSleeping = await t.sql`
        SELECT id FROM background_jobs
        WHERE profile_id = ${profileId} AND type = 'refresh_top_of_mind' AND status = 'pending'`;
      expect(stillSleeping, "nothing left sleeping past its floor").toHaveLength(0);
    },
  );
});
