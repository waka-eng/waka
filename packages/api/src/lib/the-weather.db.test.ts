/**
 * THE WEATHER IS A VIEW OF THE RECORD — pinned against real rows.
 *
 * goal: the-legible-loop, Phase 5. A seeded fortnight must render as told
 * sentences with zero numerals and zero events that lack a backing record:
 * the narration is a VIEW, so deleting a record deletes its sentence — the
 * central case here. The antechamber renders each suppression with its
 * anchor reachable, and a departed anchor leaves a mark, never a dangling
 * id.
 *
 * No model, no writes from the telling itself: `assembleTheWeather` only
 * SELECTs, and this suite would catch it growing an INSERT the same way the
 * delete-vanish cases catch a summary that is stored instead of derived.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDatabase } from "../../test/helpers/index.js";
import { assembleTheWeather, renderTheWeather, wordedDaysAgo } from "./the-weather.js";

let t: TestDatabase;
let seq = 0;

/** A fixed clock, so "yesterday" is a fact and not a race. */
const NOW = new Date("2026-08-24T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number, hours = 0) =>
  new Date(NOW.getTime() - n * DAY - hours * 3600_000).toISOString();

async function seedProfile(): Promise<string> {
  seq += 1;
  const [account] = await t.sql`
    INSERT INTO accounts (email) VALUES (${`weather-${seq}@example.test`}) RETURNING id`;
  const [p] = await t.sql`
    INSERT INTO profiles (account_id, type, name)
    VALUES (${account.id}, 'human', 'Owner') RETURNING id`;
  return p.id as string;
}

async function seedInspiration(profileId: string, at: string): Promise<string> {
  const [row] = await t.sql`
    INSERT INTO inspirations (profile_id, text, created_at)
    VALUES (${profileId}, ${"a kept thing"}, ${at}) RETURNING id`;
  return row.id as string;
}

async function seedSignal(profileId: string, at: string, statement: string): Promise<string> {
  const [row] = await t.sql`
    INSERT INTO signals (profile_id, statement, status, confidence, created_at)
    VALUES (${profileId}, ${statement}, 'emerging', 0, ${at}) RETURNING id`;
  return row.id as string;
}

const sentencesOf = (weather: Awaited<ReturnType<typeof assembleTheWeather>>) =>
  weather.days.flatMap((day) => day.sentences.map((s) => `${day.label}: ${s.text}`));

afterAll(async () => {
  await t?.cleanup();
});

describe("the weather is a view of the record", () => {
  beforeEach(async () => {
    t ??= await createTestDatabase();
    await t.truncateAll();
  });

  it("tells a seeded fortnight as worded days, counting exactly, every sentence backed", async () => {
    const profileId = await seedProfile();

    // Two days ago: two memories kept, a pattern spoken, a root grown.
    const insp = await seedInspiration(profileId, daysAgo(2, 1));
    await seedInspiration(profileId, daysAgo(2, 2));
    const sig = await seedSignal(profileId, daysAgo(2, 1), "You cook to think.");
    await t.sql`
      INSERT INTO signal_evidence (profile_id, owner_profile_id, signal_id, inspiration_id, created_at)
      VALUES (${profileId}, ${profileId}, ${sig}, ${insp}, ${daysAgo(2, 1)})`;

    // Yesterday: a refusal, and the poster read everything again and held.
    const anchor = await seedSignal(profileId, daysAgo(9), "You are a morning person.");
    await t.sql`
      INSERT INTO suppressions
        (profile_id, anchor_signal_id, anchor_statement, candidate_statement, similarity, suppressed_at)
      VALUES (${profileId}, ${anchor}, ${"You are a morning person."},
              ${"Mornings are your best hours."}, ${0.91}, ${daysAgo(1, 3)})`;
    await t.sql`
      INSERT INTO top_of_minds (profile_id, status, reason, created_at)
      VALUES (${profileId}, 'superseded', 'no_change', ${daysAgo(1, 2)})`;

    // Today: a consultation.
    await t.sql`
      INSERT INTO consultations (profile_id, surface, served_at)
      VALUES (${profileId}, 'signals', ${daysAgo(0, 1)})`;

    const weather = await assembleTheWeather(t.db as never, { profileId, now: NOW });
    const lines = sentencesOf(weather);

    expect(lines).toContain("two days ago: you kept 2 memories");
    expect(lines).toContain("two days ago: a new signal was spoken");
    expect(lines).toContain("two days ago: a signal found another memory behind it");
    expect(lines).toContain(
      "yesterday: refused a candidate — too close to what you dismissed",
    );
    expect(lines).toContain("yesterday: everything was read again, and the poster held");
    expect(lines).toContain("today: your memory was consulted");

    /* A COUNT IS COUNTED; A DAY IS SAID. Founder ruling, 2026-08-24: the
       telling used to spell counts out and saturate into "many", which made
       it vaguer than the rows it is a view of. Counts are now exact, and the
       assertion that used to forbid every digit forbids them only where a
       label belongs — the day names, which are WHEN and not how many. */
    const labels = weather.days.map((d) => d.label);
    expect(labels, "the days are said, not numbered").toEqual(
      expect.arrayContaining(["today", "yesterday", "two days ago"]),
    );
    for (const label of labels) {
      expect(/\d/.test(label), `a numeral crept into the day label "${label}"`).toBe(false);
    }
    const md = renderTheWeather(weather);
    expect(md).toContain("- refused a candidate — too close to what you dismissed.");
  });

  it("deletes the sentence with the record — the narration cannot outlive its row", async () => {
    const profileId = await seedProfile();
    const anchor = await seedSignal(profileId, daysAgo(10), "You are a morning person.");
    await t.sql`
      INSERT INTO suppressions
        (profile_id, anchor_signal_id, anchor_statement, candidate_statement, similarity, suppressed_at)
      VALUES (${profileId}, ${anchor}, ${"You are a morning person."},
              ${"Mornings are your best hours."}, ${0.91}, ${daysAgo(1)})`;
    await t.sql`
      INSERT INTO top_of_minds (profile_id, status, reason, created_at)
      VALUES (${profileId}, 'superseded', 'no_change', ${daysAgo(3)})`;

    const before = sentencesOf(await assembleTheWeather(t.db as never, { profileId, now: NOW }));
    expect(before.some((l) => l.includes("refused a candidate"))).toBe(true);
    expect(before.some((l) => l.includes("the poster held"))).toBe(true);

    await t.sql`DELETE FROM suppressions WHERE profile_id = ${profileId}`;
    await t.sql`DELETE FROM top_of_minds WHERE profile_id = ${profileId}`;

    const after = sentencesOf(await assembleTheWeather(t.db as never, { profileId, now: NOW }));
    expect(
      after.some((l) => l.includes("refused a candidate")),
      "the refusal's sentence outlived the refusal's record",
    ).toBe(false);
    expect(
      after.some((l) => l.includes("the poster held")),
      "the held sentence outlived the no-change version",
    ).toBe(false);
  });

  it("tells the away-window in one sentence, and holds its tongue when nothing happened", async () => {
    const profileId = await seedProfile();
    await seedInspiration(profileId, daysAgo(0, 2));
    await seedInspiration(profileId, daysAgo(0, 3));

    const away = await assembleTheWeather(t.db as never, {
      profileId,
      now: NOW,
      since: new Date(daysAgo(5)),
    });
    /* memories were kept and no pattern moved: the sky held rides along */
    /* the spoken line is counts only — "the sky held" stays in the days
       and the markdown, where the record lives */
    expect(away.told).toBe("you kept 2 memories.");

    const quiet = await assembleTheWeather(t.db as never, {
      profileId,
      now: NOW,
      since: new Date(daysAgo(0, 1)),
    });
    expect(quiet.told, "silence is the honest telling of a quiet window").toBeNull();
  });

  it("stands the refused candidates in the antechamber, each anchor reachable — or marked departed", async () => {
    const profileId = await seedProfile();
    const anchor = await seedSignal(profileId, daysAgo(10), "You are a morning person.");
    await t.sql`UPDATE signals SET dismissed_at = ${daysAgo(9)}, status = 'retired'
      WHERE id = ${anchor}`;
    await t.sql`
      INSERT INTO suppressions
        (profile_id, anchor_signal_id, anchor_statement, candidate_statement, similarity, suppressed_at)
      VALUES (${profileId}, ${anchor}, ${"You are a morning person."},
              ${"Mornings are your best hours."}, ${0.91}, ${daysAgo(1)})`;

    const weather = await assembleTheWeather(t.db as never, { profileId, now: NOW });
    expect(weather.antechamber).toHaveLength(1);
    expect(weather.antechamber[0]).toMatchObject({
      candidateStatement: "Mornings are your best hours.",
      anchorSignalId: anchor,
      anchorStatement: "You are a morning person.",
      anchorStillRefusing: true,
    });

    // The anchor is truly deleted: the mark stays, the id departs, and the
    // row honestly stops claiming the ground still refuses.
    await t.sql`DELETE FROM signals WHERE id = ${anchor}`;
    const after = await assembleTheWeather(t.db as never, { profileId, now: NOW });
    expect(after.antechamber[0]).toMatchObject({
      candidateStatement: "Mornings are your best hours.",
      anchorSignalId: null,
      anchorStatement: "You are a morning person.",
      anchorStillRefusing: false,
    });
  });

  it("labels every day in words", () => {
    expect(wordedDaysAgo(0)).toBe("today");
    expect(wordedDaysAgo(1)).toBe("yesterday");
    expect(wordedDaysAgo(2)).toBe("two days ago");
    expect(wordedDaysAgo(13)).toBe("thirteen days ago");
  });

  it("does not call your own reading a consultation — another hand's, it does", async () => {
    /* Founder, 2026-08-25: "are these numbers accurate?" — they were, as a
       record, and wrong as a sentence: the world loads your top of mind and
       your signals on every visit, each serve writing a row, so a day of
       using the product read as a hundred consultations by nobody. "Your
       memory was consulted" means a reader who is not you. A null reader
       stays counted: an erased account's mark is still someone having read. */
    const profileId = await seedProfile();
    const [agentRow] = await t.sql`
      SELECT account_id AS acct FROM profiles WHERE id = ${profileId}`;
    const [agent] = await t.sql`
      INSERT INTO profiles (account_id, type, name)
      VALUES (${agentRow.acct}, 'agent', 'the agent') RETURNING id`;

    /* your own read, this morning */
    await t.sql`
      INSERT INTO consultations (profile_id, reader_profile_id, surface, served_at)
      VALUES (${profileId}, ${profileId}, 'signals', ${daysAgo(0, 3)})`;

    const own = await assembleTheWeather(t.db as never, { profileId, now: NOW });
    expect(
      sentencesOf(own).some((line) => line.includes("consulted")),
      "your own reading is you looking at your own wall, not a consultation",
    ).toBe(false);

    /* the agent's read, an hour later */
    await t.sql`
      INSERT INTO consultations (profile_id, reader_profile_id, surface, served_at)
      VALUES (${profileId}, ${agent.id}, 'signals', ${daysAgo(0, 2)})`;

    const read = await assembleTheWeather(t.db as never, { profileId, now: NOW });
    expect(
      sentencesOf(read),
      "another hand's read is exactly what the sentence means",
    ).toContain("today: your memory was consulted");
  });
});
