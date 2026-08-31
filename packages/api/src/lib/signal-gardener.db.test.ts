/**
 * THE GARDENER PROPOSES; ONLY THE OWNER MOVES.
 *
 * Claims, in the order the machinery runs:
 *   1. A pass over a standing set with one near-identical pair judges it and
 *      writes ONE unresolved proposal; an opposed verdict writes the same
 *      contradiction row capture-time opposition writes; independent writes
 *      nothing.
 *   2. A recorded pair — proposal, merge, kept_apart, or contradiction — is
 *      never judged again.
 *   3. `merge` unions the pair under the survivor in one transaction:
 *      evidence repoints (overlap swallowed), top-of-mind and principle
 *      citations follow, the other side RETIRES (never a delete), the
 *      proposal records the survivor, and the survivor's lifecycle
 *      recomputes. The locked side survives when exactly one side is locked
 *      — the person's own words always win; otherwise the elder does.
 *   4. `keep_apart` is a standing answer: resolved, nothing moved, and the
 *      gardener respects it forever (claim 2 covers the forever).
 *
 * WHAT THIS MOCKS, AND WHY: the judge — a scripted ModelProvider, because
 * the subject is the machinery around the verdict, not the verdict. The
 * database is real; every row the claims name is read back from it.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDatabase } from "../../test/helpers/index.js";
import type { ModelProvider, SignalMatchJudgement } from "./model-provider.js";
import { resolveSignalDuplicate, tendSignalGarden } from "./signal-gardener.js";

let t: TestDatabase;
let seq = 0;

async function seedProfile(): Promise<string> {
  seq += 1;
  const [account] = await t.sql`
    INSERT INTO accounts (email) VALUES (${`gardener-${seq}@example.test`}) RETURNING id`;
  const [profile] = await t.sql`
    INSERT INTO profiles (account_id, type, name)
    VALUES (${account.id}, 'human', ${`Gardener${seq}`}) RETURNING id`;
  return profile.id as string;
}

async function seedSignal(
  profileId: string,
  statement: string,
  embedding: number[],
  opts: { lockedAt?: Date; createdAt?: Date } = {},
): Promise<string> {
  const [signal] = await t.sql`
    INSERT INTO signals (profile_id, statement, status, confidence, locked_at, created_at)
    VALUES (${profileId}, ${statement}, 'emerging', 0,
            ${opts.lockedAt ? opts.lockedAt.toISOString() : null},
            ${(opts.createdAt ?? new Date()).toISOString()})
    RETURNING id`;
  await t.sql`
    INSERT INTO signal_embeddings (profile_id, signal_id, model, dimensions, input_hash, embedding)
    VALUES (${profileId}, ${signal.id}, 'bench-model', ${embedding.length},
            ${`hash-${signal.id}`}, ${JSON.stringify(embedding)}::jsonb)`;
  return signal.id as string;
}

async function seedEvidence(profileId: string, signalId: string, text: string): Promise<string> {
  const [insp] = await t.sql`
    INSERT INTO inspirations (profile_id, text) VALUES (${profileId}, ${text}) RETURNING id`;
  await t.sql`
    INSERT INTO signal_evidence (profile_id, owner_profile_id, signal_id, inspiration_id)
    VALUES (${profileId}, ${profileId}, ${signalId}, ${insp.id})`;
  return insp.id as string;
}

function scriptedJudge(verdict: SignalMatchJudgement["relation"]): {
  provider: ModelProvider;
  calls: Array<{ a: string; b: string }>;
} {
  const calls: Array<{ a: string; b: string }> = [];
  const refuse = () => {
    throw new Error("not this test's task");
  };
  return {
    calls,
    provider: {
      name: "scripted",
      async judgeSignalMatch(input) {
        calls.push({ a: input.candidateStatement, b: input.existingStatement });
        return { relation: verdict };
      },
      extractSignalCandidates: refuse,
      synthesizeTopOfMind: refuse,
      distillPrinciples: refuse,
      judgePrincipleRelation: refuse,
      routeDeclaration: refuse,
    } as unknown as ModelProvider,
  };
}

const NEAR_A = [1, 0.05, 0];
const NEAR_B = [1, 0.08, 0];
const FAR = [0, 0, 1];

afterAll(async () => {
  await t?.cleanup();
});

describe("the signal gardener", () => {
  beforeEach(async () => {
    t ??= await createTestDatabase();
    await t.truncateAll();
  });

  it("proposes the near pair once, and never asks about a recorded pair again", async () => {
    const profileId = await seedProfile();
    await seedSignal(profileId, "Small tools beat grand systems.", NEAR_A);
    await seedSignal(profileId, "I keep choosing the smallest tool that works.", NEAR_B);
    await seedSignal(profileId, "Walking untangles hard problems.", FAR);

    const first = scriptedJudge("same");
    const pass1 = await tendSignalGarden(t.db as never, {
      profileId,
      preferredLocale: "en-US",
      provider: first.provider,
    });
    expect(pass1).toMatchObject({ scanned: 3, suspectPairs: 1, judged: 1, proposed: 1 });

    const rows = await t.sql`
      SELECT resolved_at, similarity FROM signal_duplicates WHERE profile_id = ${profileId}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.resolved_at).toBeNull();
    expect(Number(rows[0]!.similarity)).toBeGreaterThan(0.86);

    const second = scriptedJudge("same");
    const pass2 = await tendSignalGarden(t.db as never, {
      profileId,
      preferredLocale: "en-US",
      provider: second.provider,
    });
    expect(pass2.judged, "a recorded pair is never asked about again").toBe(0);
    expect(second.calls).toHaveLength(0);
  });

  it("writes an opposed verdict as the contradiction the contested surface already shows", async () => {
    const profileId = await seedProfile();
    await seedSignal(profileId, "Mornings are for deep work.", NEAR_A);
    await seedSignal(profileId, "Mornings are for meetings.", NEAR_B);

    const judge = scriptedJudge("opposed");
    const pass = await tendSignalGarden(t.db as never, {
      profileId,
      preferredLocale: "en-US",
      provider: judge.provider,
    });
    expect(pass).toMatchObject({ judged: 1, proposed: 0, opposed: 1 });

    const pairs = await t.sql`
      SELECT resolved_at FROM signal_contradictions WHERE profile_id = ${profileId}`;
    expect(pairs).toHaveLength(1);
    const proposals = await t.sql`
      SELECT id FROM signal_duplicates WHERE profile_id = ${profileId}`;
    expect(proposals).toHaveLength(0);
  });

  it("merge: evidence unions under the elder, citations follow, the other retires — nothing deleted", async () => {
    const profileId = await seedProfile();
    const elder = await seedSignal(profileId, "The elder naming.", NEAR_A, {
      createdAt: new Date("2026-06-01T00:00:00Z"),
    });
    const younger = await seedSignal(profileId, "The younger rewording.", NEAR_B, {
      createdAt: new Date("2026-08-01T00:00:00Z"),
    });
    const sharedInspiration = await seedEvidence(profileId, elder, "witnessed by both");
    await t.sql`
      INSERT INTO signal_evidence (profile_id, owner_profile_id, signal_id, inspiration_id)
      VALUES (${profileId}, ${profileId}, ${younger}, ${sharedInspiration})`;
    await seedEvidence(profileId, younger, "witnessed by the younger alone");

    /* a top-of-mind entry citing the younger — the pointer that must follow */
    const [tom] = await t.sql`
      INSERT INTO top_of_minds (profile_id, version, reason) VALUES (${profileId}, 1, 'initial') RETURNING id`;
    const [entry] = await t.sql`
      INSERT INTO top_of_mind_entries (top_of_mind_id, type, body, sort_order)
      VALUES (${tom.id}, 'pattern', 'an entry standing on the younger', 0) RETURNING id`;
    await t.sql`
      INSERT INTO top_of_mind_entry_signals (entry_id, signal_id) VALUES (${entry.id}, ${younger})`;

    const judge = scriptedJudge("same");
    await tendSignalGarden(t.db as never, {
      profileId,
      preferredLocale: "en-US",
      provider: judge.provider,
    });
    const [proposal] = await t.sql`
      SELECT id FROM signal_duplicates WHERE profile_id = ${profileId}`;

    const result = await resolveSignalDuplicate(t.db as never, {
      profileId,
      duplicateId: proposal.id as string,
      act: "merge",
    });
    expect(result.status).toBe("merged");
    expect(result.survivorId, "the elder survives").toBe(elder);
    expect(result.retiredId).toBe(younger);

    const survivorLinks = await t.sql`
      SELECT inspiration_id FROM signal_evidence WHERE signal_id = ${elder}`;
    expect(survivorLinks, "the survivor holds the union").toHaveLength(2);
    const retiredLinks = await t.sql`
      SELECT inspiration_id FROM signal_evidence WHERE signal_id = ${younger}`;
    expect(retiredLinks, "the retired side keeps its provenance").toHaveLength(2);

    const [retired] = await t.sql`SELECT status, statement FROM signals WHERE id = ${younger}`;
    expect(retired!.status).toBe("retired");
    expect(retired!.statement, "retirement is not deletion").toBe("The younger rewording.");

    const [citation] = await t.sql`
      SELECT signal_id FROM top_of_mind_entry_signals WHERE entry_id = ${entry.id}`;
    expect(citation!.signal_id, "the citation follows the merge").toBe(elder);

    const [resolved] = await t.sql`
      SELECT resolved_by, merged_into_signal_id FROM signal_duplicates WHERE id = ${proposal.id}`;
    expect(resolved!.resolved_by).toBe("merged");
    expect(resolved!.merged_into_signal_id).toBe(elder);

    const [survivor] = await t.sql`SELECT confidence FROM signals WHERE id = ${elder}`;
    expect(Number(survivor!.confidence), "the widened evidence recomputed").toBeGreaterThan(0);
  });

  it("merge: the locked side survives even when it is younger — the person's words win", async () => {
    const profileId = await seedProfile();
    const elder = await seedSignal(profileId, "The machine's elder wording.", NEAR_A, {
      createdAt: new Date("2026-06-01T00:00:00Z"),
    });
    const lockedYounger = await seedSignal(profileId, "My own words for it.", NEAR_B, {
      createdAt: new Date("2026-08-01T00:00:00Z"),
      lockedAt: new Date("2026-08-02T00:00:00Z"),
    });
    await seedEvidence(profileId, elder, "old witness");
    await seedEvidence(profileId, lockedYounger, "new witness");

    const judge = scriptedJudge("same");
    await tendSignalGarden(t.db as never, {
      profileId,
      preferredLocale: "en-US",
      provider: judge.provider,
    });
    const [proposal] = await t.sql`
      SELECT id FROM signal_duplicates WHERE profile_id = ${profileId}`;
    const result = await resolveSignalDuplicate(t.db as never, {
      profileId,
      duplicateId: proposal.id as string,
      act: "merge",
    });
    expect(result.survivorId).toBe(lockedYounger);
    expect(result.retiredId).toBe(elder);
  });

  it("keep_apart stands, and a second answer is refused", async () => {
    const profileId = await seedProfile();
    await seedSignal(profileId, "One phrasing.", NEAR_A);
    await seedSignal(profileId, "Another phrasing.", NEAR_B);
    const judge = scriptedJudge("same");
    await tendSignalGarden(t.db as never, {
      profileId,
      preferredLocale: "en-US",
      provider: judge.provider,
    });
    const [proposal] = await t.sql`
      SELECT id FROM signal_duplicates WHERE profile_id = ${profileId}`;

    const kept = await resolveSignalDuplicate(t.db as never, {
      profileId,
      duplicateId: proposal.id as string,
      act: "keep_apart",
    });
    expect(kept.status).toBe("kept_apart");

    const again = await resolveSignalDuplicate(t.db as never, {
      profileId,
      duplicateId: proposal.id as string,
      act: "merge",
    });
    expect(again.status, "an answered pair stays answered").toBe("already_resolved");

    const statuses = await t.sql`
      SELECT status FROM signals WHERE profile_id = ${profileId} ORDER BY created_at`;
    expect(statuses.map((row) => row.status)).toEqual(["emerging", "emerging"]);
  });

  it("another profile's proposal is not found — the door is the owner's", async () => {
    const owner = await seedProfile();
    const stranger = await seedProfile();
    await seedSignal(owner, "Mine.", NEAR_A);
    await seedSignal(owner, "Also mine.", NEAR_B);
    const judge = scriptedJudge("same");
    await tendSignalGarden(t.db as never, {
      profileId: owner,
      preferredLocale: "en-US",
      provider: judge.provider,
    });
    const [proposal] = await t.sql`
      SELECT id FROM signal_duplicates WHERE profile_id = ${owner}`;
    const result = await resolveSignalDuplicate(t.db as never, {
      profileId: stranger,
      duplicateId: proposal.id as string,
      act: "merge",
    });
    expect(result.status).toBe("not_found");
  });
});
