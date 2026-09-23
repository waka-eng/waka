/**
 * The layer-4 surface: the matrix cells the canon promises, the sticky
 * reorder, silent declaration routing, and the golden byte-for-byte pin on
 * the canonical machine rendering — the one document every AI consumer sees.
 */

import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthenticatedSession } from "../lib/session.js";
import { renderPrinciplesMarkdown, type PrincipleView } from "./principles.js";

const HUMAN_PROFILE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AGENT_PROFILE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OTHER_PROFILE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const HUMAN_SESSION: AuthenticatedSession = {
  sessionId: "11111111-1111-4111-8111-111111111111",
  account: { id: "account-1", email: "user@example.com" },
  profile: {
    id: HUMAN_PROFILE_ID,
    accountId: "account-1",
    type: "human",
    name: "Mina",
    preferredLocale: "en-US",
  },
};

const AGENT_SESSION: AuthenticatedSession = {
  ...HUMAN_SESSION,
  sessionId: "22222222-2222-4222-8222-222222222222",
  profile: { ...HUMAN_SESSION.profile, id: AGENT_PROFILE_ID, type: "agent", name: "Scout" },
};

const mockState = vi.hoisted(() => ({
  db: undefined as any,
  session: undefined as any,
  provider: undefined as any,
}));

vi.mock("../lib/db.js", () => ({ getDb: () => mockState.db }));

vi.mock("../lib/middleware.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/middleware.js")>();
  return {
    ...actual,
    requireAuth: async (c: any, next: any) => {
      c.set("session", mockState.session);
      await next();
    },
  };
});

import { createPrincipleRoutes } from "./principles.js";

function createApp() {
  const app = new Hono();
  app.route(
    "/api/principles",
    createPrincipleRoutes({
      getDatabase: () => mockState.db,
      getModelProvider: async () => mockState.provider,
      loadProfile: async (_db: unknown, profileId: string) => {
        if (profileId === HUMAN_PROFILE_ID || profileId === AGENT_PROFILE_ID) {
          return {
            id: profileId,
            accountId: "account-1",
            type: profileId === HUMAN_PROFILE_ID ? ("human" as const) : ("agent" as const),
          };
        }
        if (profileId === OTHER_PROFILE_ID) {
          return { id: profileId, accountId: "account-2", type: "human" as const };
        }
        return null;
      },
    }),
  );
  return app;
}

/**
 * A minimal drizzle mock: select-chains resolve from a queue, inserts and
 * updates record their calls, and `transaction` hands back the same mock.
 */
function makeDb(selects: unknown[][] = []) {
  const updates: Array<Record<string, unknown>> = [];
  const inserted: Array<Record<string, unknown>> = [];
  const chainResult = (rows: unknown[]) => {
    const result: any = Promise.resolve(rows);
    result.limit = vi.fn(async () => rows);
    result.orderBy = vi.fn(async () => rows);
    return result;
  };
  const db: any = {
    execute: vi.fn(async () => []),
    select: vi.fn(() => {
      const chain: any = {};
      chain.from = vi.fn(() => chain);
      chain.innerJoin = vi.fn(() => chain);
      chain.where = vi.fn(() => chainResult(selects.shift() ?? []));
      chain.orderBy = vi.fn(async () => selects.shift() ?? []);
      return chain;
    }),
    insert: vi.fn(() => ({
      values: vi.fn((values: Record<string, unknown>) => {
        inserted.push(values);
        return {
          returning: vi.fn(async () => [{ id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", ...values }]),
        };
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((values: Record<string, unknown>) => {
        updates.push(values);
        return {
          where: vi.fn(() => {
            const result: any = Promise.resolve(undefined);
            result.returning = vi.fn(async () =>
              values.statement !== undefined ? [{ id: "existing" }] : [],
            );
            return result;
          }),
        };
      }),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => ({ returning: vi.fn(async () => [{ id: "gone" }]) })),
    })),
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)),
    updates,
    inserted,
  };
  return db;
}

beforeEach(() => {
  mockState.session = HUMAN_SESSION;
  mockState.db = makeDb();
  mockState.provider = {
    routeDeclaration: vi.fn(async () => ({ route: "principle", type: "maxim" })),
  };
});

describe("the matrix", () => {
  it("lets the owner read their own set", async () => {
    mockState.db = makeDb([[], []]);
    const res = await createApp().request("/api/principles");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ principles: [] });
  });

  it("lets an agent session read its human's principles", async () => {
    mockState.session = AGENT_SESSION;
    mockState.db = makeDb([[], []]);
    const res = await createApp().request(`/api/principles?profile=${HUMAN_PROFILE_ID}`);
    expect(res.status).toBe(200);
  });

  /** Principles are curation; capture does not extend to them. */
  it("refuses an agent session writing into its human's principles", async () => {
    mockState.session = AGENT_SESSION;
    const res = await createApp().request(`/api/principles?profile=${HUMAN_PROFILE_ID}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ statement: "Prefer X over Y." }),
    });
    expect(res.status).toBe(403);
    expect(mockState.db.inserted).toHaveLength(0);
  });

  it("gives an agent session full curation of its own set", async () => {
    mockState.session = AGENT_SESSION;
    const res = await createApp().request("/api/principles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ statement: "Prefer boring dependencies over clever ones." }),
    });
    expect(res.status).toBe(201);
    expect(mockState.db.inserted[0]).toMatchObject({ profileId: AGENT_PROFILE_ID });
  });

  it("answers a cross-account profile as not-found, not forbidden", async () => {
    const res = await createApp().request(`/api/principles?profile=${OTHER_PROFILE_ID}`);
    expect(res.status).toBe(404);
  });
});

describe("declaring", () => {
  it("creates an aspirational, locked, declared principle when it qualifies", async () => {
    mockState.db = makeDb([
      [], // rank query inside transaction
      [], // statement-chain writer: current-row lookup (none — chained from birth)
      [
        {
          id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          statement: "Prefer X over Y.",
          type: "maxim",
          state: "aspirational",
          origin: "declared",
          rank: 1,
          lockedAt: new Date(),
          heldSince: null,
          conflictsWithId: null,
          createdAt: new Date("2026-08-18T00:00:00Z"),
        },
      ], // reload views: principles
      [], // reload views: citations — pruned by empty guard? rows exist so needed
    ]);
    const res = await createApp().request("/api/principles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ statement: "Prefer X over Y." }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { created: string; principle: { state: string; locked: boolean; origin: string } };
    expect(body.created).toBe("principle");
    expect(body.principle).toMatchObject({ state: "aspirational", origin: "declared", locked: true });
    const values = mockState.db.inserted[0]!;
    expect(values.state).toBe("aspirational");
    expect(values.origin).toBe("declared");
    expect(values.lockedAt).toBeInstanceOf(Date);
  });

  /** Routed, never refused — and no verdict travels with the response. */
  it("keeps a non-qualifying declaration as an inspiration, silently", async () => {
    mockState.provider.routeDeclaration = vi.fn(async () => ({
      route: "inspiration",
      type: "maxim",
    }));
    const res = await createApp().request("/api/principles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ statement: "Ship the museum app by June." }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.created).toBe("inspiration");
    expect(body.inspirationId).toBeTruthy();
    // No test verdict, no reason, no refusal vocabulary in the payload.
    expect(JSON.stringify(body)).not.toMatch(/test|refus|fail|verdict|goal|complet/i);
    expect(mockState.db.inserted[0]).toMatchObject({ kind: "note", source: "app" });
  });

  /**
   * AN ABSENT JUDGE IS NOT A VERDICT, AND THIS CASE USED TO SAY IT WAS.
   *
   * It was called "falls back to inspiration when routing itself fails" and it
   * asserted 201 + `created: "inspiration"` — the same response a considered
   * rejection produces. So a missing key, a rate limit and a timeout were all
   * recorded as "we looked at your words and they were not a principle". They
   * went in with the inspirations, silently, and nothing in the row or the
   * response distinguished them from a judgment, which meant no screen built
   * afterwards could distinguish them either.
   *
   * The product rule it was defending is real but narrower than it was read:
   * no REFUSAL is ever shown. Saying nothing at all is a different promise,
   * and it is not one the product makes. "We could not consider this yet" is
   * the honest sentence when the tests never ran.
   *
   * The words are deliberately NOT written on this path. A declaration the
   * person can send again beats a note they did not ask for.
   */
  it("says it could not consider the words, rather than filing them as a note", async () => {
    mockState.provider.routeDeclaration = vi.fn(async () => {
      throw new Error("model down");
    });
    const res = await createApp().request("/api/principles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ statement: "Anything at all." }),
    });

    expect(res.status).toBe(503);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.retryable).toBe(true);
    /* Nothing was written. This is the assertion that separates the fix from
       a cosmetic status-code change. */
    expect(mockState.db.inserted).toHaveLength(0);
    /* And still no refusal vocabulary — the rule the old case was protecting
       holds, it just no longer requires silence about an outage. */
    expect(JSON.stringify(body)).not.toMatch(/refus|verdict|reject|not a principle/i);
  });
});

describe("reorder stickiness", () => {
  const P1 = "11111111-aaaa-4aaa-8aaa-111111111111";
  const P2 = "22222222-aaaa-4aaa-8aaa-222222222222";

  it("stamps owner_ranked_at on every row it arranges", async () => {
    mockState.db = makeDb([
      [{ id: P1 }, { id: P2 }], // known ids
      [], // reload views
    ]);
    const res = await createApp().request("/api/principles/reorder", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ order: [P2, P1] }),
    });
    expect(res.status).toBe(200);
    // Two-pass write: negatives first (unique-index safe), then finals with
    // the sticky stamp on every arranged row.
    const stamped = mockState.db.updates.filter(
      (u: Record<string, unknown>) => u.ownerRankedAt instanceof Date,
    );
    expect(stamped).toHaveLength(2);
    const negatives = mockState.db.updates.filter(
      (u: Record<string, unknown>) => typeof u.rank === "number" && (u.rank as number) < 0,
    );
    expect(negatives).toHaveLength(2);
  });

  it("refuses a partial order — every principle exactly once", async () => {
    mockState.db = makeDb([[{ id: P1 }, { id: P2 }]]);
    const res = await createApp().request("/api/principles/reorder", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ order: [P1] }),
    });
    expect(res.status).toBe(400);
  });
});

describe("the canonical rendering", () => {
  const view = (overrides: Partial<PrincipleView>): PrincipleView => ({
    id: "4c952fe3-0000-4000-8000-000000000000",
    statement: "Have something working before you put more money in.",
    type: "maxim",
    state: "held",
    origin: "minted",
    rank: 1,
    locked: false,
    heldSince: "2026-06-12T00:00:00.000Z",
    conflictsWithId: null,
    citedSignals: [],
    createdAt: "2026-06-12T00:00:00.000Z",
    ...overrides,
  });

  /**
   * Byte-for-byte golden. This is the document every AI consumer sees; a
   * drifted byte here is two agents acting under two readings of one person.
   */
  it("renders the exact document", () => {
    const markdown = renderPrinciplesMarkdown(
      { name: "agikee", type: "human" },
      [
        view({}),
        view({
          id: "77a01c2e-0000-4000-8000-000000000000",
          statement: "Spend on quality where you will feel it every day.",
          state: "contested",
          conflictsWithId: "e83f19aa-0000-4000-8000-000000000000",
          rank: 2,
        }),
        view({
          id: "c15b8d90-0000-4000-8000-000000000000",
          statement: "Help people whether they deserve it or not.",
          state: "aspirational",
          origin: "declared",
          rank: 3,
        }),
      ],
      new Date("2026-08-18T07:00:00.000Z"),
    );

    expect(markdown).toBe(
      `# Principles — agikee (human profile)

> This document bounds decisions made on this person's behalf.
> Principles constrain and veto; they do not pick answers — reason
> freely inside them. When two conflict, the higher-ranked wins.
> Cite principle ids in any decision that leaned on them.
> States: held = demonstrated by this person's history.
> aspirational = declared in their own words, not yet demonstrated —
> still binding as their word. contested = under review; rank decides
> meanwhile.

1. \`p-4c952fe3\` (held) — Have something working before you put more money in.
2. \`p-77a01c2e\` (contested, in tension with p-e83f19aa) — Spend on quality where you will feel it every day.
3. \`p-c15b8d90\` (aspirational) — Help people whether they deserve it or not.

— 3 principles · generated from patterns · this rendering 2026-08-18
`,
    );
  });

  it("is deterministic — same inputs, same bytes", () => {
    const at = new Date("2026-08-18T07:00:00.000Z");
    const a = renderPrinciplesMarkdown({ name: "x", type: "agent" }, [view({})], at);
    const b = renderPrinciplesMarkdown({ name: "x", type: "agent" }, [view({})], at);
    expect(a).toBe(b);
  });

  it("says plainly when the set is empty", () => {
    const markdown = renderPrinciplesMarkdown(
      { name: "agikee", type: "human" },
      [],
      new Date("2026-08-18T07:00:00.000Z"),
    );
    expect(markdown).toContain("No principles yet. They are earned from history, or declared.");
    expect(markdown).toContain("— 0 principles");
  });
});
