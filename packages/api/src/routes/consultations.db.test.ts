/**
 * THE READ SIDE ANSWERS FOR ITSELF.
 *
 * goal: no-quiet-corners, Phase 1. Until now `sessions.lastSeenAt` was the
 * entire read-side trace: WAKA could not say which session was served which
 * rendering of a person's derived memory. Two halves, both pinned here on
 * real Postgres through the REAL route handlers:
 *
 *   1. **Every serve is a consultation.** A GET of signals, top of mind, or
 *      the principles rendering writes exactly one row naming the session,
 *      the reader, the served profile, and the version (artifact version
 *      for top of mind, the rendering day-stamp for principles, and the
 *      honest null when nothing has been synthesized yet). Two serves are
 *      two rows — a record accumulates, it does not overwrite.
 *
 *   2. **The record reads back — to the owner alone.** GET
 *      /api/consultations returns the account's rows newest first, named
 *      (reader, served profile, surface); another account's serves never
 *      appear, and an agent session is refused at the door — the audit
 *      surface is the owner's.
 *
 *   3. **An invented citation is unstorable.** A decision (kind=decision
 *      capture) cites principles through composite (profile_id, id)
 *      foreign keys, so an id that is not a principle of the capturing
 *      profile — invented, or another profile's — is refused by Postgres
 *      itself, the whole capture rolls back, and the caller gets a 400.
 *
 * These are FK and insert facts plus route wiring; a mocked query builder
 * would prove only that this file calls what this file calls, so the
 * routes are mounted with the real database and a stub auth middleware
 * whose session rows genuinely exist.
 */
import { Hono } from "hono";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDatabase } from "../../test/helpers/index.js";
import type { AuthEnv } from "../lib/middleware.js";
import type { AuthenticatedSession } from "../lib/session.js";
import { createConsultationRoutes } from "./consultations.js";
import { createInspirationsRoutes } from "./inspirations.js";
import { createPrincipleMarkdownRoute } from "./principles.js";
import { createSignalRoutes } from "./signals.js";
import { createTopOfMindRoutes } from "./top-of-mind.js";
import { createWeatherRoute } from "./weather.js";

let t: TestDatabase;
let seq = 0;

interface Person {
  accountId: string;
  profileId: string;
  sessionId: string;
  session: AuthenticatedSession;
}

async function seedPerson(name: string): Promise<Person> {
  seq += 1;
  const [account] = await t.sql`
    INSERT INTO accounts (email) VALUES (${`consult-${seq}-${name}@example.test`}) RETURNING id`;
  const [profile] = await t.sql`
    INSERT INTO profiles (account_id, type, name)
    VALUES (${account.id}, 'human', ${name}) RETURNING id`;
  const [sessionRow] = await t.sql`
    INSERT INTO sessions (profile_id, token_hash, expires_at)
    VALUES (${profile.id}, ${String(seq).padStart(64, "0")}, now() + interval '1 day') RETURNING id`;
  return {
    accountId: account.id as string,
    profileId: profile.id as string,
    sessionId: sessionRow.id as string,
    session: {
      sessionId: sessionRow.id as string,
      account: { id: account.id as string, email: `consult-${seq}@example.test` },
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
  return async (c: { set: (k: "session", v: AuthenticatedSession) => void }, next: () => Promise<void>) => {
    c.set("session", session);
    await next();
  };
};

function appFor(person: Person): Hono {
  const app = new Hono<AuthEnv>();
  const deps = {
    getDatabase: () => t.db as never,
    authMiddleware: authAs(person.session) as never,
  };
  app.route("/api/signals", createSignalRoutes(deps));
  app.route("/api/top-of-mind", createTopOfMindRoutes(deps));
  app.route("/api/principles.md", createPrincipleMarkdownRoute(deps));
  app.route("/api/inspirations", createInspirationsRoutes(deps));
  app.route("/api/weather", createWeatherRoute(deps));
  app.route("/api/consultations", createConsultationRoutes(deps));
  return app as unknown as Hono;
}

const consultationRows = async (profileId: string) => {
  return t.sql`
    SELECT surface, session_id, reader_profile_id, artifact_version, rendered_on
    FROM consultations WHERE profile_id = ${profileId}
    ORDER BY served_at, id`;
};

afterAll(async () => {
  await t?.cleanup();
});

describe("the gate: every serve is on the record, and no citation can be invented", () => {
  beforeEach(async () => {
    t ??= await createTestDatabase();
    await t.truncateAll();
  });

  it("records one consultation per serve, naming session, reader, and version", async () => {
    const p = await seedPerson("Yun");
    const app = appFor(p);

    // A live artifact at version 3, so the serve has a version to name.
    await t.sql`
      INSERT INTO top_of_minds (profile_id, version, status, reason)
      VALUES (${p.profileId}, 3, 'live', 'regenerated')`;

    expect((await app.request("/api/signals")).status).toBe(200);
    expect((await app.request("/api/top-of-mind")).status).toBe(200);
    const md = await app.request("/api/principles.md");
    expect(md.status).toBe(200);

    const rows = await consultationRows(p.profileId);
    expect(
      rows.map((row) => [row.surface, row.artifact_version]),
      "three serves must be three records, each naming what was served",
    ).toEqual([
      ["signals", null],
      ["top_of_mind", 3],
      ["principles", null],
    ]);
    for (const row of rows) {
      expect(row.session_id, "a record that cannot say who read is not a record").toBe(
        p.sessionId,
      );
      expect(row.reader_profile_id).toBe(p.profileId);
    }
    expect(
      rows[2]!.rendered_on,
      "the principles rendering's day-stamp is its version receipt",
    ).toBe(new Date().toISOString().slice(0, 10));
  });

  it("records the honest null when nothing has been synthesized, and accumulates rather than overwrites", async () => {
    const p = await seedPerson("Bo");
    const app = appFor(p);

    expect((await app.request("/api/top-of-mind")).status).toBe(200);
    expect((await app.request("/api/top-of-mind")).status).toBe(200);

    const rows = await consultationRows(p.profileId);
    expect(rows, "two serves are two rows — the record accumulates").toHaveLength(2);
    expect(
      rows.every((row) => row.surface === "top_of_mind" && row.artifact_version === null),
      "'nothing synthesized yet' is a serve worth recording, version null",
    ).toBe(true);
  });

  it("stores a decision's citation of the profile's own principle, atomically with the capture", async () => {
    const p = await seedPerson("Cy");
    const app = appFor(p);
    const [principle] = await t.sql`
      INSERT INTO principles (profile_id, statement, type, state, origin, rank)
      VALUES (${p.profileId}, 'Ship small, learn fast.', 'value', 'held', 'minted', 1)
      RETURNING id`;

    const res = await app.request("/api/inspirations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "Chose the small release over the grand one.",
        kind: "decision",
        citedPrincipleIds: [principle.id],
      }),
    });
    expect(res.status).toBe(201);

    const citations = await t.sql`
      SELECT principle_id FROM decision_principle_citations
      WHERE profile_id = ${p.profileId}`;
    expect(citations.map((row) => row.principle_id)).toEqual([principle.id]);
  });

  it("refuses an invented citation at the schema, and the whole capture rolls back", async () => {
    const p = await seedPerson("Dee");
    const app = appFor(p);

    const res = await app.request("/api/inspirations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "Leaned on a principle that does not exist.",
        kind: "decision",
        citedPrincipleIds: ["00000000-0000-4000-8000-00000000dead"],
      }),
    });
    expect(res.status, "an invented citation must be a caller error, not a stored lie").toBe(400);

    expect(
      await t.sql`SELECT id FROM inspirations WHERE profile_id = ${p.profileId}`,
      "the capture must roll back with its citation — no decision half-recorded",
    ).toHaveLength(0);
  });

  it("refuses a citation of someone else's principle — tenancy at the foreign key", async () => {
    const p = await seedPerson("Eun");
    const other = await seedPerson("Fay");
    const app = appFor(p);
    const [foreign] = await t.sql`
      INSERT INTO principles (profile_id, statement, type, state, origin, rank)
      VALUES (${other.profileId}, 'Someone else entirely.', 'value', 'held', 'minted', 1)
      RETURNING id`;

    const res = await app.request("/api/inspirations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "Citing across the fence.",
        kind: "decision",
        citedPrincipleIds: [foreign.id],
      }),
    });
    expect(res.status).toBe(400);
    expect(await t.sql`SELECT id FROM decision_principle_citations`).toHaveLength(0);
  });

  it("refuses citations on anything that is not a decision", async () => {
    const p = await seedPerson("Gil");
    const app = appFor(p);
    const res = await app.request("/api/inspirations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "Just a note.",
        kind: "note",
        citedPrincipleIds: ["00000000-0000-4000-8000-000000000001"],
      }),
    });
    expect(res.status).toBe(400);
  });
  it("records the antechamber's serve, and lets the telling alone stay off the record", async () => {
    /* The weather's two registers, split by what they carry. The full serve
       hands over the antechamber — refused candidates, derived readings of
       the person — so it is on the record like any serve of derived memory.
       The telling alone (?antechamber=false) is event counts of the loop's
       own moves: nothing of anyone's memory is served, so no consultation is
       written — which is also what lets the companion be ASKED for the
       weather without the asking inflating the very count it reports. */
    const owner = await seedPerson("Owner");
    const app = appFor(owner);

    const lite = await app.request("/api/weather?antechamber=false");
    expect(lite.status).toBe(200);
    const liteBody = (await lite.json()) as { weather: { antechamber: unknown[] } };
    expect(liteBody.weather.antechamber).toEqual([]);
    expect(await consultationRows(owner.profileId)).toHaveLength(0);

    const full = await app.request("/api/weather");
    expect(full.status).toBe(200);
    const rows = await consultationRows(owner.profileId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      surface: "weather",
      session_id: owner.sessionId,
      reader_profile_id: owner.profileId,
    });
  });
});

describe("the record reads back — to the owner alone", () => {
  beforeEach(async () => {
    t ??= await createTestDatabase();
    await t.truncateAll();
  });

  it("names the reader, the surface, and whose memory it was", async () => {
    const owner = await seedPerson("Owner");
    const stranger = await seedPerson("Stranger");

    /* two real serves — one per account — through the real routes */
    expect((await appFor(owner).request("/api/signals")).status).toBe(200);
    expect((await appFor(stranger).request("/api/signals")).status).toBe(200);

    const res = await appFor(owner).request("/api/consultations");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      consultations: Array<{
        profile: { id: string; name: string };
        reader: { id: string; name: string } | null;
        surface: string;
      }>;
    };
    expect(body.consultations, "the stranger's serve is not in this record").toHaveLength(1);
    expect(body.consultations[0]).toMatchObject({
      surface: "signals",
      profile: { id: owner.profileId, name: "Owner" },
      reader: { id: owner.profileId, name: "Owner" },
    });
  });

  it("refuses an agent session — the audit surface is the owner's", async () => {
    const owner = await seedPerson("Owner");
    const [agentProfile] = await t.sql`
      INSERT INTO profiles (account_id, type, name)
      VALUES (${owner.accountId}, 'agent', 'Scout') RETURNING id`;
    const asAgent: Person = {
      ...owner,
      session: {
        ...owner.session,
        profile: {
          ...owner.session.profile,
          id: agentProfile.id as string,
          type: "agent",
          name: "Scout",
        },
      },
    };
    const res = await appFor(asAgent).request("/api/consultations");
    expect(res.status).toBe(403);
  });
});
