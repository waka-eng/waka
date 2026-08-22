/**
 * A ROOM CAN HEAR ITS MEMBERS ANSWER — AND SPEAKS ONLY FROM WHAT THEY AFFIRMED.
 *
 * goal: a-room-you-can-trust, Phase 1a + 1b. Three rules, each a database
 * fact only a real database can prove:
 *
 *   1. STANDING MIRRORS THE WALL. A member may answer a statement only while
 *      it stands on a wall they and its owner are both currently in. A
 *      non-member never could; an owner's departure withdraws the standing
 *      the wall already withdrew.
 *
 *   2. THE WALL NAMES WHO ANSWERED. Latest verdict per current member,
 *      reactor never the owner — who stands where, never a tally, and never
 *      anything beneath the statement.
 *
 *   3. THE FIRST DRAFT WAITS FOR AFFIRMED MATERIAL. A room with no standing
 *      artifact drafts only once GROUP_DRAFT_MIN_AFFIRMED shared statements
 *      are affirmed by someone other than their owner; below the bar the
 *      pass says so (`waiting_for_affirmations`) instead of writing a thin
 *      version. Established rooms keep re-reading.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDatabase } from "../../test/helpers/index.js";
import type { ModelProvider } from "../lib/model-provider.js";
import {
  GROUP_DRAFT_MIN_AFFIRMED,
  refreshTopOfMindForGroup,
} from "../lib/top-of-mind-synthesis.js";
import { createFeedbackForProfile } from "./feedback.js";
import {
  createGroupForProfile,
  joinGroupByCode,
  leaveGroup,
} from "./groups-membership.js";
import { loadGroupWall } from "./groups-wall.js";
import { shareSignalWithGroup } from "./signals.js";

let t: TestDatabase;
let seq = 0;

async function seedPerson(name: string): Promise<string> {
  seq += 1;
  const [account] = await t.sql`
    INSERT INTO accounts (email) VALUES (${`reactions-${seq}-${name}@example.test`}) RETURNING id`;
  const [p] = await t.sql`
    INSERT INTO profiles (account_id, type, name)
    VALUES (${account.id}, 'human', ${name}) RETURNING id`;
  return p.id as string;
}

async function seedSignal(profileId: string, statement: string): Promise<string> {
  const [row] = await t.sql`
    INSERT INTO signals (profile_id, statement) VALUES (${profileId}, ${statement}) RETURNING id`;
  return row.id as string;
}

async function seedGroup(): Promise<{ groupId: string; a: string; b: string }> {
  const a = await seedPerson("Ari");
  const b = await seedPerson("Bo");
  const group = await createGroupForProfile(t.db as never, { profileId: a, name: "the room" });
  const joined = await joinGroupByCode(t.db as never, { profileId: b, joinCode: group.joinCode });
  expect(joined.ok).toBe(true);
  return { groupId: group.id, a, b };
}

const react = (profileId: string, signalId: string, value: "true" | "partly" | "not_true") =>
  createFeedbackForProfile(t.db as never, {
    profileId,
    targetType: "signal",
    targetId: signalId,
    value,
  });

/** The group synthesis, with the model stubbed to echo one entry per signal. */
const draft = (groupId: string) =>
  refreshTopOfMindForGroup(
    { groupId, reason: "test" },
    {
      db: t.db as never,
      modelProvider: {
        synthesizeTopOfMind: async (input: {
          signals: Array<{ id: string; statement: string }>;
        }) => ({
          entries: input.signals.slice(0, 3).map((signal) => ({
            type: "pattern" as const,
            body: `The room keeps hearing: ${signal.statement}`,
            citedSignalIds: [signal.id],
          })),
        }),
      } as unknown as ModelProvider,
    },
  );

afterAll(async () => {
  await t?.cleanup();
});

describe("standing mirrors the wall", () => {
  beforeEach(async () => {
    t ??= await createTestDatabase();
    await t.truncateAll();
  });

  it("lets a member answer another member's shared statement, and nobody else", async () => {
    const g = await seedGroup();
    const signalId = await seedSignal(g.a, "keeps choosing depth over breadth");
    expect(
      await shareSignalWithGroup(t.db as never, {
        profileId: g.a,
        signalId,
        groupId: g.groupId,
      }),
    ).toBe("shared");

    const answered = await react(g.b, signalId, "true");
    expect(answered, "a member could not answer a statement said in their room").not.toBeNull();

    const stranger = await seedPerson("Cy");
    expect(
      await react(stranger, signalId, "true"),
      "someone outside the room answered a statement they cannot see",
    ).toBeNull();
  });

  it("withdraws answerability when the owner leaves — the wall already withdrew the statement", async () => {
    const g = await seedGroup();
    const signalId = await seedSignal(g.a, "keeps choosing depth over breadth");
    await shareSignalWithGroup(t.db as never, { profileId: g.a, signalId, groupId: g.groupId });

    await leaveGroup(t.db as never, { profileId: g.a, groupId: g.groupId });

    expect(
      await loadGroupWall(t.db as never, g.groupId),
      "the wall still shows a departed member's statement",
    ).toHaveLength(0);
    expect(
      await react(g.b, signalId, "true"),
      "a verdict was filed against a statement the room can no longer see",
    ).toBeNull();
  });

  it("shows who answered on the wall — latest verdict, named, never the owner's own, nothing beneath", async () => {
    const g = await seedGroup();
    const signalId = await seedSignal(g.a, "keeps choosing depth over breadth");
    await shareSignalWithGroup(t.db as never, { profileId: g.a, signalId, groupId: g.groupId });

    // Bo answers twice — the later word stands. Ari's self-verdict is
    // private curation and must not surface as a reaction the room heard.
    await react(g.b, signalId, "true");
    await react(g.b, signalId, "partly");
    await react(g.a, signalId, "not_true");

    const wall = await loadGroupWall(t.db as never, g.groupId);
    expect(wall).toHaveLength(1);
    expect(wall[0]!.reactions).toHaveLength(1);
    expect(wall[0]!.reactions[0]).toMatchObject({ profileId: g.b, value: "partly" });
    expect(
      Object.keys(wall[0]!.reactions[0]!).sort(),
      "a reaction row carries a name and a verdict, never anything more",
    ).toEqual(["name", "profileId", "value"]);
  });
});

describe("the first draft waits for affirmed material", () => {
  beforeEach(async () => {
    t ??= await createTestDatabase();
    await t.truncateAll();
  });

  it("stays legibly silent below the bar, and drafts once the room has affirmed enough", async () => {
    const g = await seedGroup();
    const signalIds: string[] = [];
    for (let i = 0; i < GROUP_DRAFT_MIN_AFFIRMED; i += 1) {
      const signalId = await seedSignal(g.a, `pattern number ${i + 1}`);
      await shareSignalWithGroup(t.db as never, {
        profileId: g.a,
        signalId,
        groupId: g.groupId,
      });
      signalIds.push(signalId);
    }

    // Shared but unaffirmed: the room does not speak, and says why.
    expect((await draft(g.groupId)).status).toBe("waiting_for_affirmations");

    // Two affirmations — still short by one, and the owner cannot make up
    // the difference by agreeing with themselves.
    await react(g.b, signalIds[0]!, "true");
    await react(g.b, signalIds[1]!, "true");
    await react(g.a, signalIds[2]!, "true");
    expect(
      (await draft(g.groupId)).status,
      "an owner's self-agreement counted toward the room's bar",
    ).toBe("waiting_for_affirmations");

    // The third genuine affirmation crosses the bar; the room speaks.
    await react(g.b, signalIds[2]!, "true");
    const spoken = await draft(g.groupId);
    expect(spoken.status).toBe("versioned");
    expect(spoken.reason).toBe("initial");
    expect(spoken.entryCount).toBeGreaterThan(0);

    // And an established room is never re-gated: a withdrawn affirmation
    // does not silence what the room already said — it re-reads instead.
    await react(g.b, signalIds[2]!, "not_true");
    const reread = await draft(g.groupId);
    expect(reread.status, "an established room went silent instead of re-reading").toBe(
      "versioned",
    );
  });

  it("a later not-true withdraws an affirmation before the room ever speaks", async () => {
    const g = await seedGroup();
    const signalIds: string[] = [];
    for (let i = 0; i < GROUP_DRAFT_MIN_AFFIRMED; i += 1) {
      const signalId = await seedSignal(g.a, `pattern number ${i + 1}`);
      await shareSignalWithGroup(t.db as never, {
        profileId: g.a,
        signalId,
        groupId: g.groupId,
      });
      signalIds.push(signalId);
      await react(g.b, signalId, "true");
    }

    await react(g.b, signalIds[0]!, "not_true");

    expect(
      (await draft(g.groupId)).status,
      "a withdrawn affirmation still counted toward the first draft",
    ).toBe("waiting_for_affirmations");
  });
});
