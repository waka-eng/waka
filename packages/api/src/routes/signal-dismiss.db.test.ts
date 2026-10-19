/** Dismissing a claim is one atomic, undoable act — real SQL, no model. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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


beforeAll(async () => {
  t = await createTestDatabase();
  const url = new URL(process.env.DB_CONNECTION_URL!);
  url.searchParams.set("options", `-c search_path=${t.schemaName}`);
  process.env.DB_CONNECTION_URL = url.toString();
  process.env.WAKA_BACKGROUND_JOB_AUTODRAIN = "0";
});
afterAll(async () => { await getDb().$client.end(); await t?.cleanup(); });

describe("dismissing a claim", () => {
  it("leaves principles alone, so a restore finds them as they were", async () => {
    /* Dismissal is undoable. Reconciling here would delete an unedited minted
       principle, and restoring the signal could not bring it back. */
    const profileId = await person();
    const { principleId, signalIds } = await principleOnThreeSignals(profileId, false);

    expect(await dismissProfileSignal(t.db as never, { profileId, signalId: signalIds[0]! })).not.toBeNull();

    const [row] = await t.sql`SELECT state, unsupported_at FROM principles WHERE id=${principleId}`;
    expect(row, "the minted principle survives the dismissal").toMatchObject({ state: "held", unsupported_at: null });
    const links = await t.sql`SELECT signal_id FROM principle_signals WHERE principle_id=${principleId}`;
    expect(links).toHaveLength(3);
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

});
