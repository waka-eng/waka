/**
 * THE INSTRUMENT PANEL READS THE RECORD, AND ONLY OPERATORS READ THE PANEL.
 *
 * Three claims:
 *   1. The funnel is a faithful count of the domain tables: keeps, mints,
 *      attachments (evidence beyond each mint's own first row), refusals,
 *      consultations, artifact versions — per day — plus the standing
 *      emerging/active split, the derive/refresh job outcomes, and the live
 *      threshold values.
 *   2. The alarm column is real: a `failed` derive job shows up as one.
 *   3. The door is shut twice — 404 while the admin routes are not enabled,
 *      403 for a session that is not on the allowlist even when they are.
 *
 * WHAT THIS MOCKS, AND WHY: the auth middleware (a session is placed
 * directly, as every route db-test here does) and the enablement gate where
 * a case needs it open. The database is real; counting is the subject.
 */
import { Hono } from "hono";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDatabase } from "../../test/helpers/index.js";
import type { AuthEnv } from "../lib/middleware.js";
import type { AuthenticatedSession } from "../lib/session.js";
import { createAdminLoopHealthRoute, type LoopHealth } from "./admin-loop-health.js";

let t: TestDatabase;
let seq = 0;

interface Person {
  accountId: string;
  profileId: string;
  session: AuthenticatedSession;
}

async function seedPerson(name: string): Promise<Person> {
  seq += 1;
  const email = `loop-health-${seq}-${name}@example.test`;
  const [account] = await t.sql`
    INSERT INTO accounts (email) VALUES (${email}) RETURNING id`;
  const [profile] = await t.sql`
    INSERT INTO profiles (account_id, type, name)
    VALUES (${account.id}, 'human', ${name}) RETURNING id`;
  const [sessionRow] = await t.sql`
    INSERT INTO sessions (profile_id, token_hash, expires_at)
    VALUES (${profile.id}, ${String(seq).padStart(64, "9")}, now() + interval '1 day') RETURNING id`;
  return {
    accountId: account.id as string,
    profileId: profile.id as string,
    session: {
      sessionId: sessionRow.id as string,
      account: { id: account.id as string, email },
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

const authAs = (session: AuthenticatedSession) => {
  return async (
    c: { set: (k: "session", v: AuthenticatedSession) => void },
    next: () => Promise<void>,
  ) => {
    c.set("session", session);
    await next();
  };
};

const passGate = async (_c: unknown, next: () => Promise<void>) => {
  await next();
};

function appFor(person: Person, opts: { gate?: boolean; admin?: boolean } = {}): Hono {
  const app = new Hono<AuthEnv>();
  app.route(
    "/api/admin/loop-health",
    createAdminLoopHealthRoute({
      getDatabase: () => t.db as never,
      authMiddleware: authAs(person.session) as never,
      ...(opts.gate === false ? {} : { adminGate: passGate as never }),
      ...(opts.admin === false ? {} : { adminAuthorization: passGate as never }),
    }),
  );
  return app as unknown as Hono;
}

afterAll(async () => {
  await t?.cleanup();
});

describe("the loop's instrument panel", () => {
  beforeEach(async () => {
    t ??= await createTestDatabase();
    await t.truncateAll();
  });

  it("counts the funnel faithfully, alarm column included", async () => {
    const person = await seedPerson("Operator");

    const keeps: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const [row] = await t.sql`
        INSERT INTO inspirations (profile_id, text)
        VALUES (${person.profileId}, ${`keep number ${i}`}) RETURNING id`;
      keeps.push(row.id as string);
    }
    const [minted] = await t.sql`
      INSERT INTO signals (profile_id, statement, status, confidence)
      VALUES (${person.profileId}, 'a pattern under test', 'emerging', 0) RETURNING id`;
    /* the second signal earns activation lawfully — the db's own promotion
       guard refuses a bare 'active' insert, which this test happily leans on */
    const [second] = await t.sql`
      INSERT INTO signals (profile_id, statement, status, confidence)
      VALUES (${person.profileId}, 'an active pattern', 'emerging', 0) RETURNING id`;
    await t.sql`
      INSERT INTO signal_evidence (profile_id, owner_profile_id, signal_id, inspiration_id)
      VALUES (${person.profileId}, ${person.profileId}, ${minted.id}, ${keeps[0]}),
             (${person.profileId}, ${person.profileId}, ${minted.id}, ${keeps[1]}),
             (${person.profileId}, ${person.profileId}, ${second.id}, ${keeps[2]}),
             (${person.profileId}, ${person.profileId}, ${second.id}, ${keeps[3]}),
             (${person.profileId}, ${person.profileId}, ${second.id}, ${keeps[4]})`;
    await t.sql`UPDATE signals SET status = 'active' WHERE id = ${second.id}`;
    await t.sql`
      INSERT INTO suppressions (profile_id, candidate_statement, anchor_signal_id, anchor_statement, similarity)
      VALUES (${person.profileId}, 'too close to a dismissal', ${minted.id}, 'a pattern under test', 0.91)`;
    await t.sql`
      INSERT INTO top_of_minds (profile_id, version, reason)
      VALUES (${person.profileId}, 1, 'initial')`;
    await t.sql`
      INSERT INTO background_jobs (profile_id, type, payload, status)
      VALUES (${person.profileId}, 'derive_signals'::background_job_type, '{}'::jsonb, 'succeeded')`;
    await t.sql`
      INSERT INTO background_jobs (profile_id, type, payload, status, attempts, last_error)
      VALUES (${person.profileId}, 'derive_signals'::background_job_type, '{}'::jsonb, 'failed', 3,
              'the model did not answer usably: signal extraction')`;

    const res = await appFor(person).request("/api/admin/loop-health");
    expect(res.status).toBe(200);
    const { loopHealth } = (await res.json()) as { loopHealth: LoopHealth };

    const today = loopHealth.days.at(-1);
    expect(today, "everything seeded today lands on today's row").toBeDefined();
    expect(today).toMatchObject({
      kept: 5,
      minted: 2,
      /* five evidence rows, two mints — three genuine attachments */
      attached: 3,
      refused: 1,
      tomVersions: 1,
    });
    expect(loopHealth.standing).toEqual({
      signalsEmerging: 1,
      signalsActive: 1,
      signalsRetired: 0,
    });
    expect(loopHealth.jobs.deriveSucceeded).toBe(1);
    expect(loopHealth.jobs.deriveFailed, "the alarm column").toBe(1);
    expect(loopHealth.tomReasons).toEqual({ initial: 1 });
    expect(loopHealth.thresholds.SIGNAL_PROMOTION_MIN_EVIDENCE).toBe(3);
    expect(loopHealth.thresholds.SIGNAL_MATCH_MIN_COSINE).toBeCloseTo(0.86);
  });

  it("is not found while the admin routes are disabled", async () => {
    const person = await seedPerson("Nobody");
    delete process.env.WAKA_ENABLE_ADMIN_ROUTES;
    delete process.env.WAKA_ENABLE_BACKGROUND_JOBS_ADMIN;
    const res = await appFor(person, { gate: false }).request("/api/admin/loop-health");
    expect(res.status).toBe(404);
  });

  it("refuses a session that is not an operator", async () => {
    const person = await seedPerson("NotAdmin");
    delete process.env.WAKA_ADMIN_EMAILS;
    delete process.env.WAKA_ADMIN_ALLOWLIST;
    const res = await appFor(person, { admin: false }).request("/api/admin/loop-health");
    expect(res.status).toBe(403);
  });
});
