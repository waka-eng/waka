/**
 * THE GROUND REFUSES, ON THE RECORD — pinned against the real pipeline.
 *
 * goal: the-legible-loop, Phase 3. A dismissed signal keeps its row, its
 * evidence and its embedding; the embedding becomes a suppression anchor,
 * and from then on the same meaning is dropped instead of minted — with
 * EVERY refusal written to `suppressions`, naming the anchor. The word is
 * dismissed, not tombstone: restore ends the refusals and returns the
 * pattern to the loop's sight.
 *
 * These cases drive `applyCandidates` — the same function the derivation
 * pipeline runs — against a real database, with stub embeddings whose cosine
 * geometry is chosen by hand. No live model is called. Changed wording
 * requires a semantic same verdict before refusal; exact wording does not.
 *
 * This file is also the enforcing test behind two rendered claims:
 * `RECEIPTS.groundRefuses` in the web registry and the reading's refused-ground
 * sentence. Renaming or deleting it fails those suites by design.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestDatabase, type TestDatabase } from "../../test/helpers/index.js";
import {
  dismissProfileSignal,
  restoreProfileSignal,
} from "../routes/signals.js";
import { applyCandidates, acquireSignalDerivationLock } from "./signal-match-or-mint.js";
import type { ModelProvider } from "./model-provider.js";

let t: TestDatabase;
let seq = 0;

const EMBEDDING_MODEL = "suppression-test-embedding";

/** The pattern the owner will throw out. */
const ANCHOR_EMBEDDING = [1, 0, 0, 0];
/** cosine 0.9 to the anchor — above the refusal bar (0.86). */
const NEAR_EMBEDDING = [0.9, Math.sqrt(1 - 0.81), 0, 0];
/** Orthogonal to everything above — always a mint. */
const FAR_EMBEDDING = [0, 0, 1, 0];

const matchingProvider = {
  judgeSignalMatch: vi.fn(async () => ({ relation: 'same' as const })),
} as unknown as ModelProvider;

async function seedProfile(): Promise<string> {
  seq += 1;
  const [account] = await t.sql`
    INSERT INTO accounts (email) VALUES (${`suppression-${seq}@example.test`}) RETURNING id`;
  const [p] = await t.sql`
    INSERT INTO profiles (account_id, type, name)
    VALUES (${account.id}, 'human', 'Owner') RETURNING id`;
  return p.id as string;
}

async function seedInspiration(profileId: string, text: string): Promise<string> {
  const [row] = await t.sql`
    INSERT INTO inspirations (profile_id, text) VALUES (${profileId}, ${text}) RETURNING id`;
  return row.id as string;
}

/** One derivation pass, exactly as the pipeline runs it. */
async function derive(
  profileId: string,
  inspirationId: string,
  statement: string,
  embedding: number[],
): Promise<{ minted: string[]; matched: string[] }> {
  return t.db.transaction(async (tx) => {
    await acquireSignalDerivationLock(tx as never, profileId);
    const result = await applyCandidates(tx as never, {
      beforeWrites: async () => {}, // synthetic candidates isolate suppression arithmetic
      profileId,
      evidenceOwnerProfileId: profileId,
      inspirationId,
      candidates: [{ statement, reason: null, quote: null, quoteSource: null, relatedEvidence: [], embedding }],
      embeddingModel: EMBEDDING_MODEL,
      provider: matchingProvider,
      preferredLocale: "en-US" as never,
      now: new Date(),
    });
    return { minted: result.mintedSignalIds, matched: result.matchedSignalIds };
  });
}

/** A signal the anchor scenarios start from: minted by the real pipeline. */
async function mintAnchor(profileId: string): Promise<string> {
  const record = await seedInspiration(profileId, "the sighting the owner will refuse");
  const { minted } = await derive(
    profileId,
    record,
    "You are a morning person.",
    ANCHOR_EMBEDDING,
  );
  expect(minted).toHaveLength(1);
  return minted[0]!;
}

const signalRow = async (signalId: string) => {
  const [row] = await t.sql`
    SELECT statement, status, dismissed_at, locked_at FROM signals WHERE id = ${signalId}`;
  return row;
};

const suppressionRows = async (profileId: string) =>
  t.sql`
    SELECT anchor_signal_id, anchor_statement, inspiration_id, candidate_statement, similarity
    FROM suppressions WHERE profile_id = ${profileId} ORDER BY suppressed_at`;

afterAll(async () => {
  await t?.cleanup();
});

describe("the ground refuses, on the record", () => {
  beforeEach(async () => {
    vi.mocked(matchingProvider.judgeSignalMatch).mockClear();
    t ??= await createTestDatabase();
    await t.truncateAll();
  });

  it("dismissal deletes nothing: row, evidence and embedding all stay", async () => {
    const profileId = await seedProfile();
    const anchorId = await mintAnchor(profileId);

    const dismissed = await dismissProfileSignal(t.db as never, {
      profileId,
      signalId: anchorId,
    });
    expect(dismissed).not.toBeNull();
    expect(dismissed!.dismissed).toBe(true);
    expect(dismissed!.status).toBe("retired");

    const row = await signalRow(anchorId);
    expect(row.statement, "the words stay").toBe("You are a morning person.");
    expect(row.dismissed_at).not.toBeNull();
    const [evidence] = await t.sql`
      SELECT count(*)::int AS n FROM signal_evidence WHERE signal_id = ${anchorId}`;
    expect(evidence.n, "the roots stay").toBe(1);
    const [embedding] = await t.sql`
      SELECT count(*)::int AS n FROM signal_embeddings WHERE signal_id = ${anchorId}`;
    expect(embedding.n, "the vector stays — it is the anchor now").toBe(1);
  });

  it("drops a near candidate and writes the refusal naming its anchor", async () => {
    const profileId = await seedProfile();
    const anchorId = await mintAnchor(profileId);
    await dismissProfileSignal(t.db as never, { profileId, signalId: anchorId });

    const record = await seedInspiration(profileId, "up at dawn again, loving it");
    const pass = await derive(
      profileId,
      record,
      "Mornings are your best hours.",
      NEAR_EMBEDDING,
    );

    expect(pass.minted, "the refused pattern must not mint again").toHaveLength(0);
    expect(pass.matched, "nor sneak back in as evidence").toHaveLength(0);
    const [{ n }] = await t.sql`
      SELECT count(*)::int AS n FROM signals WHERE profile_id = ${profileId}`;
    expect(n, "no second signal row appeared").toBe(1);

    const refusals = await suppressionRows(profileId);
    expect(refusals, "every refusal is on the record").toHaveLength(1);
    expect(refusals[0]).toMatchObject({
      anchor_signal_id: anchorId,
      anchor_statement: "You are a morning person.",
      inspiration_id: record,
      candidate_statement: "Mornings are your best hours.",
    });
    expect(refusals[0].similarity as number).toBeGreaterThanOrEqual(0.86);
  });

  it("lets a distant candidate mint normally, with no refusal written", async () => {
    const profileId = await seedProfile();
    const anchorId = await mintAnchor(profileId);
    await dismissProfileSignal(t.db as never, { profileId, signalId: anchorId });

    const record = await seedInspiration(profileId, "something else entirely");
    const pass = await derive(profileId, record, "You cook to think.", FAR_EMBEDDING);

    expect(pass.minted).toHaveLength(1);
    expect(await suppressionRows(profileId)).toHaveLength(0);
  });

  it("restore ends the refusals: the pattern returns to the loop's sight", async () => {
    const profileId = await seedProfile();
    const anchorId = await mintAnchor(profileId);
    await dismissProfileSignal(t.db as never, { profileId, signalId: anchorId });

    // While dismissed: refused, on the record.
    const first = await seedInspiration(profileId, "an early start");
    await derive(profileId, first, "Mornings are your best hours.", NEAR_EMBEDDING);
    expect(await suppressionRows(profileId)).toHaveLength(1);

    expect(matchingProvider.judgeSignalMatch).toHaveBeenCalledOnce();

    const restored = await restoreProfileSignal(t.db as never, {
      profileId,
      signalId: anchorId,
    });
    expect(restored).not.toBeNull();
    expect(restored!.dismissed).toBe(false);
    expect(restored!.status, "one evidence row: back to emerging").toBe("emerging");

    // After restore: the same nearness now ATTACHES — the pattern is a home
    // for evidence again, and nothing new lands on the record.
    const second = await seedInspiration(profileId, "another early start");
    const pass = await derive(
      profileId,
      second,
      "Mornings are your best hours.",
      NEAR_EMBEDDING,
    );
    expect(pass.matched).toEqual([anchorId]);
    expect(pass.minted).toHaveLength(0);
    expect(await suppressionRows(profileId), "the old record stands; no new refusal").toHaveLength(1);
  });

  it("restore does not resurrect ordinary retirement, and re-promotion follows the evidence", async () => {
    const profileId = await seedProfile();
    const anchorId = await mintAnchor(profileId);

    // Two more sightings before dismissal — enough to promote.
    for (const text of ["second sighting", "third sighting"]) {
      const record = await seedInspiration(profileId, text);
      const pass = await derive(profileId, record, "You are a morning person.", ANCHOR_EMBEDDING);
      expect(pass.matched).toEqual([anchorId]);
    }
    expect((await signalRow(anchorId)).status).toBe("active");

    await dismissProfileSignal(t.db as never, { profileId, signalId: anchorId });
    expect((await signalRow(anchorId)).status).toBe("retired");

    const restored = await restoreProfileSignal(t.db as never, {
      profileId,
      signalId: anchorId,
    });
    expect(
      restored!.status,
      "three evidence rows: the lifecycle re-promotes on the spot",
    ).toBe("active");

    // A signal retired the ordinary way (not dismissed) is not restore's
    // business: the verb undoes dismissal, nothing else.
    const [plain] = await t.sql`
      INSERT INTO signals (profile_id, statement, status, confidence)
      VALUES (${profileId}, ${"An evidence-dead pattern."}, 'retired', 0) RETURNING id`;
    const untouched = await restoreProfileSignal(t.db as never, {
      profileId,
      signalId: plain.id as string,
    });
    expect(untouched!.status).toBe("retired");
    expect(untouched!.dismissed).toBe(false);
  });
});
