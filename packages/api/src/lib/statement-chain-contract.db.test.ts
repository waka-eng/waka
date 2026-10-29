/**
 * THE MACHINE'S ORIGINAL SURVIVES — the chain contract, on real Postgres.
 *
 * goal: no-quiet-corners, Phase 2 (register item 1, debt 2). L2 and L4 used
 * to overwrite statements in place; now every statement write appends to a
 * supersede chain, and the verb pair completes: release keeps the person's
 * words (its own Track S contract suite still pins that, unchanged), revert
 * restores the machine's sentence BYTE-FOR-BYTE from the chain, clears the
 * lock, and is itself a chain row.
 *
 * The cases drive the real writers — `applyCandidates` for derivation,
 * `updateSignalStatement` for the edit, the chain lib for revert — against
 * a real database. The no-deletion law is asserted as a monotone row count:
 * nothing any writer does may ever shrink a chain.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDatabase } from "../../test/helpers/index.js";
import { updateSignalStatement } from "../routes/signals.js";
import { applyCandidates, acquireSignalDerivationLock } from "./signal-match-or-mint.js";
import {
  revertPrincipleStatement,
  revertSignalStatement,
  writePrincipleStatementChain,
} from "./statement-chains.js";
import type { ModelProvider } from "./model-provider.js";

let t: TestDatabase;
let seq = 0;

const EMBEDDING_MODEL = "chain-contract-embedding";
const NEAR_EMBEDDING = [1, 0, 0, 0];

// `judgeSignalMatch` confirms these fixture restatements have the same meaning.
const matchingProvider = {
  judgeSignalMatch: async () => ({ relation: 'same' }),
} as unknown as ModelProvider;

async function seedProfile(): Promise<string> {
  seq += 1;
  const [account] = await t.sql`
    INSERT INTO accounts (email) VALUES (${`chain-${seq}@example.test`}) RETURNING id`;
  const [p] = await t.sql`
    INSERT INTO profiles (account_id, type, name)
    VALUES (${account.id}, 'human', 'Owner') RETURNING id`;
  return p.id as string;
}

async function derive(
  profileId: string,
  statement: string,
): Promise<{ minted: string[]; matched: string[] }> {
  const [insp] = await t.sql`
    INSERT INTO inspirations (profile_id, text) VALUES (${profileId}, ${"a sighting"}) RETURNING id`;
  return t.db.transaction(async (tx) => {
    await acquireSignalDerivationLock(tx as never, profileId);
    const result = await applyCandidates(tx as never, {
      beforeWrites: async () => {}, // source revision behavior has its own real-pipeline suite
      profileId,
      evidenceOwnerProfileId: profileId,
      inspirationId: insp.id as string,
      candidates: [{ statement, reason: null, quote: null, quoteSource: null, relatedEvidence: [], embedding: NEAR_EMBEDDING }],
      embeddingModel: EMBEDDING_MODEL,
      provider: matchingProvider,
      preferredLocale: "en-US" as never,
      now: new Date(),
    });
    return { minted: result.mintedSignalIds, matched: result.matchedSignalIds };
  });
}

const chainOf = async (signalId: string) =>
  t.sql`
    SELECT statement, reason, superseded_at, superseded_by_id
    FROM signal_statements WHERE signal_id = ${signalId} ORDER BY created_at`;

afterAll(async () => {
  await t?.cleanup();
});

describe("the statement chain: derive, edit, revert", () => {
  beforeEach(async () => {
    t ??= await createTestDatabase();
    await t.truncateAll();
  });

  it("returns the machine's statement byte-identical, keeps the edit as history, deletes nothing", async () => {
    const profileId = await seedProfile();
    const machinesWords = "You keep choosing depth over breadth.";
    const { minted } = await derive(profileId, machinesWords);
    const signalId = minted[0]!;

    // Born chained: the derived row is current.
    let chain = await chainOf(signalId);
    expect(chain).toHaveLength(1);
    expect(chain[0]).toMatchObject({ statement: machinesWords, reason: "derived" });
    expect(chain[0]!.superseded_at).toBeNull();

    // The owner edits — locks — and the machine's sentence survives behind
    // the edit, superseded and pointed forward, never gone.
    const edited = await updateSignalStatement(t.db as never, {
      profileId,
      signalId,
      statement: "My own words for this.",
    });
    expect(edited?.locked).toBe(true);
    chain = await chainOf(signalId);
    expect(chain).toHaveLength(2);
    expect(chain[0]).toMatchObject({ statement: machinesWords, reason: "derived" });
    expect(chain[0]!.superseded_at).not.toBeNull();
    expect(chain[0]!.superseded_by_id).not.toBeNull();
    expect(chain[1]).toMatchObject({ statement: "My own words for this.", reason: "edited" });

    // Revert: byte-identical restoration, lock cleared, the edit still in
    // the chain — history only ever grows.
    const result = await revertSignalStatement(t.db as never, { profileId, signalId });
    expect(result).toEqual({ outcome: "reverted", statement: machinesWords });

    const [row] = await t.sql`
      SELECT statement, locked_at FROM signals WHERE id = ${signalId}`;
    expect(row.statement, "byte-for-byte from the chain").toBe(machinesWords);
    expect(row.locked_at, "revert hands jurisdiction back").toBeNull();

    chain = await chainOf(signalId);
    expect(chain).toHaveLength(3);
    expect(chain[1], "the human's edit survives as history").toMatchObject({
      statement: "My own words for this.",
      reason: "edited",
    });
    expect(chain[2]).toMatchObject({ statement: machinesWords, reason: "reverted" });
    expect(chain[2]!.superseded_at).toBeNull();
  });

  it("reverts to the newest machine statement — a restatement, not the first draft", async () => {
    const profileId = await seedProfile();
    const { minted } = await derive(profileId, "First draft of the pattern.");
    const signalId = minted[0]!;

    // A confirming capture restates the emerging signal — machine's hand.
    const pass = await derive(profileId, "The pattern, named properly.");
    expect(pass.matched).toEqual([signalId]);

    await updateSignalStatement(t.db as never, {
      profileId,
      signalId,
      statement: "Owner's rewrite.",
    });

    const result = await revertSignalStatement(t.db as never, { profileId, signalId });
    expect(result).toEqual({ outcome: "reverted", statement: "The pattern, named properly." });

    const reasons = (await chainOf(signalId)).map((r) => r.reason);
    expect(reasons).toEqual(["derived", "restated", "edited", "reverted"]);
  });

  it("seeds the chain at the first edit of a pre-chain signal, so its original is not lost either", async () => {
    const profileId = await seedProfile();
    // A signal from before the chain existed: row only, no chain.
    const [row] = await t.sql`
      INSERT INTO signals (profile_id, statement, status, confidence)
      VALUES (${profileId}, ${"A pre-chain machine sentence."}, 'emerging', 0) RETURNING id`;
    const signalId = row.id as string;
    expect(await chainOf(signalId)).toHaveLength(0);

    await updateSignalStatement(t.db as never, {
      profileId,
      signalId,
      statement: "Edited before any chain existed.",
    });

    const chain = await chainOf(signalId);
    expect(chain).toHaveLength(2);
    expect(chain[0], "the pre-edit sentence was seeded as the machine's").toMatchObject({
      statement: "A pre-chain machine sentence.",
      reason: "derived",
    });

    const result = await revertSignalStatement(t.db as never, { profileId, signalId });
    expect(result).toEqual({
      outcome: "reverted",
      statement: "A pre-chain machine sentence.",
    });
  });

  it("refuses to invent a machine original where the chain holds only the owner's words", async () => {
    const profileId = await seedProfile();
    const [p] = await t.sql`
      INSERT INTO principles (profile_id, statement, type, state, origin, rank, locked_at)
      VALUES (${profileId}, ${"Never travel in August."}, 'maxim', 'aspirational', 'declared', 1, now())
      RETURNING id`;
    await writePrincipleStatementChain(t.db as never, {
      profileId,
      principleId: p.id as string,
      statement: "Never travel in August.",
      reason: "declared",
    });

    const result = await revertPrincipleStatement(t.db as never, {
      profileId,
      principleId: p.id as string,
    });
    expect(result).toEqual({ outcome: "nothing_to_revert" });
  });

  it("completes the verb pair at layer 4: a minted principle edited, then reverted byte-for-byte", async () => {
    const profileId = await seedProfile();
    const [p] = await t.sql`
      INSERT INTO principles (profile_id, statement, type, state, origin, rank)
      VALUES (${profileId}, ${"Depth over breadth, when they conflict."}, 'maxim', 'held', 'minted', 1)
      RETURNING id`;
    const principleId = p.id as string;

    // The route's edit wiring: seed the unlocked minted sentence, then the
    // owner's words. (The HTTP layer above this is one thin handler.)
    await writePrincipleStatementChain(t.db as never, {
      profileId,
      principleId,
      statement: "My phrasing of the rule.",
      reason: "edited",
      seedStatement: "Depth over breadth, when they conflict.",
    });
    await t.sql`
      UPDATE principles SET statement = ${"My phrasing of the rule."}, locked_at = now()
      WHERE id = ${principleId}`;

    const result = await revertPrincipleStatement(t.db as never, { profileId, principleId });
    expect(result).toEqual({
      outcome: "reverted",
      statement: "Depth over breadth, when they conflict.",
    });
    const [row] = await t.sql`
      SELECT statement, locked_at FROM principles WHERE id = ${principleId}`;
    expect(row.statement).toBe("Depth over breadth, when they conflict.");
    expect(row.locked_at).toBeNull();

    const rows = await t.sql`
      SELECT reason FROM principle_statements WHERE principle_id = ${principleId} ORDER BY created_at`;
    expect(rows.map((r) => r.reason)).toEqual(["minted", "edited", "reverted"]);
  });
});
