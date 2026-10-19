/** Dismissing a claim is one atomic act that also reconciles principles — real SQL, no model. */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createTestDatabase, type TestDatabase } from "../../test/helpers/index.js";
import { getDb } from "../lib/db.js";
import { dismissProfileSignal } from "./signals.js";

let t: TestDatabase;
let sequence = 0;

async function person() {
  const [a] = await t.sql`INSERT INTO accounts(email) VALUES (${`signal-dismiss-${sequence++}@example.test`}) RETURNING id`;
  const [p] = await t.sql`INSERT INTO profiles(account_id,type,name) VALUES (${a.id},'human','Test') RETURNING id`;
  return p.id as string;
}

/** Three active, evidenced signals and a principle citing all of them. */
async function principleOnThreeSignals(profileId: string, locked: boolean) {
  const ids: string[] = [];
  for (let n = 0; n < 3; n++) {
    const [s] = await t.sql`INSERT INTO signals(profile_id,statement) VALUES (${profileId},${`Pattern ${n}`}) RETURNING id`;
    for (let i = 0; i < 3; i++) {
      const [ins] = await t.sql`INSERT INTO inspirations(profile_id,text) VALUES (${profileId},'raw') RETURNING id`;
      await t.sql`INSERT INTO signal_evidence(profile_id,owner_profile_id,signal_id,inspiration_id)
        VALUES (${profileId},${profileId},${s.id},${ins.id})`;
    }
    await t.sql`UPDATE signals SET status='active' WHERE id=${s.id}`;
    ids.push(s.id as string);
  }
  const [p] = await t.sql`INSERT INTO principles(profile_id, statement, state, origin, rank, locked_at, held_since)
    VALUES (${profileId}, 'Prefer small, reversible experiments.', 'held', 'minted', 1,
      CASE WHEN ${locked} THEN now() END, now()) RETURNING id`;
  for (const id of ids) {
    await t.sql`INSERT INTO principle_signals(profile_id,principle_id,signal_id) VALUES (${profileId},${p.id},${id})`;
  }
  return { principleId: p.id as string, signalIds: ids };
}

/**
 * A principle edit's lock order — the principle row, then the profile's
 * generation fence — held open while `act` runs on the app pool. The act must
 * not take the fence and then wait on the principle (a deadlock); it may wait
 * on the principle only after its own signal transaction has committed.
 */
async function racePrincipleEdit(profileId: string, principleId: string, signalId: string, act: () => Promise<unknown>) {
  let acting: Promise<unknown> | undefined;
  await t.sql.begin(async (edit) => {
    await edit`SET LOCAL lock_timeout = '5s'`;
    await edit`SELECT id FROM principles WHERE id=${principleId} FOR UPDATE`;
    acting = act();
    await vi.waitFor(async () => {
      /* someone waits on THIS transaction (pg_locks, not pg_stat_activity:
         the stats view is a snapshot frozen for the rest of the transaction) */
      const [row] = await edit`SELECT count(*)::int AS n FROM pg_locks WHERE NOT granted
        AND locktype = 'transactionid' AND transactionid::text = pg_current_xact_id()::text`;
      expect(row!.n).toBeGreaterThan(0);
    }, { timeout: 5000, interval: 20 });
    /* the signal's own transaction committed before anything waited on the
       principle — so it holds no fence while it waits */
    expect(await edit`SELECT id FROM signals WHERE id=${signalId} AND dismissed_at IS NOT NULL`, "the signal change committed first").toHaveLength(1);
    await edit`UPDATE generation_revisions SET revision = revision + 1 WHERE profile_id=${profileId}`;
  });
  return acting;
}

beforeAll(async () => {
  t = await createTestDatabase();
  const url = new URL(process.env.DB_CONNECTION_URL!);
  url.searchParams.set("options", `-c search_path=${t.schemaName}`);
  process.env.DB_CONNECTION_URL = url.toString();
  process.env.WAKA_BACKGROUND_JOB_AUTODRAIN = "0";
});
afterAll(async () => { await getDb().$client.end(); await t?.cleanup(); });

describe("dismissing a claim", () => {
  it("withdraws principle support the dismissed signal provided", async () => {
    const profileId = await person();
    const { principleId, signalIds } = await principleOnThreeSignals(profileId, true);

    expect(await dismissProfileSignal(t.db as never, { profileId, signalId: signalIds[0]! })).not.toBeNull();

    const [row] = await t.sql`SELECT state, unsupported_at, statement FROM principles WHERE id=${principleId}`;
    expect(row!.statement).toBe("Prefer small, reversible experiments.");
    expect(row!.unsupported_at, "support is marked withdrawn").not.toBeNull();
    expect(row!.state).toBe("aspirational");
  });

  it("is all-or-nothing: a failure settling its disputes leaves the claim undismissed", async () => {
    const profileId = await person();
    const { signalIds } = await principleOnThreeSignals(profileId, true);
    const [a, b] = [signalIds[0]!, signalIds[1]!].sort();
    await t.sql`INSERT INTO signal_contradictions(profile_id,a_signal_id,b_signal_id) VALUES (${profileId},${a},${b})`;
    await t.sql.unsafe(`CREATE FUNCTION refuse_contradiction_settle() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'contradictions unavailable'; END $$`);
    await t.sql.unsafe(`CREATE TRIGGER refuse_contradiction_settle BEFORE UPDATE ON signal_contradictions
      FOR EACH ROW EXECUTE FUNCTION refuse_contradiction_settle()`);
    try {
      await expect(dismissProfileSignal(t.db as never, { profileId, signalId: a })).rejects.toThrow();
    } finally {
      await t.sql.unsafe(`DROP TRIGGER refuse_contradiction_settle ON signal_contradictions`);
      await t.sql.unsafe(`DROP FUNCTION refuse_contradiction_settle()`);
    }
    const [row] = await t.sql`SELECT status, dismissed_at FROM signals WHERE id=${a}`;
    expect(row, "the claim was not half-dismissed").toMatchObject({ status: "active", dismissed_at: null });
  });

  it("does not deadlock against a concurrent principle edit", async () => {
    const profileId = await person();
    const { principleId, signalIds } = await principleOnThreeSignals(profileId, true);
    const result = await racePrincipleEdit(profileId, principleId, signalIds[0]!,
      () => dismissProfileSignal(getDb(), { profileId, signalId: signalIds[0]! }));
    expect(result).not.toBeNull();
    const [row] = await t.sql`SELECT unsupported_at FROM principles WHERE id=${principleId}`;
    expect(row!.unsupported_at, "the reconcile still ran after the edit").not.toBeNull();
  });
});
