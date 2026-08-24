/**
 * THE LOCK'S CONTRACT, PINNED AGAINST THE REAL PIPELINE.
 *
 * goal: a-room-you-can-trust, Track S (Task 2.7 of
 * docs/craft/revamp-stars-and-roots.md): regeneration must skip a locked
 * statement's TEXT while its evidence and confidence keep updating — and the
 * release verb must genuinely hand the words back.
 *
 * These cases drive `applyCandidates`, the same function the derivation
 * pipeline runs, against a real database — not a restated predicate in test
 * SQL, which is the "green while blind" shape docs/known-issues.md warns
 * about. No model is called: identical embeddings keep every decision above
 * the judge band, and the stub provider throws if the pipeline ever asks.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDatabase } from "../../test/helpers/index.js";
import { releaseSignalStatement, updateSignalStatement } from "../routes/signals.js";
import { deriveSignalsForInspiration } from "./signal-derivation.js";
import { applyCandidates, acquireSignalDerivationLock } from "./signal-match-or-mint.js";
import type { ModelProvider } from "./model-provider.js";

let t: TestDatabase;
let seq = 0;

const EMBEDDING_MODEL = "contract-test-embedding";
/** Identical vectors → cosine 1 → attach without a judge. */
const NEAR_EMBEDDING = [1, 0, 0, 0];
/** Orthogonal → cosine 0 → always a mint. */
const OTHER_EMBEDDING = [0, 1, 0, 0];

const neverCalledProvider = {
  judgeSignalMatch: async () => {
    throw new Error("the judge must not be consulted in these scenarios");
  },
} as unknown as ModelProvider;

async function seedProfile(): Promise<string> {
  seq += 1;
  const [account] = await t.sql`
    INSERT INTO accounts (email) VALUES (${`lock-contract-${seq}@example.test`}) RETURNING id`;
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
): Promise<{ minted: string[]; matched: string[]; promoted: string[] }> {
  return t.db.transaction(async (tx) => {
    await acquireSignalDerivationLock(tx as never, profileId);
    const result = await applyCandidates(tx as never, {
      profileId,
      evidenceOwnerProfileId: profileId,
      inspirationId,
      candidates: [{ statement, reason: null, quote: null, quoteSource: null, embedding }],
      embeddingModel: EMBEDDING_MODEL,
      provider: neverCalledProvider,
      preferredLocale: "en-US" as never,
      now: new Date(),
    });
    return {
      minted: result.mintedSignalIds,
      matched: result.matchedSignalIds,
      promoted: result.promotedSignalIds,
    };
  });
}

const signalRow = async (signalId: string) => {
  const [row] = await t.sql`
    SELECT statement, status, locked_at, unsupported_at FROM signals WHERE id = ${signalId}`;
  return row;
};

const evidenceCount = async (signalId: string) => {
  const [row] = await t.sql`
    SELECT count(*)::int AS n FROM signal_evidence WHERE signal_id = ${signalId}`;
  return row.n as number;
};

afterAll(async () => {
  await t?.cleanup();
});

describe("regeneration updates a locked signal's support, never its words", () => {
  beforeEach(async () => {
    t ??= await createTestDatabase();
    await t.truncateAll();
  });

  it("keeps the owner's words byte-identical across three passes while evidence and promotion proceed", async () => {
    const profileId = await seedProfile();
    const first = await seedInspiration(profileId, "turned down the platform team again");
    const { minted } = await derive(profileId, first, "You keep choosing depth.", NEAR_EMBEDDING);
    expect(minted).toHaveLength(1);
    const signalId = minted[0]!;

    const ownersWords = "깊이를 고른다 — 넓이가 아니라.";
    const edited = await updateSignalStatement(t.db as never, {
      profileId,
      signalId,
      statement: ownersWords,
    });
    expect(edited?.locked).toBe(true);

    // Three more captures land on the same pattern. The model proposes its
    // own wording every time; the owner's must survive every pass.
    for (const [i, wording] of [
      "You always pick depth over breadth.",
      "Depth wins with you, every time.",
      "You keep choosing depth over breadth.",
    ].entries()) {
      const record = await seedInspiration(profileId, `evidence number ${i + 2}`);
      const pass = await derive(profileId, record, wording, NEAR_EMBEDDING);
      expect(pass.matched, `pass ${i + 1} should attach, not mint`).toEqual([signalId]);
      const row = await signalRow(signalId);
      expect(
        row.statement,
        "regeneration reworded a sentence the owner locked",
      ).toBe(ownersWords);
    }

    const row = await signalRow(signalId);
    expect(await evidenceCount(signalId), "evidence must keep accruing under the lock").toBe(4);
    expect(row.status, "a locked signal still promotes on recurrence").toBe("active");
    expect(row.locked_at).not.toBeNull();
  });

  it("release hands the wording back to the generator", async () => {
    const profileId = await seedProfile();
    const first = await seedInspiration(profileId, "a first sighting");
    const { minted } = await derive(profileId, first, "Model's first draft.", NEAR_EMBEDDING);
    const signalId = minted[0]!;

    await updateSignalStatement(t.db as never, {
      profileId,
      signalId,
      statement: "내가 고쳐 쓴 문장.",
    });

    // Locked: the next pass attaches but may not restate.
    const second = await seedInspiration(profileId, "a second sighting");
    await derive(profileId, second, "Model's better wording.", NEAR_EMBEDDING);
    expect((await signalRow(signalId)).statement).toBe("내가 고쳐 쓴 문장.");

    const released = await releaseSignalStatement(t.db as never, { profileId, signalId });
    expect(released?.locked).toBe(false);
    expect(
      (await signalRow(signalId)).statement,
      "release itself must not rewrite anything",
    ).toBe("내가 고쳐 쓴 문장.");

    // Released and still emerging: the pipeline may now restate — the
    // confirming capture usually names the pattern better.
    const third = await seedInspiration(profileId, "a third sighting");
    await derive(profileId, third, "The pattern, named properly.", NEAR_EMBEDDING);
    expect(
      (await signalRow(signalId)).statement,
      "after release the generator has jurisdiction again",
    ).toBe("The pattern, named properly.");
  });

  it("release retires words that were standing on nothing", async () => {
    const profileId = await seedProfile();
    const record = await seedInspiration(profileId, "the only support it ever had");
    const { minted } = await derive(profileId, record, "A pattern.", NEAR_EMBEDDING);
    const signalId = minted[0]!;
    await updateSignalStatement(t.db as never, {
      profileId,
      signalId,
      statement: "잃어버린 근거 위의 문장.",
    });
    // Simulate the lifecycle outcome of total evidence loss on a locked
    // signal: the words stand, marked unsupported.
    await t.sql`DELETE FROM signal_evidence WHERE signal_id = ${signalId}`;
    await t.sql`UPDATE signals SET unsupported_at = now() WHERE id = ${signalId}`;

    const released = await releaseSignalStatement(t.db as never, { profileId, signalId });
    expect(released).not.toBeNull();

    const row = await signalRow(signalId);
    expect(row.status, "no evidence and no lock means retired — the standing rule").toBe("retired");
    expect(row.unsupported_at).toBeNull();
    expect(row.locked_at).toBeNull();
  });

  it("stores a quote only as a verified span of the person's words or their page — no invented quotes, ever", async () => {
    // The full derivation path — load capture, reflections, enrichment;
    // verify; match-or-mint — with the model stubbed at both call sites.
    const profileId = await seedProfile();
    const [row] = await t.sql`
      INSERT INTO inspirations (profile_id, text)
      VALUES (${profileId}, ${"감기 걸린 날이라 오늘은 회 말고 국물이 좋겠다."}) RETURNING id`;
    const inspirationId = row.id as string;
    await t.sql`
      INSERT INTO reflections (profile_id, inspiration_id, question, answer)
      VALUES (${profileId}, ${inspirationId}, ${"왜 남겼나요?"}, ${"몸이 아픈 날의 예외를 기억하고 싶어서."})`;
    await t.sql`
      INSERT INTO attachments (profile_id, inspiration_id, type, url, enrichment_status, enrichment_kind, enrichment_text)
      VALUES (${profileId}, ${inspirationId}, 'link', ${"https://example.test/soup"}, 'ready', 'page_body', ${"따뜻한 국물 요리가 감기 회복에 좋다는 오랜 통설이 있다."})`;

    const claims = [
      // Verbatim from the person's capture — must survive, labeled own.
      { statement: "Sick days change the food rules.", quote: "감기 걸린 날이라 오늘은 회 말고" },
      // Verbatim from the reflection answer — the person's words too.
      { statement: "Exceptions are worth remembering.", quote: "몸이 아픈 날의 예외를 기억하고 싶어서" },
      // Verbatim from the page behind the link — the article speaking.
      { statement: "Soup reads as recovery food.", quote: "따뜻한 국물 요리가 감기 회복에 좋다는" },
      // A paraphrase that appears nowhere — must be refused to null.
      { statement: "Dislikes raw fish.", quote: "회를 싫어한다고 분명히 말했다" },
    ];
    const provider = {
      extractSignalCandidates: async () => ({
        statements: claims.map((claim) => ({
          statement: claim.statement,
          reason: "test reason",
          quote: claim.quote,
        })),
      }),
      judgeSignalMatch: async () => {
        throw new Error("orthogonal embeddings never reach the judge band");
      },
    } as unknown as ModelProvider;
    // Orthogonal unit vectors so all four candidates mint independently —
    // 768-wide because the layer-1 embedding path validates the width.
    let call = 0;
    const embeddingClient = {
      model: EMBEDDING_MODEL,
      embed: async () => {
        const vector = new Array<number>(768).fill(0);
        vector[call % 4] = 1;
        call += 1;
        return vector;
      },
    };

    const result = await deriveSignalsForInspiration(
      { inspirationId, reason: "created" },
      { db: t.db as never, modelProvider: provider, embeddingClient },
    );
    expect(result.status).toBe("derived");
    expect(result.mintedSignalIds).toHaveLength(4);

    const evidence = await t.sql`
      SELECT s.statement, e.quote, e.quote_source
      FROM signal_evidence e INNER JOIN signals s ON s.id = e.signal_id
      WHERE e.inspiration_id = ${inspirationId}`;
    const byStatement = new Map(
      evidence.map((r) => [r.statement as string, r as { quote: string | null; quote_source: string | null }]),
    );

    expect(byStatement.get("Sick days change the food rules.")).toMatchObject({
      quote: "감기 걸린 날이라 오늘은 회 말고",
      quote_source: "own",
    });
    expect(byStatement.get("Exceptions are worth remembering.")).toMatchObject({
      quote: "몸이 아픈 날의 예외를 기억하고 싶어서",
      quote_source: "own",
    });
    expect(byStatement.get("Soup reads as recovery food.")).toMatchObject({
      quote: "따뜻한 국물 요리가 감기 회복에 좋다는",
      quote_source: "enrichment",
    });
    expect(
      byStatement.get("Dislikes raw fish."),
      "an invented quote must be refused to honest-null, never stored",
    ).toMatchObject({ quote: null, quote_source: null });
  });

  it("still mints a fresh signal for an unrelated pattern while another is locked", async () => {
    // Guards against over-broad lock handling: the lock protects one
    // sentence, not the profile's whole sky.
    const profileId = await seedProfile();
    const first = await seedInspiration(profileId, "first pattern");
    const { minted } = await derive(profileId, first, "Pattern one.", NEAR_EMBEDDING);
    await updateSignalStatement(t.db as never, {
      profileId,
      signalId: minted[0]!,
      statement: "잠긴 문장.",
    });

    const second = await seedInspiration(profileId, "something else entirely");
    const other = await derive(profileId, second, "A different pattern.", OTHER_EMBEDDING);
    expect(other.minted).toHaveLength(1);
    expect(other.matched).toHaveLength(0);
  });
});
