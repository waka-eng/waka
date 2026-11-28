/** INTRODUCTIONS (design "Agent introductions", approved 2026-11-27).
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): the route's `authMiddleware` (a fixture
 * session, so agent and key-scoped sessions can be stood up directly), the
 * flag (`available`) and the enqueue (`requestMatch`, recorded rather than
 * written so no worker runs). Consent, matching, answers, lapses, the
 * human-only trigger and principle withdrawal all run on real disposable
 * SQL. Time is moved by rewriting a row's own timestamps. Nothing here calls
 * a model: the matcher never does. */
import { randomUUID } from "node:crypto";
import { Hono, type MiddlewareHandler } from "hono";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestDatabase, type TestDatabase } from "../../test/helpers/index.js";
import { createIntroductionRoutes } from "../routes/introductions.js";
import { INTRODUCTION_WINDOW_DAYS, matchIntroductionsForProfile, readIntroductionState, setIntroductionConsent, type FollowUp } from "./introductions.js";
import { drainIntroductionFollowUps, enqueueIntroductionMatch } from "./queue.js";
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
const match = (p: Person, onMatched?: (followUps: FollowUp[]) => void) =>
  matchIntroductionsForProfile(t.db as never, p.profileId, { available: true, ...(onMatched ? { onMatched: async (_tx, f) => onMatched(f) } : {}) });
const past = `${INTRODUCTION_WINDOW_DAYS + 1} days`;

const FINISH = "I would rather finish something small than plan something big.";
const FINISH_TOO = "Finish the small thing instead of planning the big one.";
const FINISH_THREE = "Finish small things; plans for big things can wait.";
const UNRELATED = "Tell people the truth early, even when it costs you.";

function routed(p: Person, opts: { available?: boolean; type?: string; keyScoped?: boolean; auth?: MiddlewareHandler<AuthEnv> | null } = {}) {
  const requestMatch = vi.fn(async (_f: FollowUp) => null);
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

async function pair(names = ["Yunji Chung", "Jun Park"]) {
  const a = await person(names[0]), b = await person(names[1]);
  await principle(a, FINISH); await principle(b, FINISH_TOO);
  await consent(a); await consent(b);
  expect(await match(a)).toBe("matched");
  const [row] = await t.sql`SELECT id FROM introductions WHERE (profile_a_id=${a.profileId} OR profile_b_id=${a.profileId})`;
  return { a, b, id: row!.id as string };
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
    expect(r.requestMatch).toHaveBeenCalledWith({ profileId: p.profileId, key: "now" });
  });

  it("with the flag off: nothing is offered or enqueued, it cannot be turned on, and it can always be turned off", async () => {
    const p = await person(); await principle(p, FINISH); await consent(p);
    const r = routed(p, { available: false });
    expect(await r.state()).toMatchObject({ available: false, offerConsent: false, introduction: null });
    expect((await r.post("/consent", { enabled: true })).status).toBe(404);
    expect((await r.post("/consent", { enabled: false })).status).toBe(200);
    expect(r.requestMatch).not.toHaveBeenCalled();
    expect(await matchIntroductionsForProfile(t.db as never, p.profileId, { available: false })).toBe("off");
    const before = process.env.WAKA_INTRODUCTIONS;
    delete process.env.WAKA_INTRODUCTIONS;
    try { expect(await enqueueIntroductionMatch(p.profileId, t.db as never), "the queue stays empty without the flag").toBeNull(); }
    finally { if (before !== undefined) process.env.WAKA_INTRODUCTIONS = before; }
    expect(await t.sql`SELECT id FROM background_jobs WHERE type='match_introductions'`).toHaveLength(0);
  });

  it("with the flag on, queues keyed passes, a lapse pass at its own time and never absorbed by an immediate one", async () => {
    const p = await person();
    const before = process.env.WAKA_INTRODUCTIONS;
    process.env.WAKA_INTRODUCTIONS = "1";
    try {
      await enqueueIntroductionMatch(p.profileId, t.db as never); await enqueueIntroductionMatch(p.profileId, t.db as never);
      const later = new Date(Date.now() + 14 * 86_400_000);
      await enqueueIntroductionMatch({ profileId: p.profileId, key: "waited:x", runAfter: later }, t.db as never);
      const rows = await t.sql`SELECT idempotency_key, run_after FROM background_jobs WHERE type='match_introductions' AND profile_id=${p.profileId} ORDER BY run_after`;
      expect(rows.map((row) => row.idempotency_key)).toEqual([`match_introductions:${p.profileId}:now`, `match_introductions:${p.profileId}:waited:x`]);
      expect(Math.abs(new Date(rows[1]!.run_after as string).getTime() - later.getTime())).toBeLessThan(1000);
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
    const followUps: FollowUp[] = [];
    expect(await match(a, (f) => followUps.push(...f))).toBe("matched");
    const rows = await t.sql`SELECT profile_a_id, profile_b_id, principle_a_text, principle_b_text, created_at FROM introductions`;
    expect(rows).toHaveLength(1);
    expect(new Set([rows[0]!.profile_a_id, rows[0]!.profile_b_id])).toEqual(new Set([a.profileId, b.profileId]));
    expect(new Set([rows[0]!.principle_a_text, rows[0]!.principle_b_text])).toEqual(new Set([FINISH, FINISH_TOO]));
    /* Each side gets a pass when the unanswered ask lapses. */
    expect(followUps.map((f) => f.profileId).sort()).toEqual([a.profileId, b.profileId].sort());
    const lapse = new Date(rows[0]!.created_at as string).getTime() + INTRODUCTION_WINDOW_DAYS * 86_400_000;
    for (const f of followUps) expect(f.runAfter!.getTime() - lapse).toBeGreaterThan(0);
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

  it("never pairs a principle with its negation", async () => {
    const a = await person(), b = await person();
    await principle(a, "Plan the big launch carefully before you build."); await principle(b, "Don't plan the big launch carefully before you build.");
    await consent(a); await consent(b);
    expect(await match(a)).toBe("none");
  });

  it("reads the most recently active consents first", async () => {
    const a = await person();
    await principle(a, FINISH); await consent(a);
    const idle = await person(), fresh = await person();
    await principle(idle, FINISH_TOO); await principle(fresh, FINISH_THREE);
    await consent(idle); await consent(fresh);
    await t.sql`UPDATE introduction_consents SET updated_at = now() - interval '300 days' WHERE profile_id = ${idle.profileId}`;
    /* Both match A well; with room for one candidate, the bound keeps the
       recently active one, not the oldest consent. */
    expect(await matchIntroductionsForProfile(t.db as never, a.profileId, { available: true, candidateLimit: 1 })).toBe("matched");
    const [row] = await t.sql`SELECT profile_a_id, profile_b_id FROM introductions`;
    expect([row!.profile_a_id, row!.profile_b_id]).toContain(fresh.profileId);
  });

  it("a withdrawal is silent: the other side's view is byte-identical to the withdrawer saying nothing, until the ordinary lapse", async () => {
    const observe = async (how: string | null) => {
      await t.truncateAll();
      const { a, b, id } = await pair();
      const rb = routed(b);
      const before = await rb.raw();
      if (how) await t.sql.unsafe(how.replace("$A", a.profileId));
      const view = await rb.raw();
      const answered = await (await rb.post(`/${id}/answer`, { answer: "yes" })).json();
      const after = await rb.raw();
      const [row] = await t.sql`SELECT * FROM introductions WHERE id=${id}`;
      const aSide = row!.profile_a_id === a.profileId ? "a" : "b";
      return { a, b, id, same: view === before, answered, after, row, aSide, busy: await match(b) };
    };
    const silent = await observe(null);
    for (const how of [
      "UPDATE principles SET statement = 'Something else entirely now.' WHERE profile_id = '$A'",
      "DELETE FROM principles WHERE profile_id = '$A'",
      "UPDATE principles SET state = 'contested' WHERE profile_id = '$A'",
      "UPDATE principles SET unsupported_at = now() WHERE profile_id = '$A'",
    ]) {
      const withdrew = await observe(how);
      expect(withdrew.same, how).toBe(true);
      expect(withdrew.answered, how).toEqual(silent.answered);
      expect(withdrew.after, how).toEqual(silent.after);
      expect(withdrew.busy, `${how}: the other side was freed early`).toBe("busy");
      expect(withdrew.row!.closed_at, how).toBeNull();
      expect([withdrew.row![`principle_${withdrew.aSide}_text`], withdrew.row![`principle_${withdrew.aSide}_id`]], `${how}: withdrawn words kept`).toEqual([null, null]);
      expect(withdrew.row![`withdrawn_${withdrew.aSide}_at`], how).not.toBeNull();
      /* The withdrawer is free now, and marked to be looked at again. */
      expect((await routed(withdrew.a).state()).introduction, how).toBeNull();
      expect((await t.sql`SELECT profile_id FROM introduction_followups`).map((r) => r.profile_id), how).toEqual([withdrew.a.profileId]);
      expect(await t.sql`SELECT id FROM background_jobs WHERE type='match_introductions'`, `${how}: the trigger enqueued`).toHaveLength(0);
    }
  });

  it("a withdrawn side can never complete the introduction, and the pair is never offered again", async () => {
    const { a, b, id } = await pair();
    await routed(a).post(`/${id}/answer`, { answer: "yes" });
    await t.sql`UPDATE principles SET statement = 'Something else entirely now.' WHERE profile_id = ${a.profileId}`;
    expect(await (await routed(b).post(`/${id}/answer`, { answer: "yes" })).json()).toEqual({ stage: "waiting" });
    await principle(a, FINISH);
    await t.sql`UPDATE introductions SET created_at = created_at - ${past}::interval WHERE id=${id}`;
    expect(await match(a), "the pair is never offered again").toBe("none");
  });

  it("marks a consenting person whose principle becomes held, and the drain turns marks into ordinary jobs", async () => {
    const p = await person(), off = await person();
    await consent(p); await consent(off, false);
    const pid = await principle(p, FINISH, "aspirational");
    await principle(off, FINISH);
    expect(await t.sql`SELECT profile_id FROM introduction_followups`).toHaveLength(0);
    await t.sql`UPDATE principles SET state = 'held' WHERE id = ${pid}`;
    expect((await t.sql`SELECT profile_id FROM introduction_followups`).map((r) => r.profile_id)).toEqual([p.profileId]);
    const before = process.env.WAKA_INTRODUCTIONS;
    process.env.WAKA_INTRODUCTIONS = "1";
    try {
      expect(await drainIntroductionFollowUps(t.db as never)).toBe(1);
      expect(await drainIntroductionFollowUps(t.db as never)).toBe(0);
    } finally { if (before === undefined) delete process.env.WAKA_INTRODUCTIONS; else process.env.WAKA_INTRODUCTIONS = before; }
    expect(await t.sql`SELECT idempotency_key FROM background_jobs WHERE type='match_introductions'`)
      .toEqual([{ idempotency_key: `match_introductions:${p.profileId}:followup` }]);
    expect(await t.sql`SELECT profile_id FROM introduction_followups`).toHaveLength(0);
  });



  it("erasing a person takes their introductions with them", async () => {
    const { a } = await pair();
    await t.sql`DELETE FROM accounts WHERE id=${a.accountId}`;
    expect(await t.sql`SELECT id FROM introductions`).toHaveLength(0);
  });
});

describe("answering", () => {
  it("asks each side anonymously, and introduces them only when both say yes, each in their own words", async () => {
    const { a, b, id } = await pair();
    const ra = routed(a), rb = routed(b);
    expect((await ra.state()).introduction).toEqual({ id, stage: "ask" });
    for (const leak of ["Jun", "Park", FINISH_TOO]) expect(await ra.raw(), `the ask carries ${leak}`).not.toContain(leak);
    expect(await (await ra.post(`/${id}/answer`, { answer: "yes" })).json()).toEqual({ stage: "waiting" });
    expect(ra.requestMatch, "a yes queues its own lapse pass").toHaveBeenCalledWith(expect.objectContaining({ profileId: a.profileId, key: `asked:${id}` }));
    expect((await ra.state()).introduction, "waiting is invisible").toBeNull();
    expect(await (await rb.post(`/${id}/answer`, { answer: "yes" })).json())
      .toEqual({ id, stage: "introduced", principle: FINISH_TOO });
    expect((await ra.state()).introduction).toEqual({ id, stage: "introduced", principle: FINISH });
    const seen = await ra.raw();
    for (const leak of [FINISH_TOO, "Jun", "Park", b.profileId]) expect(seen, `A's introduction carries ${leak}`).not.toContain(leak);
    expect((await ra.post(`/${id}/seen`)).status).toBe(200);
    expect((await ra.state()).introduction).toBeNull();
    expect((await rb.state()).introduction, "B's Done is B's own").toMatchObject({ stage: "introduced" });
    expect(ra.requestMatch, "settling asks for the next match").toHaveBeenCalledWith({ profileId: a.profileId, key: "now" });
  });

  it("never reveals a no: after the other side's no, a yes waits and keeps its person out of new matches exactly as after silence", async () => {
    /* Two worlds that differ only in whether B said no. */
    const observe = async (bSaysNo: boolean) => {
      await t.truncateAll();
      const { a, b, id } = await pair();
      const ra = routed(a), rb = routed(b);
      const third = await person("Mina Kim"); await principle(third, FINISH_THREE); await consent(third);
      const before = await ra.raw();
      if (bSaysNo) expect(await (await rb.post(`/${id}/answer`, { answer: "no" })).json()).toEqual({ stage: "declined" });
      const ask = await ra.raw();
      const yes = await (await ra.post(`/${id}/answer`, { answer: "yes" })).json();
      const after = await ra.raw();
      const busy = await match(a);
      return { same: ask === before, yes, after, busy };
    };
    const silent = await observe(false), refused = await observe(true);
    expect(refused.same, "A's ask changed after B's no").toBe(true);
    expect(refused.yes).toEqual(silent.yes);
    expect(refused.after).toEqual(silent.after);
    expect(refused.busy, "B's no freed A for a new ask").toBe("busy");
    expect(silent.busy).toBe("busy");
  });

  it("a waiting yes lapses with the ask, at createdAt plus the window, whatever the other side did", async () => {
    const { a, b, id } = await pair();
    const c = await person("Mina Kim"); await principle(c, FINISH_THREE); await consent(c);
    /* A yes on the ask's last day does not buy another fortnight. */
    await t.sql`UPDATE introductions SET created_at = created_at - ${`${INTRODUCTION_WINDOW_DAYS - 1} days`}::interval WHERE id=${id}`;
    const ra = routed(a);
    expect((await ra.post(`/${id}/answer`, { answer: "yes" })).status).toBe(200);
    expect(ra.requestMatch).toHaveBeenCalledWith(expect.objectContaining({ profileId: a.profileId, key: `asked:${id}` }));
    await routed(b).post(`/${id}/answer`, { answer: "no" });
    expect(await match(a)).toBe("busy");
    await t.sql`UPDATE introductions SET created_at = created_at - interval '2 days' WHERE id=${id}`;
    expect(await match(a), "free once the ask's own window ends").toBe("matched");
  });

  it("a yes never completes with someone who has since turned introductions off", async () => {
    const { a, b, id } = await pair();
    expect((await routed(a).post(`/${id}/answer`, { answer: "yes" })).status).toBe(200);
    /* A turned off and on again: the earlier yes is withdrawn either way. */
    await t.sql`UPDATE introduction_consents SET enabled = false WHERE profile_id = ${a.profileId}`;
    expect(await (await routed(b).post(`/${id}/answer`, { answer: "yes" })).json()).toEqual({ stage: "waiting" });
    expect((await routed(b).state()).introduction).toBeNull();
  });

  it("a revocation racing the other side's yes never leaves the revoker's name on show", async () => {
    for (let round = 0; round < 6; round += 1) {
      await t.truncateAll();
      const { a, b, id } = await pair();
      await routed(a).post(`/${id}/answer`, { answer: "yes" });
      const [, answered] = await Promise.all([
        setIntroductionConsent(t.db as never, a.profileId, false),
        (async () => (await routed(b).post(`/${id}/answer`, { answer: "yes" })).json())(),
      ]);
      expect((await routed(b).state()).introduction, `round ${round}: the revoker is still introduced`).toBeNull();
      const [row] = await t.sql`SELECT status, closed_at FROM introductions WHERE id=${id}`;
      if ((answered as { stage: string }).stage === "introduced") expect(row!.closed_at, "completed before the revocation, then closed by it").not.toBeNull();
      else expect(row!.status).not.toBe("accepted");
    }
  });

  it("a match racing a revocation never writes an ask to someone who turned off", async () => {
    for (let round = 0; round < 6; round += 1) {
      await t.truncateAll();
      const a = await person("Yunji Chung"), b = await person("Jun Park");
      await principle(a, FINISH); await principle(b, FINISH_TOO); await consent(a); await consent(b);
      await Promise.all([match(a), setIntroductionConsent(t.db as never, b.profileId, false)]);
      const rows = await t.sql`SELECT answer_a, answer_b, profile_a_id FROM introductions`;
      for (const row of rows) {
        expect(row.profile_a_id === b.profileId ? row.answer_a : row.answer_b, `round ${round}: an open ask for the revoker`).toBe("no");
      }
      expect((await routed(b).state()).introduction).toBeNull();
    }
  });

  it("an unanswered ask lapses for both sides, and can no longer be answered", async () => {
    const { a, b, id } = await pair();
    await t.sql`UPDATE introductions SET created_at = created_at - ${past}::interval WHERE id=${id}`;
    expect((await routed(a).state()).introduction).toBeNull();
    expect((await routed(b).state()).introduction).toBeNull();
    expect((await routed(a).post(`/${id}/answer`, { answer: "yes" })).status).toBe(409);
    const c = await person("Mina Kim"); await principle(c, FINISH_THREE); await consent(c);
    expect(await match(a), "both sides are free").toBe("matched");
  });

  it("turning introductions off withdraws everything open: the other side sees no change to an ask, and an unseen introduction closes for both", async () => {
    const { a, b, id } = await pair();
    const ra = routed(a), rb = routed(b);
    const before = await rb.raw();
    expect((await ra.post(`/${id}/answer`, { answer: "yes" })).status).toBe(200);
    expect((await ra.post("/consent", { enabled: false })).status).toBe(200);
    expect(await rb.raw()).toBe(before);
    expect(await (await rb.post(`/${id}/answer`, { answer: "yes" })).json(), "A's earlier yes was withdrawn").toEqual({ stage: "waiting" });
    expect(await match(a)).toBe("not_consenting");
    expect((await ra.post("/consent", { enabled: true })).status).toBe(200);
    expect((await ra.state()).introduction, "turning back on never resurrects a stale ask").toBeNull();

    await t.truncateAll();
    const p2 = await pair(["Mina Kim", "Dae Han"]);
    await routed(p2.a).post(`/${p2.id}/answer`, { answer: "yes" });
    await routed(p2.b).post(`/${p2.id}/answer`, { answer: "yes" });
    expect((await routed(p2.b).state()).introduction).toMatchObject({ stage: "introduced" });
    const revoker = routed(p2.a);
    await revoker.post("/consent", { enabled: false });
    expect((await routed(p2.b).state()).introduction, "the introduction outlived the revocation").toBeNull();
    expect(revoker.requestMatch, "the other side is free and looked at again").toHaveBeenCalledWith({ profileId: p2.b.profileId, key: "now" });
    const [row] = await t.sql`SELECT * FROM introductions WHERE id=${p2.id}`;
    const side = row!.profile_a_id === p2.a.profileId ? "a" : "b";
    expect([row![`principle_${side}_text`], row![`principle_${side}_id`]], "the revoker's words outlived the revocation").toEqual([null, null]);
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

  it("returns nothing about the other person, not even a name: only this person's own principle", async () => {
    const { a, b, id } = await pair();
    await t.sql`INSERT INTO inspirations(profile_id,text) VALUES (${b.profileId},'A private save about my sister')`;
    await t.sql`UPDATE introductions SET answer_a='yes', answer_b='yes', answered_a_at=now(), answered_b_at=now(), status='accepted' WHERE id=${id}`;
    const state = await readIntroductionState(t.db as never, a.profileId, true);
    expect(Object.keys(state.introduction ?? {}).sort()).toEqual(["id", "principle", "stage"]);
    expect(JSON.stringify(state)).not.toMatch(/sister|Jun|Park|@example/);
  });
});
