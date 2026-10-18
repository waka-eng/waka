/**
 * CONTESTED PAIRS ARE HELD — AND ONLY THE OWNER SETTLES THEM.
 *
 * goal: no-quiet-corners, Phase 5 (register item 4). Inside the ambiguous
 * cosine band, an `opposed` verdict from the three-way judge mints the new
 * signal AND records the undirected contradicts pair, so the dispute is
 * held instead of dissolved by whichever statement came second. Both sides
 * serve as contested; an owner act — a lock, a verdict, a dismissal —
 * resolves; the loser reads YIELDED with its row intact. Owner-only
 * resolution is doctrine (founder, 2026-08-23, signed in data-model.md).
 *
 * These cases drive the real pipeline: `applyCandidates` with a provider
 * stub answering `opposed` at a judge-band cosine, `updateSignalStatement`
 * as the lock, `createFeedbackForProfile` as the verdict, and
 * `dismissProfileSignal` as the dismissal — on real Postgres. The judge's
 * request/parse contract (all three verdicts, malformed → independent)
 * lives in `gemini-judge.test.ts`.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDatabase } from "../../test/helpers/index.js";
import { createFeedbackForProfile } from "../routes/feedback.js";
import {
  dismissProfileSignal,
  listProfileSignals,
  updateSignalStatement,
} from "../routes/signals.js";
import { applyCandidates, acquireSignalDerivationLock } from "./signal-match-or-mint.js";
import type { ModelProvider, SignalMatchJudgement } from "./model-provider.js";

let t: TestDatabase;
let seq = 0;

const EMBEDDING_MODEL = "contested-test-embedding";
const FIRST_EMBEDDING = [1, 0, 0, 0];
/** cosine 0.8 to the first — inside the judge band (0.7 ≤ x < 0.86). */
const BAND_EMBEDDING = [0.8, 0.6, 0, 0];

function providerAnswering(relation: SignalMatchJudgement["relation"]): ModelProvider {
  return {
    judgeSignalMatch: async () => ({ relation }),
  } as unknown as ModelProvider;
}

async function seedProfile(): Promise<string> {
  seq += 1;
  const [account] = await t.sql`
    INSERT INTO accounts (email) VALUES (${`contested-${seq}@example.test`}) RETURNING id`;
  const [p] = await t.sql`
    INSERT INTO profiles (account_id, type, name)
    VALUES (${account.id}, 'human', 'Owner') RETURNING id`;
  return p.id as string;
}

async function derive(
  profileId: string,
  statement: string,
  embedding: number[],
  provider: ModelProvider,
): Promise<{ minted: string[]; matched: string[] }> {
  const [insp] = await t.sql`
    INSERT INTO inspirations (profile_id, text) VALUES (${profileId}, ${"a sighting"}) RETURNING id`;
  return t.db.transaction(async (tx) => {
    await acquireSignalDerivationLock(tx as never, profileId);
    const result = await applyCandidates(tx as never, {
      beforeWrites: async () => {}, // synthetic candidates isolate contradiction handling
      profileId,
      evidenceOwnerProfileId: profileId,
      inspirationId: insp.id as string,
      candidates: [{ statement, reason: null, quote: null, quoteSource: null, relatedEvidence: [], embedding }],
      embeddingModel: EMBEDDING_MODEL,
      provider,
      preferredLocale: "en-US" as never,
      now: new Date(),
    });
    return { minted: result.mintedSignalIds, matched: result.matchedSignalIds };
  });
}

/** One opposed pair, minted through the real pipeline. */
async function mintOpposedPair(
  profileId: string,
): Promise<{ first: string; second: string }> {
  const a = await derive(
    profileId,
    "You are a morning person.",
    FIRST_EMBEDDING,
    providerAnswering("independent"),
  );
  const b = await derive(
    profileId,
    "Mornings are when you shut down.",
    BAND_EMBEDDING,
    providerAnswering("opposed"),
  );
  expect(b.minted).toHaveLength(1);
  return { first: a.minted[0]!, second: b.minted[0]! };
}

const standings = async (profileId: string) => {
  const rows = await listProfileSignals(t.db as never, { profileId, limit: 50 });
  return new Map(rows.map((row) => [row.id, { contested: row.contested, yielded: row.yielded }]));
};

const pairRows = async (profileId: string) =>
  t.sql`
    SELECT a_signal_id, b_signal_id, resolved_at, yielded_signal_id, resolved_by
    FROM signal_contradictions WHERE profile_id = ${profileId}`;

afterAll(async () => {
  await t?.cleanup();
});

describe("contested pairs are held, and only the owner settles them", () => {
  beforeEach(async () => {
    t ??= await createTestDatabase();
    await t.truncateAll();
  });

  it("an opposed verdict mints the signal AND the pair, and both sides serve contested", async () => {
    const profileId = await seedProfile();
    const { first, second } = await mintOpposedPair(profileId);

    const pairs = await pairRows(profileId);
    expect(pairs).toHaveLength(1);
    expect([pairs[0]!.a_signal_id, pairs[0]!.b_signal_id].sort()).toEqual(
      [first, second].sort(),
    );
    expect(pairs[0]!.resolved_at).toBeNull();

    const served = await standings(profileId);
    expect(served.get(first), "the standing side serves contested").toMatchObject({
      contested: true,
      yielded: false,
    });
    expect(served.get(second), "the newcomer serves contested too").toMatchObject({
      contested: true,
      yielded: false,
    });
  });

  it("same still attaches and independent still mints clean — no phantom pairs", async () => {
    /* fresh ground per verdict: a same-attach restates the emerging target
       and moves its vector, so reusing one profile would let the second
       candidate land above the match bar and skip the judge entirely */
    const attachedGround = await seedProfile();
    await derive(attachedGround, "First pattern.", FIRST_EMBEDDING, providerAnswering("independent"));
    const attached = await derive(
      attachedGround,
      "The first pattern, reworded.",
      BAND_EMBEDDING,
      providerAnswering("same"),
    );
    expect(attached.matched).toHaveLength(1);
    expect(attached.minted).toHaveLength(0);
    expect(await pairRows(attachedGround)).toHaveLength(0);

    const independentGround = await seedProfile();
    await derive(
      independentGround,
      "First pattern.",
      FIRST_EMBEDDING,
      providerAnswering("independent"),
    );
    const independent = await derive(
      independentGround,
      "Another thing entirely.",
      BAND_EMBEDDING,
      providerAnswering("independent"),
    );
    expect(independent.minted).toHaveLength(1);
    expect(await pairRows(independentGround)).toHaveLength(0);
  });

  it("a lock resolves in the held side's favor; the loser yields with its row intact", async () => {
    const profileId = await seedProfile();
    const { first, second } = await mintOpposedPair(profileId);

    await updateSignalStatement(t.db as never, {
      profileId,
      signalId: first,
      statement: "I am a morning person — my own words.",
    });

    const [pair] = await pairRows(profileId);
    expect(pair!.resolved_at).not.toBeNull();
    expect(pair!.yielded_signal_id).toBe(second);
    expect(pair!.resolved_by).toBe("lock");

    const served = await standings(profileId);
    expect(served.get(first)).toMatchObject({ contested: false, yielded: false });
    expect(served.get(second)).toMatchObject({ contested: false, yielded: true });
    const [loserRow] = await t.sql`
      SELECT statement, status FROM signals WHERE id = ${second}`;
    expect(loserRow!.statement, "yielded is a state, never a deletion").toBe(
      "Mornings are when you shut down.",
    );
  });

  it("a not_true verdict yields the answered side; true yields the other; partly settles nothing", async () => {
    const profileId = await seedProfile();
    const { first, second } = await mintOpposedPair(profileId);

    await createFeedbackForProfile(t.db as never, {
      profileId,
      targetType: "signal",
      targetId: first,
      value: "partly",
    });
    expect((await pairRows(profileId))[0]!.resolved_at, "partly is not an arbitration").toBeNull();

    await createFeedbackForProfile(t.db as never, {
      profileId,
      targetType: "signal",
      targetId: first,
      value: "not_true",
    });
    const [pair] = await pairRows(profileId);
    expect(pair!.yielded_signal_id, "not_true yields the side it answered").toBe(first);
    expect(pair!.resolved_by).toBe("verdict");
    expect((await standings(profileId)).get(second)).toMatchObject({
      contested: false,
      yielded: false,
    });
  });

  it("dismissing a side settles its dispute — the thrown-out side yields", async () => {
    const profileId = await seedProfile();
    const { second } = await mintOpposedPair(profileId);

    await dismissProfileSignal(t.db as never, { profileId, signalId: second });

    const [pair] = await pairRows(profileId);
    expect(pair!.yielded_signal_id).toBe(second);
    expect(pair!.resolved_by).toBe("dismissal");
  });

  it("a co-member cannot answer a shared or room-grown statement, so arbitrates nothing", async () => {
    const profileId = await seedProfile();
    const neighbour = await seedProfile();
    const { first } = await mintOpposedPair(profileId);

    /* Room standing to answer retired with the room engine (2026-10-17).
       The legacy rows that used to grant it are seated exactly as they sit
       in the database — a share into a room both are in, and a statement
       the room's mind grew — and neither lets the neighbour file anything. */
    const [group] = await t.sql`
      INSERT INTO groups (name, join_code, created_by_profile_id)
      VALUES (${"a room"}, ${`code-${seq}`}, ${profileId}) RETURNING id`;
    await t.sql`
      INSERT INTO group_members (group_id, profile_id, role) VALUES
      (${group.id}, ${profileId}, 'owner'), (${group.id}, ${neighbour}, 'member')`;
    await t.sql`
      INSERT INTO signal_shares (profile_id, signal_id, group_id)
      VALUES (${profileId}, ${first}, ${group.id})`;

    const [mind] = await t.sql`
      INSERT INTO profiles (account_id, type, name, group_id) VALUES (NULL, 'group', 'a room', ${group.id}) RETURNING id`;
    const [grown] = await t.sql`
      INSERT INTO signals (profile_id, statement) VALUES (${mind.id}, 'A statement the room grew') RETURNING id`;

    for (const targetId of [first, grown.id as string]) {
      const answered = await createFeedbackForProfile(t.db as never, {
        profileId: neighbour,
        targetType: "signal",
        targetId,
        value: "true",
      });
      expect(answered, "a co-member's answer is refused").toBeNull();
    }
    expect(await t.sql`SELECT id FROM feedback WHERE profile_id = ${neighbour}`).toHaveLength(0);
    expect(
      (await pairRows(profileId))[0]!.resolved_at,
      "someone else's verdict must not settle the owner's pair",
    ).toBeNull();
  });
});
