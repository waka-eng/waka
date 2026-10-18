/**
 * HOW MUCH WAS KEPT ON EACH DAY.
 *
 * The calendar's whole input. Four facts it has to get right:
 *
 *   1. A day's count is the number kept ON that day, grouped by date rather
 *      than returned as a flat list the client counts for itself.
 *   2. Empty days are ABSENT, not zero. The calendar draws its own grid and
 *      knows every date in the month; sending a row per silent day would be
 *      sending the whole history to say nothing happened in it.
 *   3. The window is respected — `days=N` cannot reach further back than N.
 *   4. One person's days are never in another's calendar.
 *   5. A day is the caller's day: grouped in the zone it names as `tz`, and
 *      the window starts at that zone's midnight of its oldest day.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): the auth middleware only, as every route
 * suite here does — the session is the one thing a test cannot produce by
 * asking the database for it. The grouping itself is the real SQL on real
 * Postgres, which is the entire point: `date_trunc` and the window arithmetic
 * are what could be wrong, and a fixture would simply agree with whatever this
 * file claimed they do.
 */
import { Hono } from "hono";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDatabase } from "../../test/helpers/index.js";
import type { AuthEnv } from "../lib/middleware.js";
import type { AuthenticatedSession } from "../lib/session.js";
import { createInspirationDaysRoutes } from "./inspiration-days.js";

let t: TestDatabase;
let seq = 0;

interface Person {
  profileId: string;
  session: AuthenticatedSession;
}

async function seedPerson(name: string): Promise<Person> {
  seq += 1;
  const [account] = await t.sql`
    INSERT INTO accounts (email) VALUES (${`days-${seq}-${name}@example.test`}) RETURNING id`;
  const [profile] = await t.sql`
    INSERT INTO profiles (account_id, type, name)
    VALUES (${account.id}, 'human', ${name}) RETURNING id`;
  const [sessionRow] = await t.sql`
    INSERT INTO sessions (profile_id, token_hash, expires_at)
    VALUES (${profile.id}, ${`days-hash-${seq}`}, now() + interval '1 hour') RETURNING id`;
  return {
    profileId: profile.id as string,
    session: {
      sessionId: sessionRow.id as string,
      account: { id: account.id as string, email: `days-${seq}@example.test` },
      profile: {
        id: profile.id as string,
        accountId: account.id as string,
        type: "human",
        name,
        preferredLocale: "en-US",
      },
    },
  };
}

function appFor(person: Person): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>();
  const authMiddleware = async (
    c: { set: (k: "session", v: AuthenticatedSession) => void },
    next: () => Promise<void>,
  ) => {
    c.set("session", person.session);
    await next();
  };
  app.route(
    "/api/inspiration-days",
    createInspirationDaysRoutes({
      getDatabase: () => t.db as never,
      authMiddleware: authMiddleware as never,
    }),
  );
  return app;
}

/** Keep `count` things `agoDays` ago. */
async function keptDaysAgo(person: Person, agoDays: number, count: number): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await t.sql`
      INSERT INTO inspirations (profile_id, text, created_at)
      VALUES (
        ${person.profileId},
        ${`kept ${agoDays} days ago, number ${i}`},
        now() - (${agoDays}::int * interval '1 day')
      )`;
  }
}

async function daysFor(person: Person, query = ""): Promise<Array<{ day: string; kept: number }>> {
  const response = await appFor(person).request(`/api/inspiration-days${query}`);
  expect(response.status).toBe(200);
  const body = (await response.json()) as { days: Array<{ day: string; kept: number }> };
  return body.days;
}

beforeEach(async () => {
  t = await createTestDatabase();
});

afterAll(async () => {
  await t?.cleanup();
});

describe("how much was kept on each day", () => {
  it("counts a day, rather than listing what was kept on it", async () => {
    const person = await seedPerson("counts");
    await keptDaysAgo(person, 2, 3);

    const days = await daysFor(person);

    expect(days).toHaveLength(1);
    expect(days[0]!.kept).toBe(3);
  });

  it("leaves a silent day out rather than sending a zero", async () => {
    /* The calendar draws its own grid, so an absent day is already drawable.
       A row per quiet day would be the whole history, spent saying nothing. */
    const person = await seedPerson("silent");
    await keptDaysAgo(person, 1, 1);
    await keptDaysAgo(person, 4, 1);

    const days = await daysFor(person);

    expect(days).toHaveLength(2);
    expect(days.every((row) => row.kept > 0)).toBe(true);
  });

  it("gives each day its own row, oldest first", async () => {
    const person = await seedPerson("ordered");
    await keptDaysAgo(person, 1, 1);
    await keptDaysAgo(person, 5, 2);

    const days = await daysFor(person);

    expect(days).toHaveLength(2);
    expect([...days].sort((a, b) => a.day.localeCompare(b.day))).toEqual(days);
    expect(days[0]!.kept).toBe(2); /* the older day, which had two */
  });

  it("cannot reach further back than the window asked for", async () => {
    const person = await seedPerson("window");
    await keptDaysAgo(person, 2, 1);
    await keptDaysAgo(person, 90, 1);

    expect(await daysFor(person, "?days=7")).toHaveLength(1);
    expect(await daysFor(person, "?days=365")).toHaveLength(2);
  });

  it("keeps one person's days out of another's calendar", async () => {
    const mine = await seedPerson("mine");
    const theirs = await seedPerson("theirs");
    await keptDaysAgo(mine, 1, 2);

    expect(await daysFor(mine)).toHaveLength(1);
    expect(await daysFor(theirs)).toHaveLength(0);
  });

  it("groups by the caller's own day, not Greenwich's", async () => {
    /* 20:00 UTC yesterday is 05:00 today in Seoul. Grouped by UTC this save
       sat on the date before the one a Korean reader made it on. */
    const person = await seedPerson("zone");
    await t.sql`
      INSERT INTO inspirations (profile_id, text, created_at)
      VALUES (
        ${person.profileId},
        'kept at dawn in Seoul',
        (date_trunc('day', now() AT TIME ZONE 'UTC') - interval '4 hours') AT TIME ZONE 'UTC'
      )`;

    const [utc] = await daysFor(person, "?tz=UTC");
    const [seoul] = await daysFor(person, "?tz=Asia%2FSeoul");
    const nextDay = new Date(Date.parse(`${utc!.day}T00:00:00Z`) + 86_400_000)
      .toISOString()
      .slice(0, 10);

    expect(seoul!.day).toBe(nextDay);
    expect(await daysFor(person)).toEqual([utc]); /* no zone named is UTC */
  });

  it("falls back to UTC for a zone it does not know, and refuses one that is not a zone", async () => {
    const person = await seedPerson("unknown-zone");
    await keptDaysAgo(person, 1, 1);

    expect(await daysFor(person, "?tz=Mars%2FOlympus_Mons")).toEqual(await daysFor(person));
    /* and it SAYS it fell back, so the calendar can draw UTC dates to match */
    const fellBack = await appFor(person).request("/api/inspiration-days?tz=Mars%2FOlympus_Mons");
    expect(((await fellBack.json()) as { zone: string }).zone).toBe("UTC");
    const kept = await appFor(person).request("/api/inspiration-days?tz=Asia%2FSeoul");
    expect(((await kept.json()) as { zone: string }).zone).toBe("Asia/Seoul");
    const response = await appFor(person).request("/api/inspiration-days?tz=UTC'%3B--");
    expect(response.status).toBe(400);
  });

  it("starts the window at local midnight of its oldest day", async () => {
    /* `days=2` is today and yesterday, whole. Measured as 48 hours back from
       this instant it cut yesterday short at the front and reached into the
       day before at the back — whichever the clock happened to say. */
    const person = await seedPerson("midnight");
    const at = async (offset: string, text: string) => t.sql`
      INSERT INTO inspirations (profile_id, text, created_at)
      VALUES (
        ${person.profileId}, ${text},
        (date_trunc('day', now() AT TIME ZONE 'Asia/Seoul') - interval '1 day' + ${offset}::interval)
          AT TIME ZONE 'Asia/Seoul'
      )`;
    await at("1 minute", "first minute of yesterday");
    await at("-1 minute", "last minute of the day before");

    const days = await daysFor(person, "?days=2&tz=Asia%2FSeoul");

    expect(days).toHaveLength(1);
    expect(days[0]!.kept).toBe(1);
  });

  it("refuses a window it cannot serve", async () => {
    const person = await seedPerson("bounds");
    const response = await appFor(person).request("/api/inspiration-days?days=9000");
    expect(response.status).toBe(400);
  });
});
