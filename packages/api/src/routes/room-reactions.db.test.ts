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
  GROUP_DRAFT_MIN_AFFIRMED_SMALL,
  GROUP_DRAFT_SMALL_MAX_MEMBERS,
  refreshTopOfMindForGroup,
} from "../lib/top-of-mind-synthesis.js";
import { createFeedbackForProfile } from "./feedback.js";
import {
  createGroupForProfile,
  joinGroupByCode,
  leaveGroup,
} from "./groups-membership.js";
import { loadGroupWall } from "./groups-wall.js";

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

/**
 * A signal the ROOM GREW: owned by the room's mind, standing on one public
 * memory from each named member — the two-voices shape the wall and the
 * synthesis serve since the 2026-08-24 rulings.
 */
async function seedGrownSignal(
  groupId: string,
  statement: string,
  voices: string[],
): Promise<string> {
  const [mind] = await t.sql`
    SELECT id FROM profiles WHERE group_id = ${groupId} AND type = 'group'`;
  const [sig] = await t.sql`
    INSERT INTO signals (profile_id, statement, input_policy) VALUES (${mind!.id}, ${statement}, 'group-public-v1') RETURNING id`;
  for (const voice of voices) {
    const [memory] = await t.sql`
      INSERT INTO inspirations (profile_id, text, visibility)
      VALUES (${voice}, ${`a memory behind: ${statement}`}, 'public') RETURNING id`;
    await t.sql`
      INSERT INTO signal_evidence (profile_id, owner_profile_id, signal_id, inspiration_id)
      VALUES (${mind!.id}, ${voice}, ${sig!.id}, ${memory!.id})`;
  }
  return sig!.id as string;
}

async function seedGroup(): Promise<{ groupId: string; a: string; b: string }> {
  const a = await seedPerson("Ari");
  const b = await seedPerson("Bo");
  const group = await createGroupForProfile(t.db as never, { profileId: a, name: "the room" });
  const joined = await joinGroupByCode(t.db as never, { profileId: b, joinCode: group.joinCode });
  expect(joined.ok).toBe(true);
  return { groupId: group.id, a, b };
}

/**
 * A room ABOVE the small-room size, so it is held to the larger bar.
 *
 * One more member than `GROUP_DRAFT_SMALL_MAX_MEMBERS`, derived rather
 * than typed: raise or lower that constant and this fixture follows it, so
 * the pair of tests below can never both end up on the same side of the line
 * without one of them failing.
 */
async function seedBigGroup(): Promise<{ groupId: string; members: string[] }> {
  const owner = await seedPerson("Ari");
  const group = await createGroupForProfile(t.db as never, {
    profileId: owner,
    name: "the bigger room",
  });
  const members = [owner];
  for (let i = 0; i < GROUP_DRAFT_SMALL_MAX_MEMBERS; i += 1) {
    const person = await seedPerson(`Member ${i + 1}`);
    const joined = await joinGroupByCode(t.db as never, {
      profileId: person,
      joinCode: group.joinCode,
    });
    expect(joined.ok).toBe(true);
    members.push(person);
  }
  expect(
    members.length,
    "the bigger room has to be bigger than a small room, or it tests the same rule twice",
  ).toBeGreaterThan(GROUP_DRAFT_SMALL_MAX_MEMBERS);
  return { groupId: group.id, members };
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

/**
 * A share, written straight into the table.
 *
 * The verb that used to create these retired on 2026-08-24 — a room grows its
 * own statements now — but the ROWS are still real: they are a person's own
 * history, the export carries them, and `routes/feedback.ts` still honours an
 * old share as standing to answer the statement it put up. That standing is
 * what these cases hold, so they write the history directly rather than
 * through a door the product no longer has.
 */
async function seedLegacyShare(input: {
  profileId: string;
  signalId: string;
  groupId: string;
}): Promise<void> {
  await t.sql`
    INSERT INTO signal_shares (profile_id, signal_id, group_id)
    VALUES (${input.profileId}, ${input.signalId}, ${input.groupId})`;
}

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
    await seedLegacyShare({ profileId: g.a, signalId, groupId: g.groupId });

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
    await seedLegacyShare({ profileId: g.a, signalId, groupId: g.groupId });

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

  it("stops taking answers once the room has set a statement aside", async () => {
    /* A dismissal is the room putting a statement down, and the wall stops
       serving it the moment it happens — so nobody can be looking at one.
       Accepting a stance on it would file an answer to something that will
       never be shown back. (The two-voices gate is deliberately NOT applied
       to answerability: that is a statement drifting below the bar while
       somebody had it on screen, which is a race worth forgiving. This is a
       decision, and there is nothing to forgive.) */
    const g = await seedGroup();
    const mindRows = await t.sql`
      SELECT id FROM profiles WHERE group_id = ${g.groupId} AND type = 'group'`;
    const mind = mindRows[0]!.id as string;
    const signalId = await seedSignal(mind, "this room keeps choosing depth over breadth");

    expect(
      await react(g.b, signalId, "true"),
      "a member could not answer a statement their own room grew",
    ).not.toBeNull();

    await t.sql`UPDATE signals SET dismissed_at = now() WHERE id = ${signalId}`;

    expect(
      await react(g.a, signalId, "true"),
      "a verdict was filed against a statement the room had already put down",
    ).toBeNull();
  });

  it("shows who answered on the wall — latest verdict per member, named, nothing beneath", async () => {
    const g = await seedGroup();
    const signalId = await seedGrownSignal(g.groupId, "keeps choosing depth over breadth", [
      g.a,
      g.b,
    ]);

    // Bo answers twice — the later word stands. Ari's stance surfaces too:
    // a room-grown statement has no single owner whose self-verdict would be
    // private curation, so every member's answer is a reaction the room heard.
    await react(g.b, signalId, "true");
    await react(g.b, signalId, "partly");
    await react(g.a, signalId, "not_true");

    const wall = await loadGroupWall(t.db as never, g.groupId);
    expect(wall).toHaveLength(1);
    expect(wall[0]!.contributors.map((c) => c.profileId).sort()).toEqual([g.a, g.b].sort());
    const byMember = new Map(wall[0]!.reactions.map((r) => [r.profileId, r.value]));
    expect(byMember.get(g.b), "the later word stands").toBe("partly");
    expect(byMember.get(g.a), "a contributor's stance counts like anyone's").toBe("not_true");
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

  /**
   * THE BAR READS THE ROOM (founder ruling, 2026-08-25).
   *
   * Three affirmations was a proportion argument wearing an absolute
   * number's clothes. The count is over SHARED STATEMENTS, so a pair who
   * have put two statements up can never reach three however many times each
   * is affirmed — the gate did not slow a small room down, it closed it. Two
   * tests, one on each side of the line, because a single-sided test would
   * pass just as well if the size check were deleted.
   */
  it("a small room speaks at two, and is legibly silent at one", async () => {
    const g = await seedGroup(); /* two members: at or under the small-room size */
    const signalIds: string[] = [];
    for (let i = 0; i < GROUP_DRAFT_MIN_AFFIRMED_SMALL; i += 1) {
      signalIds.push(
        await seedGrownSignal(g.groupId, `pattern number ${i + 1}`, [g.a, g.b]),
      );
    }

    // Grown but unaffirmed: the room does not speak, and says why.
    expect((await draft(g.groupId)).status).toBe("waiting_for_affirmations");

    // One affirmed — short by one, and two is the floor: one person agreeing
    // once is not a room agreeing.
    await react(g.b, signalIds[0]!, "true");
    expect(
      (await draft(g.groupId)).status,
      "one affirmed statement was enough for a room to speak first",
    ).toBe("waiting_for_affirmations");

    // The second is affirmed — by the other member, which counts the same;
    // the room speaks. Under the old flat bar of three this pair never could.
    await react(g.a, signalIds[1]!, "true");
    const spoken = await draft(g.groupId);
    expect(spoken.status).toBe("versioned");
    expect(spoken.reason).toBe("initial");
    expect(spoken.entryCount).toBeGreaterThan(0);

    // And an established room is never re-gated: a withdrawn affirmation
    // does not silence what the room already said — it re-reads instead.
    await react(g.b, signalIds[0]!, "not_true");
    const reread = await draft(g.groupId);
    expect(reread.status, "an established room went silent instead of re-reading").toBe(
      "versioned",
    );
  });

  it("a bigger room is still held to three — two is not enough there", async () => {
    const g = await seedBigGroup();
    const [a, b] = g.members as [string, string];
    const signalIds: string[] = [];
    for (let i = 0; i < GROUP_DRAFT_MIN_AFFIRMED; i += 1) {
      signalIds.push(
        await seedGrownSignal(g.groupId, `pattern number ${i + 1}`, [a, b]),
      );
    }

    await react(b, signalIds[0]!, "true");
    await react(b, signalIds[1]!, "true");
    expect(
      (await draft(g.groupId)).status,
      "two affirmed statements crossed a bar of three in a room too big for the small-room rule",
    ).toBe("waiting_for_affirmations");

    await react(a, signalIds[2]!, "true");
    const spoken = await draft(g.groupId);
    expect(spoken.status).toBe("versioned");
    expect(spoken.reason).toBe("initial");
  });

  it("a later not-true withdraws an affirmation before the room ever speaks", async () => {
    const g = await seedGroup();
    const signalIds: string[] = [];
    for (let i = 0; i < GROUP_DRAFT_MIN_AFFIRMED_SMALL; i += 1) {
      const signalId = await seedGrownSignal(g.groupId, `pattern number ${i + 1}`, [
        g.a,
        g.b,
      ]);
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
