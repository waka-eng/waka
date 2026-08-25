/**
 * THE NAMED GROUND: BORN AT CAPTURE, A LENS ON RECALL, DERIVED FOR SIGNALS.
 *
 * Meeting decision, 2026-08-17: the unit of the memory structure is an
 * EXPERIENCE ("프로젝트를 하지 말자, 엑스피리언스로 하자"). The facts:
 *
 *   1. CAPTURE IS THE BIRTHPLACE. Naming an experience on a keep creates it;
 *      naming it again reuses the same row — one ground, many memories.
 *   2. THE LENS NARROWS RECALL. `?experience=` on the inspirations list
 *      returns exactly the memories kept on that ground, and an unknown name
 *      returns nothing rather than an error.
 *   3. A SIGNAL'S EXPERIENCES ARE ITS EVIDENCE'S. `?experience=` on the
 *      signals list walks evidence → inspiration → experience — nothing is
 *      stored twice, so nothing can drift.
 *   4. THE TENANCY NET HOLDS. An inspiration cannot name another profile's
 *      experience; Postgres refuses the row through the composite FK.
 *   5. THE GRAPH SEES IT. `/api/graph` hangs signal → experience edges off
 *      the same derivation, and principle → signal edges off the citation
 *      table, statements and names only.
 *
 * WHAT THIS MOCKS, AND WHY: the auth middleware only (the same injected
 * session every route suite uses). Every query runs on real Postgres.
 */
import { Hono } from "hono";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDatabase } from "../../test/helpers/index.js";
import type { AuthEnv } from "../lib/middleware.js";
import type { AuthenticatedSession } from "../lib/session.js";
import { createExperienceRoutes } from "../routes/experiences.js";
import { createGraphRoutes } from "../routes/graph.js";
import { createInspirationsRoutes } from "../routes/inspirations.js";
import { createSignalRoutes } from "../routes/signals.js";

let t: TestDatabase;
let seq = 0;

interface Person {
  accountId: string;
  profileId: string;
  session: AuthenticatedSession;
}

async function seedPerson(name: string): Promise<Person> {
  seq += 1;
  const [account] = await t.sql`
    INSERT INTO accounts (email) VALUES (${`experiences-${seq}-${name}@example.test`}) RETURNING id`;
  const [profile] = await t.sql`
    INSERT INTO profiles (account_id, type, name)
    VALUES (${account.id}, 'human', ${name}) RETURNING id`;
  /* a real session row: capture records the consultation under the session's
     id, and that column is a uuid — an invented string 500s the keep */
  const [sessionRow] = await t.sql`
    INSERT INTO sessions (profile_id, token_hash, expires_at)
    VALUES (${profile.id}, ${`hash-${seq}`}, now() + interval '1 hour') RETURNING id`;
  return {
    accountId: account.id as string,
    profileId: profile.id as string,
    session: {
      sessionId: sessionRow.id as string,
      account: { id: account.id as string, email: `experiences-${seq}@example.test` },
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
  const deps = { getDatabase: () => t.db as never, authMiddleware: authMiddleware as never };
  app.route("/api/inspirations", createInspirationsRoutes(deps));
  app.route("/api/signals", createSignalRoutes(deps));
  app.route("/api/experiences", createExperienceRoutes(deps));
  app.route("/api/graph", createGraphRoutes(deps));
  return app;
}

async function keep(person: Person, text: string, experience?: string): Promise<string> {
  const response = await appFor(person).request("/api/inspirations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, ...(experience ? { experience } : {}) }),
  });
  expect(response.status).toBe(201);
  const body = (await response.json()) as { inspiration: { id: string } };
  return body.inspiration.id;
}

afterAll(async () => {
  await t?.cleanup();
});

describe("the named ground", () => {
  beforeEach(async () => {
    t ??= await createTestDatabase();
    await t.truncateAll();
  });

  it("is born at capture and reused by name — one ground, many memories", async () => {
    const ari = await seedPerson("Ari");
    await keep(ari, "the maintainer asked for a squash", "the NixOS PR");
    await keep(ari, "second round of review came back kind", "the NixOS PR");
    await keep(ari, "an unrelated tuesday thought");

    const grounds = await t.sql`SELECT id, name FROM experiences`;
    expect(grounds, "two keeps, one ground").toHaveLength(1);
    expect(grounds[0]!.name).toBe("the NixOS PR");

    const standing = await t.sql`
      SELECT id FROM inspirations WHERE experience_id = ${grounds[0]!.id}`;
    expect(standing).toHaveLength(2);

    const listed = await appFor(ari).request("/api/experiences");
    const body = (await listed.json()) as {
      experiences: Array<{ name: string; inspirationCount: number }>;
    };
    expect(body.experiences).toEqual([
      expect.objectContaining({ name: "the NixOS PR", inspirationCount: 2 }),
    ]);
  });

  it("narrows recall to the ground named, and an unknown name to nothing", async () => {
    const ari = await seedPerson("Ari");
    const during = await keep(ari, "kept during the trip", "the Seoul week");
    await keep(ari, "kept on an ordinary day");

    const scoped = await appFor(ari).request(
      `/api/inspirations?experience=${encodeURIComponent("the Seoul week")}`,
    );
    const body = (await scoped.json()) as { inspirations: Array<{ id: string }> };
    expect(body.inspirations.map((row) => row.id)).toEqual([during]);

    const unknown = await appFor(ari).request("/api/inspirations?experience=never-named");
    const empty = (await unknown.json()) as { inspirations: unknown[] };
    expect(empty.inspirations, "an unknown ground holds nothing, and that is not an error").toEqual(
      [],
    );
  });

  it("reaches signals through their evidence, never through a stored link", async () => {
    const ari = await seedPerson("Ari");
    const during = await keep(ari, "walked out of the workshop early", "the Seoul week");
    await keep(ari, "an ordinary day's keep");

    /* layer 2 by hand — the derivation pipeline has its own suites */
    const [signal] = await t.sql`
      INSERT INTO signals (profile_id, statement)
      VALUES (${ari.profileId}, 'keeps leaving rooms that stopped being useful') RETURNING id`;
    await t.sql`
      INSERT INTO signal_evidence (profile_id, owner_profile_id, signal_id, inspiration_id)
      VALUES (${ari.profileId}, ${ari.profileId}, ${signal.id}, ${during})`;
    const [other] = await t.sql`
      INSERT INTO signals (profile_id, statement)
      VALUES (${ari.profileId}, 'a signal with no evidence on that ground') RETURNING id`;
    void other;

    const scoped = await appFor(ari).request(
      `/api/signals?experience=${encodeURIComponent("the Seoul week")}`,
    );
    const body = (await scoped.json()) as { signals: Array<{ id: string }> };
    expect(body.signals.map((row) => row.id)).toEqual([signal.id as string]);
  });

  it("refuses an inspiration that names another profile's ground", async () => {
    const ari = await seedPerson("Ari");
    const bo = await seedPerson("Bo");
    await keep(bo, "bo's memory on bo's ground", "bo's ground");
    const [ground] = await t.sql`SELECT id FROM experiences WHERE name = ${"bo's ground"}`;

    await expect(
      t.sql`
        INSERT INTO inspirations (profile_id, text, experience_id)
        VALUES (${ari.profileId}, 'a memory reaching across the fence', ${ground.id})`,
      "the composite FK is the fence",
    ).rejects.toThrow(/experience_fk/);
  });

  it("draws the graph: principle → signal → experience, statements and names only", async () => {
    const ari = await seedPerson("Ari");
    const during = await keep(ari, "a memory kept during the trip", "the Seoul week");

    const [signal] = await t.sql`
      INSERT INTO signals (profile_id, statement)
      VALUES (${ari.profileId}, 'keeps choosing depth over breadth') RETURNING id`;
    await t.sql`
      INSERT INTO signal_evidence (profile_id, owner_profile_id, signal_id, inspiration_id)
      VALUES (${ari.profileId}, ${ari.profileId}, ${signal.id}, ${during})`;
    const [principle] = await t.sql`
      INSERT INTO principles (profile_id, statement, rank)
      VALUES (${ari.profileId}, 'Depth is where the honest work happens', 1) RETURNING id`;
    await t.sql`
      INSERT INTO principle_signals (profile_id, principle_id, signal_id)
      VALUES (${ari.profileId}, ${principle.id}, ${signal.id})`;

    const response = await appFor(ari).request("/api/graph");
    expect(response.status).toBe(200);
    const graph = (await response.json()) as {
      nodes: Array<{ id: string; kind: string; label: string }>;
      edges: Array<{ from: string; to: string }>;
    };

    const kinds = new Map(graph.nodes.map((node) => [node.id, node.kind]));
    const [ground] = await t.sql`SELECT id FROM experiences WHERE name = ${"the Seoul week"}`;
    expect(kinds.get(principle.id as string)).toBe("principle");
    expect(kinds.get(signal.id as string)).toBe("signal");
    expect(kinds.get(ground.id as string)).toBe("experience");

    expect(graph.edges).toEqual(
      expect.arrayContaining([
        { from: principle.id, to: signal.id },
        { from: signal.id, to: ground.id },
      ]),
    );

    /* the boundary: statements and names cross, capture text never does */
    expect(JSON.stringify(graph), "no capture text in the graph").not.toContain(
      "a memory kept during the trip",
    );
  });
});
