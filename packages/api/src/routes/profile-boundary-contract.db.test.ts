/**
 * THE BOUNDARY CONTRACT — every profile-scoped route, every verb, one table.
 *
 * The access matrix (`resolveProfileAccess`) is one function, but each route
 * reaches it through its own resolver, and a route that forgot to ask would
 * pass every suite that only tests the routes that remembered. The isolation
 * audit (2026-08-29) found ~20 `?profile=` routes with no refusal coverage
 * at all — this file is that coverage, as a contract:
 *
 *   1. AGENT → THE HUMAN PROFILE: reads pass the boundary (conditioning);
 *      every non-read verb is 403, and the refusal comes from the BOUNDARY,
 *      not from entity lookup — a probe against ids that do not exist still
 *      answers 403, proving the matrix is consulted before anything else.
 *   2. AGENT → UNGRANTED SIBLING: everything is 403.
 *   3. GRANTED SIBLING: reads open, writes still 403 — a grant opens
 *      reading only (founder ruling, 2026-08-29).
 *   4. ANOTHER ACCOUNT'S PROFILE: everything is 404, never 403 — existence
 *      is not confirmed across the account wall, whoever asks.
 *
 * And after every refused write in every scene: the tables are exactly as
 * they were. A refusal that still inserted would be the ruling in name only.
 *
 * WHAT THIS MOCKS, AND WHY: only the auth middleware (the injected-session
 * seam every route suite uses); the routes, resolvers, matrix, and Postgres
 * are real. New `?profile=` routes belong in PROBES — a route family added
 * without a row here is the gap this file exists to close.
 */
import { Hono } from "hono";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDatabase } from "../../test/helpers/index.js";
import type { AuthEnv } from "../lib/middleware.js";
import type { AuthenticatedSession } from "../lib/session.js";
import { createAttachmentRoutes } from "./attachments.js";
import { createExperienceRoutes } from "./experiences.js";
import { createGraphRoutes } from "./graph.js";
import { createInspirationsRoutes } from "./inspirations.js";
import { createPrincipleRoutes } from "./principles.js";
import { createSignalRoutes } from "./signals.js";
import { createTopOfMindRoutes } from "./top-of-mind.js";
import { createWeatherRoute } from "./weather.js";

let t: TestDatabase;
let seq = 0;

interface Person {
  profileId: string;
  session: AuthenticatedSession;
}

async function seedProfile(
  accountId: string,
  name: string,
  type: "human" | "agent",
): Promise<Person> {
  seq += 1;
  const [profile] = await t.sql`
    INSERT INTO profiles (account_id, type, name)
    VALUES (${accountId}, ${type}, ${name}) RETURNING id`;
  /* A REAL session row, not an invented id: the reads that record a
     consultation write this id into a uuid column, and an invented string
     turns the probe's first read into a 500 about the fixture. */
  const [sessionRow] = await t.sql`
    INSERT INTO sessions (profile_id, token_hash, expires_at)
    VALUES (${profile.id}, ${String(seq).padStart(64, "b")}, now() + interval '1 day') RETURNING id`;
  return {
    profileId: profile.id as string,
    session: {
      sessionId: sessionRow.id as string,
      account: { id: accountId, email: `boundary-${seq}@example.test` },
      profile: {
        id: profile.id as string,
        accountId,
        type,
        name,
        preferredLocale: "en-US",
      },
    },
  };
}

async function seedAccount(): Promise<{ human: Person; scout: Person; courier: Person }> {
  seq += 1;
  const [account] = await t.sql`
    INSERT INTO accounts (email) VALUES (${`boundary-${seq}@example.test`}) RETURNING id`;
  const accountId = account.id as string;
  return {
    human: await seedProfile(accountId, "Owner", "human"),
    scout: await seedProfile(accountId, "Scout", "agent"),
    courier: await seedProfile(accountId, "Courier", "agent"),
  };
}

function appFor(person: Person): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>();
  const deps = {
    getDatabase: () => t.db as never,
    authMiddleware: (async (
      c: { set: (k: "session", v: AuthenticatedSession) => void },
      next: () => Promise<void>,
    ) => {
      c.set("session", person.session);
      await next();
    }) as never,
  };
  app.route("/api/inspirations", createInspirationsRoutes(deps));
  app.route("/api/signals", createSignalRoutes(deps));
  app.route("/api/top-of-mind", createTopOfMindRoutes(deps));
  app.route("/api/principles", createPrincipleRoutes(deps));
  app.route("/api/experiences", createExperienceRoutes(deps));
  app.route("/api/graph", createGraphRoutes(deps));
  app.route("/api/weather", createWeatherRoute(deps));
  return app;
}

/** Ids that exist nowhere: the boundary must answer before existence does. */
const GHOST = "00000000-0000-4000-8000-00000000dead";
const GHOST2 = "00000000-0000-4000-8000-00000000beef";

interface Probe {
  name: string;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
}

const READS: Probe[] = [
  { name: "read a top-of-mind refresh receipt", method: "GET", path: `/api/top-of-mind/refresh/${GHOST}` },
  { name: "recall inspirations", method: "GET", path: "/api/inspirations?limit=5" },
  { name: "open one inspiration", method: "GET", path: `/api/inspirations/${GHOST}` },
  { name: "read its reflections", method: "GET", path: `/api/inspirations/${GHOST}/reflections` },
  { name: "read source processing", method: "GET", path: `/api/inspirations/${GHOST}/processing` },
  { name: "list signals", method: "GET", path: "/api/signals" },
  { name: "open one signal", method: "GET", path: `/api/signals/${GHOST}` },
  { name: "read the top of mind", method: "GET", path: "/api/top-of-mind" },
  { name: "read its versions", method: "GET", path: "/api/top-of-mind/versions" },
  { name: "read a particular version", method: "GET", path: `/api/top-of-mind/versions/${GHOST}` },
  { name: "list principles", method: "GET", path: "/api/principles" },
  { name: "list experiences", method: "GET", path: "/api/experiences" },
  { name: "read the graph", method: "GET", path: "/api/graph" },
  { name: "ask the weather", method: "GET", path: "/api/weather" },
];

const WRITES: Probe[] = [
  { name: "capture", method: "POST", path: "/api/inspirations", body: { text: "smuggled" } },
  { name: "edit an inspiration", method: "PATCH", path: `/api/inspirations/${GHOST}`, body: { text: "edited" } },
  { name: "delete an inspiration", method: "DELETE", path: `/api/inspirations/${GHOST}` },
  { name: "add a reflection", method: "POST", path: `/api/inspirations/${GHOST}/reflections`, body: { question: "why?" } },
  { name: "retry source processing", method: "POST", path: `/api/inspirations/${GHOST}/processing/retry`, body: {} },
  { name: "delete a reflection", method: "DELETE", path: `/api/inspirations/${GHOST}/reflections/${GHOST2}` },
  { name: "edit a signal", method: "PATCH", path: `/api/signals/${GHOST}`, body: { statement: "rewritten" } },
  { name: "release a signal", method: "POST", path: `/api/signals/${GHOST}/release` },
  { name: "revert a signal", method: "POST", path: `/api/signals/${GHOST}/revert` },
  { name: "dismiss a signal", method: "POST", path: `/api/signals/${GHOST}/dismiss` },
  { name: "restore a signal", method: "POST", path: `/api/signals/${GHOST}/restore` },
  { name: "delete a signal", method: "DELETE", path: `/api/signals/${GHOST}` },
  { name: "refresh the top of mind", method: "POST", path: "/api/top-of-mind/refresh" },
  { name: "edit a top-of-mind entry", method: "PATCH", path: `/api/top-of-mind/entries/${GHOST}`, body: { body: "rewritten" } },
  { name: "declare a principle", method: "POST", path: "/api/principles", body: { statement: "declared" } },
  { name: "edit a principle", method: "PATCH", path: `/api/principles/${GHOST}`, body: { statement: "edited" } },
  { name: "revert a principle", method: "POST", path: `/api/principles/${GHOST}/revert` },
  { name: "delete a principle", method: "DELETE", path: `/api/principles/${GHOST}` },
  { name: "reorder principles", method: "POST", path: "/api/principles/reorder", body: { order: [GHOST] } },
];

async function probeRequest(
  person: Person,
  probe: Probe,
  targetProfileId: string,
): Promise<Response> {
  const sep = probe.path.includes("?") ? "&" : "?";
  return appFor(person).request(`${probe.path}${sep}profile=${targetProfileId}`, {
    method: probe.method,
    ...(probe.body
      ? {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(probe.body),
        }
      : {}),
  });
}

/** The writable tables a refused verb must leave untouched. */
async function writtenState(): Promise<string> {
  const [counts] = await t.sql`
    SELECT (SELECT count(*) FROM inspirations) AS inspirations,
           (SELECT count(*) FROM reflections) AS reflections,
           (SELECT count(*) FROM signals) AS signals,
           (SELECT count(*) FROM principles) AS principles,
           (SELECT count(*) FROM attachments) AS attachments`;
  return JSON.stringify(counts);
}

afterAll(async () => {
  await t?.cleanup();
});

describe("the profile boundary, route by route", () => {
  beforeEach(async () => {
    t ??= await createTestDatabase();
    await t.truncateAll();
  });

  it("an agent reads the human's layers, and changes nothing in them", async () => {
    const { human, scout } = await seedAccount();

    for (const probe of READS) {
      const res = await probeRequest(scout, probe, human.profileId);
      expect(
        res.status,
        `${probe.name}: the conditioning read must pass the boundary`,
      ).not.toBe(403);
      if (!probe.path.includes(GHOST)) {
        // Ghost-id probes may honestly 404 on the entity; a list or artifact
        // read of a real profile has nothing to be missing.
        expect(res.status, `${probe.name}: a surface read serves`).toBeLessThan(300);
      }
    }

    const before = await writtenState();
    for (const probe of WRITES) {
      const res = await probeRequest(scout, probe, human.profileId);
      expect(
        res.status,
        `${probe.name}: a non-read verb on the human is refused at the boundary, before existence`,
      ).toBe(403);
    }
    expect(await writtenState(), "and the tables are exactly as they were").toBe(before);
  });

  it("an ungranted sibling is a closed door, read and write alike", async () => {
    const { scout, courier } = await seedAccount();

    const before = await writtenState();
    for (const probe of [...READS, ...WRITES]) {
      const res = await probeRequest(scout, probe, courier.profileId);
      expect(res.status, `${probe.name}: ungranted sibling`).toBe(403);
    }
    expect(await writtenState()).toBe(before);
  });

  it("a grant opens reading only — writes stay refused", async () => {
    const { human, scout, courier } = await seedAccount();
    await t.sql`
      INSERT INTO agent_read_grants (grantee_profile_id, target_profile_id, granted_by_profile_id)
      VALUES (${scout.profileId}, ${courier.profileId}, ${human.profileId})`;

    for (const probe of READS) {
      const res = await probeRequest(scout, probe, courier.profileId);
      expect(res.status, `${probe.name}: granted sibling read passes`).not.toBe(403);
    }
    const before = await writtenState();
    for (const probe of WRITES) {
      const res = await probeRequest(scout, probe, courier.profileId);
      expect(res.status, `${probe.name}: no grant opens a write`).toBe(403);
    }
    expect(await writtenState()).toBe(before);
  });

  it("another account's profile does not exist, whoever asks and whatever the verb", async () => {
    const { human, scout } = await seedAccount();
    const other = await seedAccount();

    const before = await writtenState();
    for (const probe of [...READS, ...WRITES]) {
      for (const [asker, label] of [
        [human, "their human"],
        [scout, "their agent"],
      ] as const) {
        const res = await probeRequest(asker, probe, other.human.profileId);
        expect(
          res.status,
          `${probe.name} by ${label}: across the account wall the answer is not-found, never forbidden`,
        ).toBe(404);
      }
    }
    expect(await writtenState()).toBe(before);
  });
});

describe("the attachment door: a finalize is a capture, and answers like one", () => {
  beforeEach(async () => {
    t ??= await createTestDatabase();
    await t.truncateAll();
  });

  /* Finalize-link needs no object store — the whole boundary is decided
     before any S3 exists. The router uses the same injected-session seam as
     everything else, which it grew for exactly this suite. */
  const finalize = (person: Person, inspirationId: string) => {
    const app = new Hono<AuthEnv>().route(
      "/api/attachments",
      createAttachmentRoutes({
        getDatabase: () => t.db as never,
        authMiddleware: (async (
          c: { set: (k: "session", v: AuthenticatedSession) => void },
          next: () => Promise<void>,
        ) => {
          c.set("session", person.session);
          await next();
        }) as never,
      }),
    );
    return app.request("/api/attachments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "link", inspirationId, url: "https://example.test/a" }),
    });
  };
  const seedInspiration = async (profileId: string): Promise<string> => {
    const [row] = await t.sql`
      INSERT INTO inspirations (profile_id, text) VALUES (${profileId}, 'a parent') RETURNING id`;
    return row.id as string;
  };

  it("refuses an agent hanging anything on the human's memory, grant or no grant", async () => {
    const { human, scout, courier } = await seedAccount();
    const onHuman = await seedInspiration(human.profileId);
    const onCourier = await seedInspiration(courier.profileId);
    await t.sql`
      INSERT INTO agent_read_grants (grantee_profile_id, target_profile_id, granted_by_profile_id)
      VALUES (${scout.profileId}, ${courier.profileId}, ${human.profileId})`;

    const before = await writtenState();
    expect((await finalize(scout, onHuman)).status, "onto the human: a capture, refused").toBe(403);
    expect(
      (await finalize(scout, onCourier)).status,
      "onto a granted sibling: the grant opens reading only",
    ).toBe(403);
    expect(await writtenState(), "and nothing hung anywhere").toBe(before);

    expect(
      (await finalize(human, onCourier)).status,
      "the human hanging onto their own agent's memory is the admin's act",
    ).toBe(201);
  });

  it("answers another account's inspiration as not-found, never forbidden", async () => {
    const { scout } = await seedAccount();
    const other = await seedAccount();
    const foreign = await seedInspiration(other.human.profileId);

    const before = await writtenState();
    expect((await finalize(scout, foreign)).status).toBe(404);
    expect(await writtenState()).toBe(before);
  });
});
