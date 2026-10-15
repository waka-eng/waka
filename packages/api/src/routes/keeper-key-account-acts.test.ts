/**
 * WHAT A CREDENTIAL ON DISK MAY NOT DO, ASSERTED AT THE ROUTE.
 *
 * A keeper key is the person, scoped down: `lib/keeper-key-auth.ts` binds it
 * to the HUMAN profile on purpose and marks the session `keyScoped`, and the
 * bargain is keep-and-recall. Nine handlers across these five files used to
 * guard themselves with `session.profile.type !== "human"`, which a keeper key
 * passes — it IS the human profile. Each of the nine therefore read a standing
 * credential sitting in an MCP config file and waved it through to an account
 * decision: mint a memory, rename one, delete one, list every live connection,
 * end any of them, leave with the whole archive, merge
 * the person's signals.
 *
 * `keeperKeyMayPass` in `requireAuth` is why none of that was reachable, and
 * it is also why no test could say so: a single allowlist at the door answers
 * first, so the nine guards could all be deleted with the suite green. Which
 * is the same failure mode `auth-agent-boundary.test.ts` was written for, one
 * layer further in. This file asserts the ROUTE's own refusal, with the door
 * replaced — depth that can be stated is the only kind that survives a
 * product change to the allowlist.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6):
 *
 *   `requireAuth` — the authentication step only, so a request arrives
 *   carrying a keeper-key session. `humanSessionsOnly` is spread back in from
 *   the real module: it is the subject, and a stub of it would prove nothing.
 *   The three routes built by a factory take the same fake through their
 *   `authMiddleware` dependency instead, which is the seam their own suites
 *   already use.
 *
 *   `lib/db.js` — stubbed, because reaching the database IS the failure this
 *   file looks for. It records that a handler ran rather than throwing, so the
 *   assertion names the route whose gate is missing instead of surfacing an
 *   unrelated stub error.
 *
 * The last case runs the other way on purpose. A build that refused every
 * request would pass all nine refusals, and listing the account's profiles is
 * a thing a session with no account powers is still meant to be able to do.
 */
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthenticatedSession } from "../lib/session.js";

process.env.JWT_SECRET ??= "test-keeper-key-route-gate-secret";

const ACCOUNT = "00000000-0000-4000-8000-0000000000a1";
const HUMAN = "00000000-0000-4000-8000-000000000001";
const TARGET = "00000000-0000-4000-8000-000000000002";

/** The standing MCP credential: the human's own profile, scoped down. */
const KEEPER_SESSION: AuthenticatedSession = {
  sessionId: "keeper-key:00000000-0000-4000-8000-0000000000f1",
  account: { id: ACCOUNT, email: "ada@example.com" },
  profile: {
    id: HUMAN,
    accountId: ACCOUNT,
    type: "human",
    name: "Ada",
    preferredLocale: "en-US",
  },
  keyScoped: true,
};

const reached = vi.hoisted(() => ({ handler: false }));

vi.mock("../lib/middleware.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/middleware.js")>();
  return {
    ...actual,
    requireAuth: async (c: any, next: () => Promise<void>) => {
      c.set("session", KEEPER_SESSION);
      c.set("sessionToken", "waka_keeper_token");
      await next();
    },
  };
});

function stubDb(): any {
  reached.handler = true;
  const chain: any = {};
  for (const name of ["from", "innerJoin", "set", "values", "orderBy", "returning"]) {
    chain[name] = vi.fn(() => chain);
  }
  chain.limit = vi.fn(async () => []);
  chain.where = vi.fn(() => {
    const result: any = Promise.resolve([]);
    result.limit = vi.fn(async () => []);
    result.orderBy = vi.fn(async () => []);
    result.returning = vi.fn(async () => []);
    return result;
  });
  chain.then = (resolve: (rows: unknown[]) => unknown) => Promise.resolve([]).then(resolve);
  return {
    select: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    update: vi.fn(() => chain),
    delete: vi.fn(() => chain),
  };
}

vi.mock("../lib/db.js", () => ({ getDb: () => stubDb() }));

const { createExportRoute } = await import("./export.js");
const { createSignalDuplicatesRoutes } = await import("./signal-duplicates.js");
const { profilesRoutes } = await import("./profiles.js");
const { sessionsRoutes } = await import("./sessions.js");

const authMiddleware = (async (c: any, next: () => Promise<void>) => {
  c.set("session", KEEPER_SESSION);
  await next();
}) as never;

/* `records()` — a stub dependency that set `reached.handler` when a handler
   ran rather than throwing — went with the two `/api/groups` rows. It was
   only ever passed to `createGroupsRoutes`, whose injected loaders were the
   one place this suite needed a recording seam; every other router here
   reaches `reached.handler` through the module-level `stubDb`. */

function app(): Hono {
  const hono = new Hono();
  hono.route("/api/profiles", profilesRoutes);
  hono.route("/api/sessions", sessionsRoutes);
  hono.route("/api/export", createExportRoute({ authMiddleware, getDatabase: stubDb }));
  hono.route(
    "/api/signal-duplicates",
    createSignalDuplicatesRoutes({ authMiddleware, getDatabase: stubDb }),
  );
  return hono;
}

const body = (value: unknown) => ({
  headers: { "content-type": "application/json" },
  body: JSON.stringify(value),
});

describe("a keeper key may not make an account decision", () => {
  beforeEach(() => {
    reached.handler = false;
  });

  it.each([
    ["mint a memory", "/api/profiles", { method: "POST", ...body({ name: "Scout" }) }],
    [
      "rename one",
      `/api/profiles/${TARGET}`,
      { method: "PATCH", ...body({ name: "Renamed" }) },
    ],
    ["remove one", `/api/profiles/${TARGET}`, { method: "DELETE" }],
    ["see every live connection", "/api/sessions", { method: "GET" }],
    ["end a connection", `/api/sessions/${TARGET}`, { method: "DELETE" }],
    ["leave with the whole archive", "/api/export", { method: "GET" }],
    ["see the gardener's proposals", "/api/signal-duplicates", { method: "GET" }],
    [
      "merge two of the person's signals",
      `/api/signal-duplicates/${TARGET}/resolve`,
      { method: "POST", ...body({ act: "merge" }) },
    ],
    /* "take a seat in a room" and "join one" stood here. Founder: "방 없애" —
       `/api/groups` is unmounted, so a keeper key reaching those two paths now
       gets a 404 from the router rather than a 403 from `humanSessionsOnly`,
       and a 404 is not the refusal this suite exists to pin. The REST of the
       list is the point and is untouched: a keeper key is a read key, and
       every act that decides something about the account still has to be
       refused by the gate rather than by the absence of a route. */
  ])("cannot %s", async (label, path, init) => {
    const res = await app().request(path, init as RequestInit);

    expect(res.status, `${label} was not refused`).toBe(403);
    expect(
      reached.handler,
      `${label} reached its handler — humanSessionsOnly is missing from ${path}`,
    ).toBe(false);
  });

  it("still lists the account's profiles — the key has to know what it may read", async () => {
    /* The other direction. Without it, a build that refused everything above
       would pass, and reading is half of what a keeper key is for. */
    const res = await app().request("/api/profiles");
    expect(res.status).not.toBe(403);
  });
});
