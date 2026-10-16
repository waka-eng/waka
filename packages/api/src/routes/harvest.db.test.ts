/**
 * THE BASKET: proposed by the person's own sessions, decided only at a
 * browser, and holding the words only while nobody has decided.
 *
 * Founder, 2026-10-15: "if I use the WAKA MCP, then the agent would derive
 * 'oh, this looks like inspiration' ... we need more than a yes and a no.
 * When the user says no, select why not."
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): `requireAuth` only, by injecting the
 * session — a person at a browser, the same person's keeper key, or an agent
 * — so each can be asked for each act. `humanSessionsOnly` is the real one:
 * it is half the subject. The database is a real isolated schema with every
 * migration applied, so the CHECK that ties words to "pending" is the real
 * constraint, not a description of it.
 */
import { Hono } from "hono";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDatabase } from "../../test/helpers/index.js";
import type { AuthEnv } from "../lib/middleware.js";
import type { AuthenticatedSession } from "../lib/session.js";
import { assembleProfileExport } from "../lib/profile-export.js";
import { createHarvestRoutes, harvestHash, HARVEST_LAPSE_DAYS, HARVEST_MAX_WAITING } from "./harvest.js";

let t: TestDatabase;
let seq = 0;
let clock = new Date("2026-10-15T09:00:00Z");

interface Person {
  profileId: string;
  session: AuthenticatedSession;
}

async function seedPerson(name: string, type: "human" | "agent" = "human"): Promise<Person> {
  seq += 1;
  const [account] = await t.sql`
    INSERT INTO accounts (email) VALUES (${`harvest-${seq}-${name}@example.test`}) RETURNING id`;
  const [profile] = await t.sql`
    INSERT INTO profiles (account_id, type, name) VALUES (${account.id}, ${type}, ${name}) RETURNING id`;
  const [sessionRow] = await t.sql`
    INSERT INTO sessions (profile_id, token_hash, expires_at)
    VALUES (${profile.id}, ${`harvest-hash-${seq}`}, now() + interval '1 hour') RETURNING id`;
  return {
    profileId: profile.id as string,
    session: {
      sessionId: sessionRow.id as string,
      account: { id: account.id as string, email: `harvest-${seq}@example.test` },
      profile: { id: profile.id as string, accountId: account.id as string, type, name, preferredLocale: "en-US" },
    },
  };
}

/** The same person, arriving by their keeper key instead of a browser. */
const byKey = (person: Person): Person => ({ ...person, session: { ...person.session, keyScoped: true } });

function appFor(person: Person): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>();
  app.route("/api/harvest", createHarvestRoutes({
    getDatabase: () => t.db as never,
    now: () => clock,
    authMiddleware: (async (c: { set: (k: "session", v: AuthenticatedSession) => void }, next: () => Promise<void>) => {
      c.set("session", person.session);
      await next();
    }) as never,
  }));
  return app;
}

async function call(person: Person, method: string, path: string, body?: unknown) {
  const response = await appFor(person).request(`/api/harvest${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

const propose = (person: Person, ...texts: string[]) =>
  call(person, "POST", "", { candidates: texts.map((text) => ({ text, context: { tool: "claude-code", hour: 22 } })) });
const waiting = async (person: Person) =>
  ((await call(person, "GET", "")).body.candidates as Array<{ id: string; text: string; lapsesAt: string }>);
/** A save made now on the test clock — after anything proposed so far. */
async function saved(person: Person, text: string, at = new Date(clock.getTime() + 1000)): Promise<string> {
  const [row] = await t.sql`INSERT INTO inspirations (profile_id, text, created_at) VALUES (${person.profileId}, ${text}, ${at.toISOString()}) RETURNING id`;
  return row.id as string;
}
const row = async (id: string) =>
  (await t.sql`SELECT status, text, title, reason, source_hash, inspiration_id FROM harvest_candidates WHERE id = ${id}`)[0]!;

beforeAll(async () => {
  t = await createTestDatabase();
});
beforeEach(async () => {
  await t.truncateAll();
  clock = new Date("2026-10-15T09:00:00Z");
});
afterAll(async () => {
  await t?.cleanup();
});

describe("the rules, without a database", () => {
  it("treats the same sentence, however spaced or cased, as the same candidate, for one person only", () => {
    const a = "00000000-0000-4000-8000-000000000001";
    const b = "00000000-0000-4000-8000-000000000002";
    expect(harvestHash(a, "  The first move   small. ")).toBe(harvestHash(a, "the FIRST move small."));
    expect(harvestHash(a, "one sentence")).not.toBe(harvestHash(a, "another sentence"));
    expect(harvestHash(a, "one sentence"), "the hash is keyed per person").not.toBe(harvestHash(b, "one sentence"));
  });
});

describe("proposing", () => {
  it("takes the person's own sentences and does not ask about the same one twice", async () => {
    const me = await seedPerson("me");
    expect((await propose(me, "Ship the ugly version first.", "Small doors, often.")).body).toEqual({ proposed: 2, skipped: 0 });
    expect((await propose(me, "  ship the UGLY version first. ")).body).toEqual({ proposed: 0, skipped: 1 });
    expect((await waiting(me)).map((c) => c.text)).toEqual(["Ship the ugly version first.", "Small doors, often."]);
  });

  it("lets the person's keeper key propose, and nothing else", async () => {
    const me = await seedPerson("keyholder");
    const key = byKey(me);
    expect((await propose(key, "From the collector.")).status).toBe(201);
    expect((await call(key, "GET", "")).status, "reading the basket is a browser act").toBe(403);
    const [id] = (await waiting(me)).map((c) => c.id);
    expect((await call(key, "POST", `/${id}/decline`, {})).status).toBe(403);
    expect((await call(key, "POST", `/${id}/keep`, { inspirationId: await saved(me, "x") })).status).toBe(403);
    expect((await row(id!)).status, "the key decided nothing").toBe("pending");
  });

  it("refuses an agent profile, since agents do not write into the person's material", async () => {
    const agent = await seedPerson("agent", "agent");
    expect((await propose(agent, "An agent's idea.")).status).toBe(403);
  });

  it("refuses an empty sentence, an essay, and unknown fields", async () => {
    const me = await seedPerson("strict");
    expect((await propose(me, "   ")).status).toBe(400);
    expect((await propose(me, "x".repeat(2001))).status).toBe(400);
    expect((await call(me, "POST", "", { candidates: [{ text: "ok", rewritten: "no" }] })).status).toBe(400);
  });

  it("stops filling the basket at its limit", async () => {
    const me = await seedPerson("flood");
    for (let i = 0; i < HARVEST_MAX_WAITING; i += 10) {
      await propose(me, ...Array.from({ length: 10 }, (_, j) => `sentence ${i + j}`));
    }
    expect((await propose(me, "one too many")).body).toEqual({ proposed: 0, skipped: 1 });
  });

  it("never lets one person see another's basket", async () => {
    const me = await seedPerson("mine");
    const them = await seedPerson("theirs");
    await propose(them, "Their private line.");
    expect(await waiting(me)).toEqual([]);
  });
});

describe("keeping", () => {
  it("links the save the person made and lets the basket's copy of the words go", async () => {
    const me = await seedPerson("keeper");
    await propose(me, "Keep the reversible door open.");
    const [candidate] = await waiting(me);
    const inspirationId = await saved(me, "Keep the reversible door open.");
    expect((await call(me, "POST", `/${candidate!.id}/keep`, { inspirationId })).status).toBe(200);
    expect(await row(candidate!.id)).toMatchObject({ status: "kept", text: null, title: null, inspiration_id: inspirationId });
    expect(await waiting(me)).toEqual([]);
    /* Twice with the same save is the same keep. */
    expect((await call(me, "POST", `/${candidate!.id}/keep`, { inspirationId })).status).toBe(200);
    /* And a kept sentence is not proposed again. */
    expect((await propose(me, "Keep the reversible door open.")).body).toEqual({ proposed: 0, skipped: 1 });
  });

  it("refuses an old save, or one another candidate already became", async () => {
    const me = await seedPerson("old-save");
    const before = await saved(me, "Written last month.", new Date(clock.getTime() - 86_400_000));
    await propose(me, "One.", "Two.");
    const [one, two] = await waiting(me);
    expect((await call(me, "POST", `/${one!.id}/keep`, { inspirationId: before })).body).toMatchObject({ code: "harvest_save_older" });
    expect((await row(one!.id)).status, "nothing was decided by the refusal").toBe("pending");
    const fresh = await saved(me, "One.");
    expect((await call(me, "POST", `/${one!.id}/keep`, { inspirationId: fresh })).status).toBe(200);
    expect((await call(me, "POST", `/${two!.id}/keep`, { inspirationId: fresh })).body).toMatchObject({ code: "harvest_save_taken" });
    expect((await row(two!.id)).status).toBe("pending");
  });

  it("lets a kept sentence come back once its save is deleted", async () => {
    const me = await seedPerson("unkept");
    await propose(me, "Kept, then deleted.");
    const [candidate] = await waiting(me);
    const inspirationId = await saved(me, "Kept, then deleted.");
    await call(me, "POST", `/${candidate!.id}/keep`, { inspirationId });
    await t.sql`DELETE FROM inspirations WHERE id = ${inspirationId}`;
    expect((await propose(me, "Kept, then deleted.")).body).toEqual({ proposed: 1, skipped: 0 });
  });

  it("refuses to link someone else's save", async () => {
    const me = await seedPerson("linker");
    const them = await seedPerson("other");
    await propose(me, "Mine.");
    const [candidate] = await waiting(me);
    expect((await call(me, "POST", `/${candidate!.id}/keep`, { inspirationId: await saved(them, "Theirs.") })).status).toBe(404);
    expect((await row(candidate!.id)).status).toBe("pending");
  });
});

describe("letting go", () => {
  it("deletes the words at once and keeps the reason", async () => {
    const me = await seedPerson("decliner");
    await propose(me, "Lunch, maybe noodles.");
    const [candidate] = await waiting(me);
    expect((await call(me, "POST", `/${candidate!.id}/decline`, { reason: "trivial" })).body).toMatchObject({ status: "declined", reason: "trivial" });
    expect(await row(candidate!.id)).toMatchObject({ status: "declined", text: null, title: null, reason: "trivial" });
    expect((await row(candidate!.id)).source_hash, "the hash stays so it is not proposed again").toBe(harvestHash(me.profileId, "Lunch, maybe noodles."));
    expect((await propose(me, "Lunch, maybe noodles.")).body).toEqual({ proposed: 0, skipped: 1 });
  });

  it("takes a reason a moment after the decline, once, and never decides twice", async () => {
    const me = await seedPerson("later");
    await propose(me, "A private thing.");
    const [candidate] = await waiting(me);
    await call(me, "POST", `/${candidate!.id}/decline`, {});
    expect((await row(candidate!.id)).reason).toBeNull();
    expect((await call(me, "POST", `/${candidate!.id}/decline`, { reason: "private" })).body).toMatchObject({ reason: "private" });
    expect((await call(me, "POST", `/${candidate!.id}/decline`, { reason: "trivial" })).body, "the first reason stands").toMatchObject({ reason: "private" });
    const inspirationId = await saved(me, "x");
    expect((await call(me, "POST", `/${candidate!.id}/keep`, { inspirationId })).status).toBe(409);
  });

  it("refuses a reason that is not one of the five", async () => {
    const me = await seedPerson("unknown-reason");
    await propose(me, "Something.");
    const [candidate] = await waiting(me);
    expect((await call(me, "POST", `/${candidate!.id}/decline`, { reason: "boring" })).status).toBe(400);
  });
});

describe("lapsing", () => {
  it("lets a week-old candidate's words go when somebody next looks, and lets the sentence come back", async () => {
    const me = await seedPerson("away");
    await propose(me, "A thought from last week.");
    const [candidate] = await waiting(me);
    clock = new Date(clock.getTime() + HARVEST_LAPSE_DAYS * 86_400_000 + 1000);
    expect(await waiting(me)).toEqual([]);
    expect(await row(candidate!.id)).toMatchObject({ status: "lapsed", text: null, title: null, source_hash: null });
    expect((await propose(me, "A thought from last week.")).body, "unchosen is not refused").toEqual({ proposed: 1, skipped: 0 });
  });

  it("lapses at exactly a week, not a millisecond before", async () => {
    const me = await seedPerson("edge");
    await propose(me, "On the edge.");
    const start = clock;
    clock = new Date(start.getTime() + HARVEST_LAPSE_DAYS * 86_400_000 - 1);
    expect(await waiting(me)).toHaveLength(1);
    clock = new Date(start.getTime() + HARVEST_LAPSE_DAYS * 86_400_000);
    expect(await waiting(me)).toEqual([]);
  });

  it("lapses an unopened basket when it is filled, so week-old rows never block new ones", async () => {
    const me = await seedPerson("unopened");
    for (let i = 0; i < HARVEST_MAX_WAITING; i += 10) {
      await propose(me, ...Array.from({ length: 10 }, (_, j) => `old ${i + j}`));
    }
    clock = new Date(clock.getTime() + HARVEST_LAPSE_DAYS * 86_400_000);
    expect((await propose(me, "new after a week away", "old 0")).body, "the full basket lapsed first, and an unchosen line may return").toEqual({ proposed: 2, skipped: 0 });
    const [{ n }] = await t.sql`SELECT count(*)::int AS n FROM harvest_candidates WHERE profile_id = ${me.profileId} AND text IS NOT NULL`;
    expect(n).toBe(2);
  });
});

describe("the constraint under all of it", () => {
  it("cannot hold words for a decided candidate, or a pending one without words", async () => {
    const me = await seedPerson("constraint");
    await expect(t.sql`INSERT INTO harvest_candidates (profile_id, text, status) VALUES (${me.profileId}, 'words', 'declined')`).rejects.toThrow();
    await expect(t.sql`INSERT INTO harvest_candidates (profile_id, text, status) VALUES (${me.profileId}, NULL, 'pending')`).rejects.toThrow();
  });

  it("is in the export, without the words of a candidate past its week", async () => {
    const me = await seedPerson("exported");
    clock = new Date(Date.now() - HARVEST_LAPSE_DAYS * 86_400_000 - 60_000);
    await propose(me, "Stale and unopened.");
    clock = new Date();
    await propose(me, "Still waiting.");
    const exported = await assembleProfileExport(t.db as never, me.profileId);
    expect(exported.harvestCandidates.map((c) => [c.status, c.text])).toEqual([["lapsed", null], ["pending", "Still waiting."]]);
  });

  it("goes with the person when they erase their account", async () => {
    const me = await seedPerson("erased");
    await propose(me, "Gone with me.");
    await t.sql`DELETE FROM profiles WHERE id = ${me.profileId}`;
    expect(await t.sql`SELECT 1 FROM harvest_candidates WHERE profile_id = ${me.profileId}`).toHaveLength(0);
  });
});

describe("why not, in your own words (2026-10-15)", () => {
  it("keeps the person's own reason after the words go, and names the app that proposed it", async () => {
    const person = await seedPerson("Own");
    await propose(person, "A sentence that is not quite right.");
    const [candidate] = await waiting(person);
    expect((candidate as unknown as { tool: string }).tool).toBe("claude-code");
    expect((await call(person, "POST", `/${candidate!.id}/decline`, { reason: "other" })).status, "other needs words").toBe(400);
    expect((await call(person, "POST", `/${candidate!.id}/decline`, { reason: "private", note: "hm" })).status, "words only with other").toBe(400);
    expect((await call(person, "POST", `/${candidate!.id}/decline`, { reason: "other", note: "  Said it in a meeting, not mine.  " })).status).toBe(200);
    const [stored] = await t.sql`SELECT status, text, reason, reason_note FROM harvest_candidates WHERE id = ${candidate!.id}`;
    expect(stored).toMatchObject({ status: "declined", text: null, reason: "other", reason_note: "Said it in a meeting, not mine." });
  });
});

describe("the basket under pressure (review, 2026-10-15)", () => {
  it("holds its limit when proposals arrive in parallel, and strips control characters from an app name", async () => {
    const person = await seedPerson("Busy");
    const batch = (n: number) => call(person, "POST", "", { candidates: Array.from({ length: 10 }, (_, i) => ({ text: `Sentence ${n}-${i}`, context: { tool: "claude-code" } })) });
    await Promise.all([0, 1, 2, 3, 4].map(batch));
    const [{ n }] = await t.sql`SELECT count(*)::int AS n FROM harvest_candidates WHERE status='pending'`;
    expect(n).toBe(30);
    const odd = await seedPerson("Odd");
    expect((await call(odd, "POST", "", { candidates: [{ text: "Hi", context: { tool: "claude\u202Ecode (beta)" } }] })).status).toBe(201);
    const [stored] = await t.sql`SELECT context->>'tool' AS tool FROM harvest_candidates WHERE profile_id = ${odd.profileId}`;
    expect(stored!.tool).toBe("claudecode beta");
  });
});

describe("a swipe that lets go at once (review, 2026-10-15)", () => {
  it("can still keep corrected words after a bare or cut-wrong decline, and not after a real no", async () => {
    const person = await seedPerson("Swiper");
    await propose(person, "First, cut in the wrong place", "Second, private");
    const [first, second] = await waiting(person);
    expect((await call(person, "POST", `/${first!.id}/decline`, {})).status).toBe(200);
    const fixed = await saved(person, "First, cut right");
    expect((await call(person, "POST", `/${first!.id}/keep`, { inspirationId: fixed })).status).toBe(200);
    expect((await row(first!.id)).status).toBe("kept");
    expect((await call(person, "POST", `/${second!.id}/decline`, { reason: "private" })).status).toBe(200);
    const other = await saved(person, "Second anyway");
    expect((await call(person, "POST", `/${second!.id}/keep`, { inspirationId: other })).status).toBe(409);
  });
});
