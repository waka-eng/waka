/**
 * RATIFIED LIGHT — the served ground's standing, pinned against real rows.
 *
 * goal: the-legible-loop, Phase 4. Every cited ground in the served entry
 * payload carries `answered`: true when the owner has spoken to that ground —
 * a verdict (any feedback on the signal, not_true included) or a star (their
 * own locked words) — false while only the machine believes it. The claim
 * this suite enforces has two halves:
 *
 *   - COMPUTED, NEVER STORED. The standing is read from the feedback and
 *     lock records at serve time. The proof is the flip: a verdict written
 *     between two serves moves the light with no entry row touched — and a
 *     structural case pins that no artifact table even has a column to
 *     denormalize it into.
 *   - FROM THE FEEDBACK AND LOCK RECORDS ONLY. Nothing else moves it.
 *
 * This file is the enforcing test behind the poster's two ink states in the
 * world (home-poster pins the rendering; this pins the truth it renders).
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDatabase } from "../../test/helpers/index.js";
import { getLiveTopOfMind } from "./top-of-mind.js";
import { updateSignalStatement } from "./signals.js";

let t: TestDatabase;
let seq = 0;

async function seedProfile(): Promise<string> {
  seq += 1;
  const [account] = await t.sql`
    INSERT INTO accounts (email) VALUES (${`ratified-${seq}@example.test`}) RETURNING id`;
  const [p] = await t.sql`
    INSERT INTO profiles (account_id, type, name)
    VALUES (${account.id}, 'human', 'Owner') RETURNING id`;
  return p.id as string;
}

async function seedSignal(profileId: string, statement: string): Promise<string> {
  // One owned witness is enough for an emerging signal to appear in a
  // reading. Being evidenced and being answered are separate: the latter
  // still reads only feedback and locks, not the evidence count.
  const [row] = await t.sql`
    INSERT INTO signals (profile_id, statement, status, confidence)
    VALUES (${profileId}, ${statement}, 'emerging', 0) RETURNING id`;
  const [source] = await t.sql`
    INSERT INTO inspirations (profile_id, text)
    VALUES (${profileId}, ${statement}) RETURNING id`;
  await t.sql`
    INSERT INTO signal_evidence (profile_id, owner_profile_id, signal_id, inspiration_id)
    VALUES (${profileId}, ${profileId}, ${row.id}, ${source.id})`;
  return row.id as string;
}

/** One live artifact with one entry citing the given signals. */
async function seedBoard(profileId: string, citedIds: string[]): Promise<string> {
  const [tom] = await t.sql`
    INSERT INTO top_of_minds (profile_id, status, reason)
    VALUES (${profileId}, 'live', 'initial') RETURNING id`;
  const [entry] = await t.sql`
    INSERT INTO top_of_mind_entries (top_of_mind_id, type, body, sort_order)
    VALUES (${tom.id}, 'hypothesis', 'You build rooms you can trust.', 0) RETURNING id`;
  for (const signalId of citedIds) {
    await t.sql`
      INSERT INTO top_of_mind_entry_signals (entry_id, signal_id, owner_profile_id)
      VALUES (${entry.id}, ${signalId}, ${profileId})`;
  }
  return entry.id as string;
}

const servedGrounds = async (profileId: string) => {
  const view = await getLiveTopOfMind(t.db as never, { profileId });
  const grounds = new Map<string, boolean>();
  for (const entry of view?.entries ?? [])
    for (const cited of entry.citedSignals) grounds.set(cited.id, cited.answered);
  return grounds;
};

afterAll(async () => {
  await t?.cleanup();
});

describe("ratified light: the served ground says who holds it", () => {
  beforeEach(async () => {
    t ??= await createTestDatabase();
    await t.truncateAll();
  });

  it("serves machine-only grounds unanswered, and a verdict flips the light with no entry write", async () => {
    const profileId = await seedProfile();
    const believed = await seedSignal(profileId, "You are a morning person.");
    const alsoBelieved = await seedSignal(profileId, "You cook to think.");
    await seedBoard(profileId, [believed, alsoBelieved]);

    const before = await servedGrounds(profileId);
    expect(before.get(believed), "no one has spoken yet").toBe(false);
    expect(before.get(alsoBelieved)).toBe(false);

    const [{ updated_at: entryStampBefore }] = await t.sql`
      SELECT updated_at FROM top_of_mind_entries LIMIT 1`;

    // The owner answers one ground — with a NO. Ratified means "we have
    // spoken about this", so not_true lights the ground like any answer.
    await t.sql`
      INSERT INTO feedback (profile_id, target_type, target_id, value)
      VALUES (${profileId}, 'signal', ${believed}, 'not_true')`;

    const after = await servedGrounds(profileId);
    expect(after.get(believed), "the answered ground holds the light").toBe(true);
    expect(after.get(alsoBelieved), "the unanswered one still sits dim").toBe(false);

    const [{ updated_at: entryStampAfter }] = await t.sql`
      SELECT updated_at FROM top_of_mind_entries LIMIT 1`;
    expect(
      String(entryStampAfter),
      "the light moved without any entry row being written — computed, not stored",
    ).toBe(String(entryStampBefore));
  });

  it("a star answers too: locking the words lights the ground", async () => {
    const profileId = await seedProfile();
    const ground = await seedSignal(profileId, "Machine's wording.");
    await seedBoard(profileId, [ground]);

    expect((await servedGrounds(profileId)).get(ground)).toBe(false);

    await updateSignalStatement(t.db as never, {
      profileId,
      signalId: ground,
      // Locking identical words changes their ownership, not their meaning.
      // A reworded ground requires fresh proof and a new reading separately.
      statement: "Machine's wording.",
    });

    expect(
      (await servedGrounds(profileId)).get(ground),
      "the owner's locked words are their answer",
    ).toBe(true);
  });

  it("another profile's verdict on its own ground moves nothing here", async () => {
    // The standing is the OWNER's relationship to the ground. A feedback row
    // from any other profile — same account or not — must not light it.
    const profileId = await seedProfile();
    const stranger = await seedProfile();
    const ground = await seedSignal(profileId, "A pattern of the owner's.");
    await seedBoard(profileId, [ground]);

    await t.sql`
      INSERT INTO feedback (profile_id, target_type, target_id, value)
      VALUES (${stranger}, 'signal', ${ground}, 'true')`;

    expect(
      (await servedGrounds(profileId)).get(ground),
      "someone else's answer is not the owner's ratification",
    ).toBe(false);
  });

  it("has no column to store the standing in — the schema refuses denormalization", async () => {
    const columns = await t.sql`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = ${t.schemaName}
        AND table_name IN ('top_of_minds', 'top_of_mind_entries', 'top_of_mind_entry_signals')`;
    const suspicious = columns.filter((row) =>
      /answer|ratif|standing/i.test(row.column_name as string),
    );
    expect(
      suspicious,
      "ratified standing must be computed from feedback and lock records at serve time, never stored",
    ).toEqual([]);
  });

  it("an answer does not make an unevidenced machine reading current", async () => {
    const profileId = await seedProfile();
    const ground = await seedSignal(profileId, "A previously supported pattern.");
    await seedBoard(profileId, [ground]);
    await t.sql`
      INSERT INTO feedback (profile_id, target_type, target_id, value)
      VALUES (${profileId}, 'signal', ${ground}, 'true')`;
    expect((await servedGrounds(profileId)).get(ground)).toBe(true);

    await t.sql`DELETE FROM signal_evidence WHERE signal_id = ${ground}`;
    const view = await getLiveTopOfMind(t.db as never, { profileId });
    expect(view?.entries).toEqual([]);
    expect(view?.supportChanged).toBe(true);
  });
});
