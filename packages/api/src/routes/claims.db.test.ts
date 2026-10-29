/**
 * THE CLAIM QUEUE, AND THE DEADLOCK IT EXISTS TO BREAK.
 *
 * `/api/claims` is not a filter on `/api/signals`. It is the fix for a closed
 * loop in the product: a claim was reachable only as a `ground` under a
 * top-of-mind entry, a top of mind cites only the strongest signals, and
 * affirming is the one act that lifts a weak claim — so a weak claim was never
 * selected, never shown, never affirmed, and stayed weak forever.
 *
 * So the load-bearing assertion in this file is the one about an EMERGING
 * claim with a single piece of evidence. If that ever stops being served, the
 * deadlock is back and no other test in the suite would notice.
 *
 * The other four facts, each of which a careless rewrite would break:
 *
 *   1. Answering removes a claim from the queue. The queue is finishable.
 *   2. A claim REWRITTEN since you answered comes back, because the verdict
 *      was about words no longer on screen. This is what makes "is this still
 *      true?" a property of the model rather than a second mechanism.
 *   3. `partly` counts as answered. It is a verdict, not a deferral — even
 *      though nothing downstream reads it yet.
 *   4. A dismissed claim never returns. Its vector is a suppression anchor;
 *      asking again would be asking a person to re-litigate a refusal.
 *
 * And the tenancy net: one person's unanswered claims are never in another's
 * queue, enforced by the query rather than by the caller being careful.
 *
 * WHAT THIS MOCKS, AND WHY: the auth middleware only, as every route suite
 * does. Every query runs on real Postgres.
 */
import { Hono } from "hono";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDatabase } from "../../test/helpers/index.js";
import type { AuthEnv } from "../lib/middleware.js";
import type { AuthenticatedSession } from "../lib/session.js";
import { createClaimsRoutes } from "./claims.js";
import { CLAIM_REASK_DAYS } from "./signals.js";

let t: TestDatabase;
let seq = 0;

interface Person {
  profileId: string;
  session: AuthenticatedSession;
}

interface ClaimRow {
  id: string;
  statement: string;
  status: string;
  evidenceCount: number;
  /** The saves it was read from — see the receipts tests. */
  from?: Array<{ id: string; preview: string }>;
}

async function seedPerson(name: string): Promise<Person> {
  seq += 1;
  const [account] = await t.sql`
    INSERT INTO accounts (email) VALUES (${`claims-${seq}-${name}@example.test`}) RETURNING id`;
  const [profile] = await t.sql`
    INSERT INTO profiles (account_id, type, name)
    VALUES (${account.id}, 'human', ${name}) RETURNING id`;
  const [sessionRow] = await t.sql`
    INSERT INTO sessions (profile_id, token_hash, expires_at)
    VALUES (${profile.id}, ${`claims-hash-${seq}`}, now() + interval '1 hour') RETURNING id`;
  return {
    profileId: profile.id as string,
    session: {
      sessionId: sessionRow.id as string,
      account: { id: account.id as string, email: `claims-${seq}@example.test` },
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
    "/api/claims",
    createClaimsRoutes({
      getDatabase: () => t.db as never,
      authMiddleware: authMiddleware as never,
    }),
  );
  return app;
}

async function queueFor(person: Person): Promise<ClaimRow[]> {
  const response = await appFor(person).request("/api/claims");
  expect(response.status).toBe(200);
  const body = (await response.json()) as { claims: ClaimRow[] };
  return body.claims;
}

/**
 * A claim with `evidence` pieces of real support behind it.
 *
 * The evidence rows go in by hand rather than through derivation because the
 * point of each test is the READ, and a model call in the middle of it would
 * make the suite non-hermetic. `material_revision` is read from
 * `inspiration_revisions` for the same reason the demo seeder has to: the
 * `track_inspiration_material` trigger owns that number, and a literal here
 * would silently stop counting as support.
 */
async function claimWith(
  person: Person,
  statement: string,
  status: "emerging" | "active",
  evidence: number,
): Promise<string> {
  /* BORN EMERGING, ALWAYS. `assert_signal_has_evidence` refuses an INSERT that
     arrives already `active` without three independent supports, which is the
     right rule — active is a state the product ARRIVES at. So the helper earns
     it the way derivation does: mint, attach, then promote. */
  const [signal] = await t.sql`
    INSERT INTO signals (profile_id, statement, status, confidence)
    VALUES (${person.profileId}, ${statement}, 'emerging', 0) RETURNING id`;
  for (let i = 0; i < evidence; i += 1) {
    const [inspiration] = await t.sql`
      INSERT INTO inspirations (profile_id, text)
      VALUES (${person.profileId}, ${`${statement} — kept ${i}`}) RETURNING id`;
    await t.sql`
      INSERT INTO signal_evidence
        (profile_id, owner_profile_id, signal_id, inspiration_id, material_revision)
      VALUES (
        ${person.profileId}, ${person.profileId}, ${signal.id}, ${inspiration.id},
        (SELECT personal_revision FROM inspiration_revisions
          WHERE profile_id = ${person.profileId} AND inspiration_id = ${inspiration.id})
      )`;
  }
  await t.sql`
    UPDATE signals SET last_evidence_at = now(), status = ${status} WHERE id = ${signal.id}`;
  return signal.id as string;
}

/** The verdict as `POST /api/feedback` writes it: bound to the wording. */
async function answer(
  person: Person,
  signalId: string,
  value: "true" | "partly" | "not_true",
): Promise<void> {
  await t.sql`
    INSERT INTO feedback (profile_id, target_type, target_id, target_revision, value)
    VALUES (
      ${person.profileId}, 'signal', ${signalId},
      (SELECT statement_revision FROM signals WHERE id = ${signalId}),
      ${value}
    )`;
}

beforeEach(async () => {
  t = await createTestDatabase();
});

afterAll(async () => {
  await t?.cleanup();
});

describe("the claims awaiting a word", () => {
  it("serves an emerging claim with one piece of evidence — the deadlock", async () => {
    /* THE REASON THIS ROUTE EXISTS. Below the promotion bar, so it can never
       be cited in a top of mind, so under the old world it was unreachable and
       therefore unanswerable forever. The promotion bar decides what may
       REPRESENT someone; it was never meant to decide what they are allowed to
       have an opinion about. */
    const person = await seedPerson("deadlock");
    await claimWith(person, "You trust tools that start you off.", "emerging", 1);

    const queue = await queueFor(person);

    expect(queue).toHaveLength(1);
    expect(queue[0]!.status).toBe("emerging");
    expect(queue[0]!.evidenceCount).toBe(1);
  });

  it("carries the saves it was read from, in the person's own words", async () => {
    /* THE DIFFERENCE BETWEEN A READING AND A HOROSCOPE. The queue has always
       carried the ids a claim was derived from; ids are not something a
       person can check. With the material visible, "not true" is correcting a
       misreading of evidence — without it, it is being told who you are and
       having to argue back, which is the version people defend against rather
       than think about. */
    const person = await seedPerson("receipts");
    await claimWith(person, "You keep the smaller decision.", "emerging", 2);

    const queue = await queueFor(person);

    expect(queue[0]!.from).toHaveLength(2);
    expect(queue[0]!.from!.every((row) => row.preview.includes("You keep the smaller decision."))).toBe(true);
    expect(queue[0]!.from!.every((row) => typeof row.id === "string" && row.id.length > 0)).toBe(true);
  });

  it("shortens a long save rather than printing it whole under the question", async () => {
    /* This sits beneath a sentence somebody is being asked to rule on. A
       paragraph here makes the claim the smallest thing on the screen. */
    const person = await seedPerson("long");
    const [signal] = await t.sql`
      INSERT INTO signals (profile_id, statement, status, confidence)
      VALUES (${person.profileId}, 'You write at length.', 'emerging', 0) RETURNING id`;
    const [kept] = await t.sql`
      INSERT INTO inspirations (profile_id, text)
      VALUES (${person.profileId}, ${"word ".repeat(80)}) RETURNING id`;
    await t.sql`
      INSERT INTO signal_evidence
        (profile_id, owner_profile_id, signal_id, inspiration_id, material_revision)
      VALUES (
        ${person.profileId}, ${person.profileId}, ${signal.id}, ${kept.id},
        (SELECT personal_revision FROM inspiration_revisions
          WHERE profile_id = ${person.profileId} AND inspiration_id = ${kept.id})
      )`;

    const queue = await queueFor(person);

    expect(queue[0]!.from![0]!.preview.length).toBeLessThanOrEqual(96);
    expect(queue[0]!.from![0]!.preview.endsWith("\u2026")).toBe(true);
  });

  it("leaves out a save that has since been deleted rather than inventing one", async () => {
    /* The claim still stands on whatever evidence remains. Holding a
       placeholder for a thing a person removed would be the product keeping
       something they threw away. */
    const person = await seedPerson("deleted");
    await claimWith(person, "You revisit the same question.", "emerging", 2);
    await t.sql`DELETE FROM inspirations WHERE profile_id = ${person.profileId}
      AND text LIKE '%kept 0'`;

    const queue = await queueFor(person);

    expect(queue[0]!.from).toHaveLength(1);
  });

  it("drops a claim once it is answered", async () => {
    const person = await seedPerson("answered");
    const id = await claimWith(person, "You prefer the reversible door.", "active", 3);
    expect(await queueFor(person)).toHaveLength(1);

    await answer(person, id, "true");

    expect(await queueFor(person)).toHaveLength(0);
  });

  it('withholds stale support before pagination so a valid claim is not crowded out',async()=>{
    const person=await seedPerson('stale-page');
    const stale=await claimWith(person,'A source that changed.','emerging',1);
    const valid=await claimWith(person,'A current supported reading.','emerging',1);
    await t.sql`UPDATE signals SET last_evidence_at=now()+interval '1 hour' WHERE id=${stale}`;
    await t.sql`UPDATE inspirations SET text='The original now says something else.' WHERE id IN
      (SELECT inspiration_id FROM signal_evidence WHERE signal_id=${stale})`;
    const response=await appFor(person).request('/api/claims?limit=1');
    const body=await response.json() as {claims:ClaimRow[]};
    expect(body.claims.map(row=>row.id)).toEqual([valid]);
  });

  it('withholds an unsupported claim and an unanswered claim whose final source was deleted',async()=>{
    const person=await seedPerson('withdrawn');
    const unsupported=await claimWith(person,'An explicitly withdrawn reading.','emerging',1);
    const removed=await claimWith(person,'No longer backed by an original.','emerging',1);
    await t.sql`UPDATE signals SET unsupported_at=now() WHERE id=${unsupported}`;
    await t.sql`DELETE FROM inspirations WHERE id IN (SELECT inspiration_id FROM signal_evidence WHERE signal_id=${removed})`;
    expect(await queueFor(person)).toEqual([]);
  });

  it("counts partly as answered", async () => {
    /* `partly` is a verdict, not a deferral. Nothing downstream reads it yet —
       selection tests only `true` and `not_true` — but a person who answered
       must not be asked the same question again because the pipeline has not
       caught up with them. */
    const person = await seedPerson("partly");
    const id = await claimWith(person, "You are suspicious of streaks.", "active", 3);

    await answer(person, id, "partly");

    expect(await queueFor(person)).toHaveLength(0);
  });

  it("asks again when the words changed since the answer", async () => {
    /* "Is this still true?" without a second mechanism: the verdict was bound
       to a `statement_revision`, so rewriting the claim leaves the old answer
       standing about words nobody can see. Coming back is correct. */
    const person = await seedPerson("rewritten");
    const id = await claimWith(person, "You like fast tools.", "active", 3);
    await answer(person, id, "true");
    expect(await queueFor(person)).toHaveLength(0);

    await t.sql`
      UPDATE signals
      SET statement = 'You like tools that make the first move.',
          statement_revision = statement_revision + 1
      WHERE id = ${id}`;

    // A wording change must be revalidated against its sources before asking
    // the owner to judge the new sentence. Script that storage result here.
    expect(await queueFor(person)).toEqual([]);
    await t.sql`UPDATE signal_evidence e SET statement_revision=s.statement_revision FROM signals s
      WHERE s.id=e.signal_id AND s.id=${id}`;
    const queue = await queueFor(person);
    expect(queue).toHaveLength(1);
    expect(queue[0]!.statement).toBe("You like tools that make the first move.");
  });

  it("never asks again about a claim that was thrown out", async () => {
    const person = await seedPerson("dismissed");
    const id = await claimWith(person, "You chase novelty.", "active", 3);

    await t.sql`
      UPDATE signals SET dismissed_at = now(), status = 'retired' WHERE id = ${id}`;

    expect(await queueFor(person)).toHaveLength(0);
  });

  it("keeps one person's unanswered claims out of another's queue", async () => {
    const mine = await seedPerson("mine");
    const theirs = await seedPerson("theirs");
    await claimWith(mine, "You read endings first.", "active", 3);

    expect(await queueFor(mine)).toHaveLength(1);
    expect(await queueFor(theirs)).toHaveLength(0);
  });

  it('does not ask about a reading that yielded when its owner settled a contradiction',async()=>{
    const person=await seedPerson('settled-pair');
    const winner=await claimWith(person,'The choice the owner kept.','active',3);
    const yielded=await claimWith(person,'The alternative that yielded.','active',3);
    const [a,b]=[winner,yielded].sort();
    await t.sql`INSERT INTO signal_contradictions(profile_id,a_signal_id,b_signal_id,resolved_at,yielded_signal_id)
      VALUES(${person.profileId},${a!},${b!},now(),${yielded})`;
    await answer(person,winner,'true');
    expect(await queueFor(person)).toEqual([]);
  });

  it("asks the most recently evidenced first, never the most confident", async () => {
    /* The query orders by evidence and says confidence is deliberately not a
       term; decoration re-sorted by confidence on the way out, so the order
       was never the one written down. */
    const person = await seedPerson("order-by-evidence");
    const confident = await claimWith(person, "Well supported, read earlier.", "active", 6);
    await t.sql`UPDATE signals SET last_evidence_at = now() - interval '2 days' WHERE id = ${confident}`;
    const recent = await claimWith(person, "Thinly supported, read just now.", "active", 3);

    expect((await queueFor(person)).map((row) => row.id)).toEqual([recent, confident]);
  });

  it("reports more honestly when the backlog is longer than the page", async () => {
    const person = await seedPerson("backlog");
    for (let i = 0; i < 3; i += 1) {
      await claimWith(person, `You return to the same shape ${i}.`, "active", 3);
    }

    const response = await appFor(person).request("/api/claims?limit=2");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { claims: ClaimRow[]; more: boolean };

    expect(body.claims).toHaveLength(2);
    expect(body.more).toBe(true);
  });
});

describe("the yeses that have aged", () => {
  /* Founder, 2026-10-15: "is this still true? ... obviously things go
     outdated." A yes is a statement about one moment. After a season the
     same reading is asked again — and the queue still asks the unanswered
     first. */
  async function answeredDaysAgo(person: Person, signalId: string, value: "true" | "partly" | "not_true", days: number) {
    await answer(person, signalId, value);
    await t.sql`UPDATE feedback SET created_at = now() - make_interval(days => ${days})
      WHERE profile_id = ${person.profileId} AND target_id = ${signalId}`;
  }
  const askedAgain = async (person: Person) =>
    ((await queueFor(person)) as Array<ClaimRow & { askedAgain?: { lastAnsweredAt: string } }>);

  it("asks again about a yes older than a season, and says when it was", async () => {
    const person = await seedPerson("season");
    const id = await claimWith(person, "You choose tools you can leave.", "active", 3);
    await answeredDaysAgo(person, id, "true", CLAIM_REASK_DAYS + 5);

    const queue = await askedAgain(person);
    expect(queue.map((row) => row.id)).toEqual([id]);
    expect(queue[0]!.askedAgain?.lastAnsweredAt, "the card needs to know when the last yes was").toBeTruthy();
  });

  it('does not re-ask an aged yes while any of its source material awaits revalidation',async()=>{
    const person=await seedPerson('aged-stale');
    const id=await claimWith(person,'An old yes with changed evidence.','active',3);
    await answeredDaysAgo(person,id,'true',CLAIM_REASK_DAYS+5);
    await t.sql`UPDATE inspirations SET text='Changed evidence still waiting to be checked.' WHERE id IN
      (SELECT inspiration_id FROM signal_evidence WHERE signal_id=${id} LIMIT 1)`;
    expect(await askedAgain(person)).toEqual([]);
  });

  it("does not ask again about a recent yes, a no, or the person's own words", async () => {
    const person = await seedPerson("not-yet");
    const recent = await claimWith(person, "Recent yes.", "active", 3);
    await answeredDaysAgo(person, recent, "true", 10);
    const refused = await claimWith(person, "Old no.", "active", 3);
    await answeredDaysAgo(person, refused, "not_true", CLAIM_REASK_DAYS + 30);
    const own = await claimWith(person, "My own words.", "active", 3);
    await answeredDaysAgo(person, own, "true", CLAIM_REASK_DAYS + 30);
    await t.sql`UPDATE signals SET locked_at = now() WHERE id = ${own}`;

    expect(await askedAgain(person)).toEqual([]);
  });

  it("asks the unanswered first, then the oldest yes", async () => {
    const person = await seedPerson("order");
    const older = await claimWith(person, "Oldest yes.", "active", 3);
    await answeredDaysAgo(person, older, "partly", CLAIM_REASK_DAYS + 60);
    const old = await claimWith(person, "Old yes.", "active", 3);
    await answeredDaysAgo(person, old, "true", CLAIM_REASK_DAYS + 20);
    const fresh = await claimWith(person, "Never answered.", "active", 3);

    expect((await askedAgain(person)).map((row) => row.id)).toEqual([fresh, older, old]);
  });

  it("stops asking once it has been answered again", async () => {
    const person = await seedPerson("answered-again");
    const id = await claimWith(person, "Still choosing small doors.", "active", 3);
    await answeredDaysAgo(person, id, "true", CLAIM_REASK_DAYS + 5);
    await answer(person, id, "true");

    expect(await askedAgain(person)).toEqual([]);
  });
});
