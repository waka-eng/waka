/** INTRODUCTIONS (design "Agent introductions", approved 2026-11-27).
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): the route's `authMiddleware` (a fixture
 * session, so agent and key-scoped sessions can be stood up directly), the
 * flag (`available`) and the enqueue (`requestMatch`, recorded rather than
 * written so no worker runs). Consent, matching, answers, the human-only
 * trigger and the cascades all run on real disposable SQL. Nothing here
 * calls a model: the matcher never does. */
import { randomUUID } from "node:crypto";
import { Hono, type MiddlewareHandler } from "hono";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestDatabase, type TestDatabase } from "../../test/helpers/index.js";
import { createIntroductionRoutes } from "../routes/introductions.js";
import { matchIntroductionsForProfile, readIntroductionState } from "./introductions.js";
import { enqueueIntroductionMatch } from "./queue.js";
import type { AuthEnv } from "./middleware.js";

let t: TestDatabase, sequence = 0;
beforeEach(async () => { t ??= await createTestDatabase(); await t.truncateAll(); });
afterAll(async () => { await t?.cleanup(); });

type Person = { accountId: string; profileId: string; name: string };
async function person(name = "Jun Park", type: "human" | "agent" = "human", accountId?: string): Promise<Person> {
  const account = accountId ?? ((await t.sql`INSERT INTO accounts(email) VALUES (${`intro-${++sequence}@example.test`}) RETURNING id`)[0]!.id as string);
  const [profile] = await t.sql`INSERT INTO profiles(account_id,type,name) VALUES (${account},${type},${name}) RETURNING id`;
  return { accountId: account, profileId: profile!.id as string, name };
}
let rank = 0;
async function principle(p: Person, statement: string, state = "held") {
  const [row] = await t.sql`INSERT INTO principles(profile_id,statement,rank,state) VALUES (${p.profileId},${statement},${++rank},${state}::principle_state) RETURNING id`;
  return row!.id as string;
}
async function consent(p: Person, enabled = true) {
  await t.sql`INSERT INTO introduction_consents(profile_id,enabled) VALUES (${p.profileId},${enabled})
    ON CONFLICT (profile_id) DO UPDATE SET enabled = EXCLUDED.enabled`;
}
const match = (p: Person) => matchIntroductionsForProfile(t.db as never, p.profileId, true);

const FINISH = "I would rather finish something small than plan something big.";
const FINISH_TOO = "Finish the small thing instead of planning the big one.";
const UNRELATED = "Tell people the truth early, even when it costs you.";

function routed(p: Person, opts: { available?: boolean; type?: string; keyScoped?: boolean; auth?: MiddlewareHandler<AuthEnv> | null } = {}) {
  const requestMatch = vi.fn(async () => null);
  const routes = new Hono<AuthEnv>();
  const auth: MiddlewareHandler<AuthEnv> = async (c, next) => {
    c.set("session", { sessionId: randomUUID(), account: { id: p.accountId, email: "x@example.test" }, keyScoped: opts.keyScoped ?? false,
      profile: { id: p.profileId, accountId: p.accountId, type: opts.type ?? "human", name: p.name, preferredLocale: "en-US" } } as never);
    await next();
  };
  routes.route("/", createIntroductionRoutes({ getDatabase: () => t.db as never, available: () => opts.available ?? true, requestMatch,
    ...(opts.auth === null ? {} : { authMiddleware: opts.auth ?? auth }) }));
  const post = (path: string, body?: unknown) => routes.request(path, { method: "POST", headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const state = async () => (await (await routes.request("/")).json()) as Record<string, unknown> & { introduction: null | Record<string, string> };
  return { routes, requestMatch, post, state, raw: async () => (await routes.request("/")).text() };
}

describe("consent", () => {
  it("is off until the person says Introduce us, and the ask is offered once, only to someone holding a principle", async () => {
    const p = await person();
    expect(await routed(p).state()).toMatchObject({ available: true, consent: { enabled: false, answered: false }, offerConsent: false });
    await principle(p, FINISH);
    expect(await routed(p).state()).toMatchObject({ offerConsent: true });
    const r = routed(p);
    expect((await r.post("/consent", { enabled: false })).status, "Not now").toBe(200);
    expect(await r.state()).toMatchObject({ consent: { enabled: false, answered: true }, offerConsent: false });
    expect(r.requestMatch).not.toHaveBeenCalled();
    expect((await r.post("/consent", { enabled: true })).status, "Introduce us").toBe(200);
    expect(await r.state()).toMatchObject({ consent: { enabled: true, answered: true } });
    expect(r.requestMatch).toHaveBeenCalledWith(p.profileId);
  });

  it("with the flag off: nothing is offered or enqueued, it cannot be turned on, and it can always be turned off", async () => {
    const p = await person(); await principle(p, FINISH); await consent(p);
    const r = routed(p, { available: false });
    expect(await r.state()).toMatchObject({ available: false, offerConsent: false, introduction: null });
    expect((await r.post("/consent", { enabled: true })).status).toBe(404);
    expect((await r.post("/consent", { enabled: false })).status).toBe(200);
    expect(r.requestMatch).not.toHaveBeenCalled();
    expect(await matchIntroductionsForProfile(t.db as never, p.profileId, false)).toBe("off");
    const before = process.env.WAKA_INTRODUCTIONS;
    delete process.env.WAKA_INTRODUCTIONS;
    try { expect(await enqueueIntroductionMatch(p.profileId, t.db as never), "the queue stays empty without the flag").toBeNull(); }
    finally { if (before !== undefined) process.env.WAKA_INTRODUCTIONS = before; }
    expect(await t.sql`SELECT id FROM background_jobs WHERE type='match_introductions'`).toHaveLength(0);
  });

  it("with the flag on, Introduce us queues one keyed match job", async () => {
    const p = await person();
    const before = process.env.WAKA_INTRODUCTIONS;
    process.env.WAKA_INTRODUCTIONS = "1";
    try {
      await enqueueIntroductionMatch(p.profileId, t.db as never); await enqueueIntroductionMatch(p.profileId, t.db as never);
      expect(await t.sql`SELECT payload FROM background_jobs WHERE type='match_introductions' AND profile_id=${p.profileId}`)
        .toEqual([{ payload: { reason: "consent" } }]);
    } finally { if (before === undefined) delete process.env.WAKA_INTRODUCTIONS; else process.env.WAKA_INTRODUCTIONS = before; }
  });

  it("refuses an agent or a room's mind at the database, whatever writes the row", async () => {
    const human = await person();
    const agent = await person("Helper", "agent", human.accountId);
    await expect(consent(agent)).rejects.toThrow(/human profiles only/);
    const other = await person("Other");
    const a = await principle(agent, FINISH), b = await principle(other, FINISH_TOO);
    const [lo, hi] = agent.profileId < other.profileId ? [[agent, a], [other, b]] as const : [[other, b], [agent, a]] as const;
    await expect(t.sql`INSERT INTO introductions(profile_a_id,profile_b_id,principle_a_id,principle_b_id,principle_a_text,principle_b_text)
      VALUES (${lo[0].profileId},${hi[0].profileId},${lo[1]},${hi[1]},'x','y')`).rejects.toThrow(/human profiles only/);
  });
});

describe("matching", () => {
  it("pairs two consenting people on overlapping principles, once, and never pairs on saves or signals", async () => {
    const a = await person("Yunji Chung"), b = await person("Jun Park");
    await principle(a, FINISH); await principle(b, FINISH_TOO); await principle(b, UNRELATED);
    /* C's saves and signals say A's principle word for word; C's principle does not. */
    const c = await person("Mina Kim");
    await principle(c, "Keep the kitchen warm for whoever comes home late.");
    await t.sql`INSERT INTO inspirations(profile_id,text) VALUES (${c.profileId},${FINISH})`;
    await t.sql`INSERT INTO signals(profile_id,statement,status) VALUES (${c.profileId},${FINISH},'emerging')`;
    await consent(a); await consent(b); await consent(c);
    expect(await match(a)).toBe("matched");
    const rows = await t.sql`SELECT profile_a_id, profile_b_id, principle_a_text, principle_b_text, status FROM introductions`;
    expect(rows).toHaveLength(1);
    expect(new Set([rows[0]!.profile_a_id, rows[0]!.profile_b_id])).toEqual(new Set([a.profileId, b.profileId]));
    expect(new Set([rows[0]!.principle_a_text, rows[0]!.principle_b_text])).toEqual(new Set([FINISH, FINISH_TOO]));
    expect(await match(c), "C shares only saves and signals with A").toBe("none");
    expect(await match(a), "an open ask keeps a person out of new matches").toBe("busy");
  });

  it("reads only consenting humans: a person who has not said yes, or said no, or an aspirational principle, is never compared", async () => {
    const a = await person(), silent = await person(), declined = await person(), hopeful = await person();
    await principle(a, FINISH); await principle(silent, FINISH_TOO); await principle(declined, FINISH_TOO);
    await principle(hopeful, FINISH_TOO, "aspirational");
    await consent(a); await consent(declined, false); await consent(hopeful);
    expect(await match(a)).toBe("none");
    expect(await match(silent), "no consent row").toBe("not_consenting");
    expect(await t.sql`SELECT id FROM introductions`).toHaveLength(0);
  });

  it("forgets an introduction when either principle is reworded or deleted", async () => {
    const a = await person(), b = await person();
    const pa = await principle(a, FINISH);
    await principle(b, FINISH_TOO);
    await consent(a); await consent(b);
    expect(await match(a)).toBe("matched");
    await t.sql`UPDATE principles SET statement='Something else entirely now.' WHERE id=${pa}`;
    expect(await t.sql`SELECT id FROM introductions`, "reworded").toHaveLength(0);
    await t.truncateAll();
    const c = await person(), d = await person();
    await principle(c, FINISH); const pd = await principle(d, FINISH_TOO);
    await consent(c); await consent(d);
    expect(await match(c)).toBe("matched");
    await t.sql`DELETE FROM principles WHERE id=${pd}`;
    expect(await t.sql`SELECT id FROM introductions`, "deleted").toHaveLength(0);
  });
});

describe("answering", () => {
  async function pair() {
    const a = await person("Yunji Chung"), b = await person("Jun Park");
    await principle(a, FINISH); await principle(b, FINISH_TOO);
    await consent(a); await consent(b);
    expect(await match(a)).toBe("matched");
    const [row] = await t.sql`SELECT id FROM introductions`;
    return { a, b, id: row!.id as string };
  }

  it("asks each side anonymously, and introduces them only when both say yes, each in their own words", async () => {
    const { a, b, id } = await pair();
    const ra = routed(a), rb = routed(b);
    expect((await ra.state()).introduction).toEqual({ id, stage: "ask" });
    for (const leak of ["Jun", FINISH_TOO]) expect(await ra.raw(), `the ask carries ${leak}`).not.toContain(leak);
    expect(await (await ra.post(`/${id}/answer`, { answer: "yes" })).json()).toEqual({ stage: "waiting" });
    expect((await ra.state()).introduction, "waiting is invisible").toBeNull();
    expect(await (await rb.post(`/${id}/answer`, { answer: "yes" })).json())
      .toEqual({ id, stage: "introduced", name: "Yunji", principle: FINISH_TOO });
    expect((await ra.state()).introduction).toEqual({ id, stage: "introduced", name: "Jun", principle: FINISH });
    const seen = await ra.raw();
    for (const leak of [FINISH_TOO, "Park", b.profileId]) expect(seen, `A's introduction carries ${leak}`).not.toContain(leak);
    expect((await ra.post(`/${id}/seen`)).status).toBe(200);
    expect((await ra.state()).introduction).toBeNull();
    expect((await rb.state()).introduction, "B's Done is B's own").toMatchObject({ stage: "introduced" });
    expect(ra.requestMatch, "settling asks for the next match").toHaveBeenCalledWith(a.profileId);
  });

  it("never reveals a decline: the other side's ask, and their yes, look exactly as if nobody had answered", async () => {
    const { a, b, id } = await pair();
    const ra = routed(a), rb = routed(b);
    const before = await ra.raw();
    expect(await (await rb.post(`/${id}/answer`, { answer: "no" })).json()).toEqual({ stage: "declined" });
    expect((await rb.state()).introduction).toBeNull();
    expect(await ra.raw(), "A's view after B's no").toBe(before);
    expect(await (await ra.post(`/${id}/answer`, { answer: "yes" })).json()).toEqual({ stage: "waiting" });
    expect((await ra.state()).introduction).toBeNull();
    expect((await ra.post(`/${id}/seen`)).status, "a declined match never becomes an introduction").toBe(404);
  });

  it("turning introductions off withdraws an open match silently, and the other side sees no change", async () => {
    const { a, b, id } = await pair();
    const ra = routed(a), rb = routed(b);
    const before = await rb.raw();
    expect((await ra.post(`/${id}/answer`, { answer: "yes" })).status).toBe(200);
    expect((await ra.post("/consent", { enabled: false })).status).toBe(200);
    expect(await rb.raw()).toBe(before);
    expect(await (await rb.post(`/${id}/answer`, { answer: "yes" })).json(), "A's earlier yes was withdrawn").toEqual({ stage: "waiting" });
    expect(await match(a)).toBe("not_consenting");
  });

  it("refuses anyone who is not a side of it, and answers an outsider exactly as for a missing row", async () => {
    const { id } = await pair();
    const stranger = await person("Stranger"); await consent(stranger);
    const rs = routed(stranger);
    const missing = await rs.post(`/${randomUUID()}/answer`, { answer: "yes" });
    const theirs = await rs.post(`/${id}/answer`, { answer: "yes" });
    expect([theirs.status, await theirs.text()]).toEqual([missing.status, await missing.text()]);
    expect(theirs.status).toBe(404);
    expect((await rs.post(`/${id}/seen`)).status).toBe(404);
    expect((await rs.state()).introduction).toBeNull();
    expect(await t.sql`SELECT answer_a, answer_b FROM introductions`).toEqual([{ answer_a: null, answer_b: null }]);
  });

  it("answers once", async () => {
    const { a, id } = await pair();
    const ra = routed(a);
    expect((await ra.post(`/${id}/answer`, { answer: "no" })).status).toBe(200);
    expect((await ra.post(`/${id}/answer`, { answer: "yes" })).status).toBe(409);
    expect((await ra.post(`/${id}/answer`, { answer: "maybe" })).status).toBe(400);
  });
});

describe("who may ask", () => {
  afterEach(() => vi.restoreAllMocks());

  it("refuses agent sessions and key-scoped (MCP) sessions on every route", async () => {
    const p = await person(); await principle(p, FINISH); await consent(p);
    for (const r of [routed(p, { type: "agent" }), routed(p, { keyScoped: true })]) {
      expect((await r.routes.request("/")).status).toBe(403);
      expect((await r.post("/consent", { enabled: true })).status).toBe(403);
      expect((await r.post(`/${randomUUID()}/answer`, { answer: "yes" })).status).toBe(403);
      expect((await r.post(`/${randomUUID()}/seen`)).status).toBe(403);
    }
    const { keeperKeyMayPass } = await import("./middleware.js");
    expect(keeperKeyMayPass("GET", "/api/introductions")).toBe(false);
    expect(keeperKeyMayPass("POST", "/api/introductions/consent")).toBe(false);
  });

  it("requires a session", async () => {
    const p = await person();
    const r = routed(p, { auth: null });
    expect((await r.routes.request("/")).status).toBe(401);
    expect((await r.post("/consent", { enabled: true })).status).toBe(401);
  });

  it("returns nothing about the other person beyond a first name and the principle", async () => {
    const a = await person("Yunji Chung"), b = await person("Jun Park");
    await principle(a, FINISH); await principle(b, FINISH_TOO);
    await t.sql`INSERT INTO inspirations(profile_id,text) VALUES (${b.profileId},'A private save about my sister')`;
    await consent(a); await consent(b); await match(a);
    const [row] = await t.sql`SELECT id FROM introductions`;
    await t.sql`UPDATE introductions SET answer_a='yes', answer_b='yes', status='accepted' WHERE id=${row!.id}`;
    const state = await readIntroductionState(t.db as never, a.profileId, true);
    expect(Object.keys(state.introduction ?? {}).sort()).toEqual(["id", "name", "principle", "stage"]);
    expect(JSON.stringify(state)).not.toMatch(/sister|Park|@example/);
  });
});
