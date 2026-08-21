/**
 * THE PROMOTION GUARD, AGAINST A REAL DATABASE.
 *
 * This test exists because three green gates missed the bug it covers. The
 * guard is a Postgres trigger, so nothing that mocks Drizzle can see it: the
 * 384 unit tests inject fake query builders and never open a connection, and
 * the route specs that do open one never promote a signal. A trigger is only
 * testable by executing it.
 *
 * What it protects, in the migrations' own terms:
 *
 *   0003 forbade a signal from BEING active with fewer than three evidence
 *   rows. That is not the product's rule. `docs/generation.md` gates
 *   PROMOTION at three; residence is a separate question, and
 *   `settleStrandedSignals` deliberately keeps a locked signal active-and-
 *   unsupported when its citations are deleted rather than retiring someone's
 *   own sentence for want of footnotes.
 *
 *   The collision was not theoretical. `deriveSignal` writes `status` on every
 *   pass — `promote ? "active" : current.status` — and Postgres fires
 *   `UPDATE OF status` whenever the column is in the SET list, changed or not.
 *   So one deleted inspiration was enough to make every later derivation for
 *   that signal abort.
 *
 * 0005 narrows the guard to the transition. The three cases below are the
 * whole contract: promotion is still policed, an already-active row can still
 * be written, and a direct insert cannot smuggle a signal past the gate.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDatabase } from "../../test/helpers/index.js";

let t: TestDatabase;

let seq = 0;

async function seedProfile(): Promise<string> {
  seq += 1;
  const [account] = await t.sql`
    INSERT INTO accounts (email) VALUES (${`guard-${seq}@example.test`}) RETURNING id`;
  const [profile] = await t.sql`
    INSERT INTO profiles (account_id, type, name)
    VALUES (${account.id}, 'human', 'Test') RETURNING id`;
  return profile.id as string;
}

async function seedSignal(status: string, evidenceCount: number): Promise<string> {
  const profileId = await seedProfile();
  const [signal] = await t.sql`
    INSERT INTO signals (profile_id, statement, status)
    VALUES (${profileId}, 'a statement', 'emerging') RETURNING id`;

  for (let i = 0; i < evidenceCount; i += 1) {
    const [inspiration] = await t.sql`
      INSERT INTO inspirations (profile_id, text, source)
      VALUES (${profileId}, ${`memory ${i}`}, 'app') RETURNING id`;
    await t.sql`
      INSERT INTO signal_evidence (profile_id, signal_id, inspiration_id)
      VALUES (${profileId}, ${signal.id}, ${inspiration.id})`;
  }

  if (status === "active") {
    /* past the guard by the only legitimate route, so the row under test is
       one the product could actually have produced */
    await t.sql`UPDATE signals SET status = 'active' WHERE id = ${signal.id}`;
  }
  return signal.id as string;
}

describe("signals_require_evidence", () => {
  beforeEach(async () => {
    t ??= await createTestDatabase();
    await t.truncateAll();
  });

  afterAll(async () => {
    await t?.sql.end();
  });

  it("refuses to promote a signal that has not earned it", async () => {
    const id = await seedSignal("emerging", 2);

    await expect(
      t.sql`UPDATE signals SET status = 'active' WHERE id = ${id}`,
    ).rejects.toThrow(/cannot be promoted to active with 2 evidence/);
  });

  it("promotes at three, which is the rule the guard exists to hold", async () => {
    const id = await seedSignal("emerging", 3);

    await t.sql`UPDATE signals SET status = 'active' WHERE id = ${id}`;

    const [row] = await t.sql`SELECT status FROM signals WHERE id = ${id}`;
    expect(row.status).toBe("active");
  });

  /**
   * THE REGRESSION. Before 0005 this threw, and derivation went with it.
   *
   * An active signal loses an inspiration; the evidence row cascades away;
   * the next derivation pass re-writes `status = 'active'` over 'active'
   * along with the recomputed confidence — and the guard, which fired on any
   * write naming the column, counted two and aborted the transaction.
   */
  it("lets an already-active signal be written after its support falls away", async () => {
    const id = await seedSignal("active", 3);
    await t.sql`
      DELETE FROM signal_evidence
      WHERE ctid IN (SELECT ctid FROM signal_evidence WHERE signal_id = ${id} LIMIT 1)`;

    /* exactly what deriveSignal does: status re-stated, unchanged */
    await t.sql`
      UPDATE signals SET status = 'active', confidence = 40, updated_at = now()
      WHERE id = ${id}`;

    const [row] = await t.sql`SELECT status, confidence FROM signals WHERE id = ${id}`;
    expect(row.status).toBe("active");
    expect(Number(row.confidence)).toBe(40);
  });

  it("cannot be bypassed by inserting straight into active", async () => {
    const profileId = await seedProfile();

    await expect(
      t.sql`
        INSERT INTO signals (profile_id, statement, status)
        VALUES (${profileId}, 'unearned', 'active')`,
    ).rejects.toThrow(/cannot be promoted to active with 0 evidence/);
  });
});
