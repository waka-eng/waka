/**
 * WHAT EACH KEY READ, ON THE OWNER'S RECORD (founder, 2026-11-26, agent to
 * agent). The facts this file holds:
 *
 *   1. A read a standing key makes, and the route allows, is one row: whose
 *      memory, which key, which tool, and one detail (a search's words, how
 *      many principles). Never the memory itself.
 *   2. A browser or app session's read is the person's own and is not logged;
 *      a refused read leaves no mark.
 *   3. The owner sees their account's log with each key's own name; a key
 *      session cannot read it, and another account's profile is not found.
 *   4. The daily sweep keeps 90 days.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): the auth middleware (the injected
 * session seam every route suite uses; key lookup has its own suites) and a
 * stand-in `/api/recall` that answers without embeddings. The middleware,
 * the principles document route, the log route and the sweep run for real
 * against disposable Postgres.
 */
import { randomUUID } from "node:crypto";
import { Hono, type MiddlewareHandler } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDatabase } from "../../test/helpers/index.js";
import { recordMcpReads, sweepMcpReads } from "../lib/mcp-reads.js";
import type { AuthEnv } from "../lib/middleware.js";
import type { AuthenticatedSession } from "../lib/session.js";
import { createMcpReadRoutes } from "./mcp-reads.js";
import { createPrincipleMarkdownRoute } from "./principles.js";

let t: TestDatabase;
let owner: { accountId: string; profileId: string };
let keyId: string;
let current: AuthenticatedSession;
const inject: MiddlewareHandler<AuthEnv> = async (c, next) => { c.set("session", current); await next(); };
const session = (sessionId: string): AuthenticatedSession => ({
  sessionId,
  ...(sessionId.includes(":") ? { keyScoped: true as const } : {}),
  account: { id: owner.accountId, email: "reads@example.test" },
  profile: { id: owner.profileId, accountId: owner.accountId, type: "human", name: "Mina", preferredLocale: "en-US" },
});

function app() {
  const routes = new Hono<AuthEnv>();
  routes.use("/api/*", recordMcpReads(() => t.db as never));
  routes.route("/api/principles.md", createPrincipleMarkdownRoute({ getDatabase: () => t.db as never, authMiddleware: inject }));
  const recall = new Hono<AuthEnv>();
  recall.use("*", inject);
  recall.get("/", c => c.req.query("q") === "refuse" ? c.json({ error: "no" }, 403) : c.json({ matches: [] }));
  routes.route("/api/recall", recall);
  routes.route("/api/mcp-reads", createMcpReadRoutes({ getDatabase: () => t.db as never, authMiddleware: inject }));
  return routes;
}

beforeAll(async () => {
  t = await createTestDatabase();
  const [account] = await t.sql`INSERT INTO accounts (email) VALUES ('reads@example.test') RETURNING id`;
  const [profile] = await t.sql`INSERT INTO profiles (account_id, type, name) VALUES (${account.id}, 'human', 'Mina') RETURNING id`;
  owner = { accountId: account.id as string, profileId: profile.id as string };
  const [key] = await t.sql`INSERT INTO keeper_keys (profile_id, token_hash, prefix, label)
    VALUES (${owner.profileId}, ${`hash-${randomUUID()}`}, 'waka_keeper_ab12', 'Claude on my laptop') RETURNING id`;
  keyId = key.id as string;
});
afterAll(async () => { await t?.cleanup(); });

describe("the read log", () => {
  it("records a key's allowed reads with one detail each, and nothing else", async () => {
    const routes = app();
    current = session(`keeper-key:${keyId}`);
    expect((await routes.request("/api/principles.md")).status).toBe(200);
    expect((await routes.request("/api/recall?q=job%20offer")).status).toBe(200);
    expect((await routes.request("/api/recall?q=refuse")).status).toBe(403);
    current = session(randomUUID());
    expect((await routes.request("/api/recall?q=my%20own%20search")).status).toBe(200);

    const rows = await t.sql`SELECT key_kind, key_id, tool, detail, profile_id FROM mcp_reads ORDER BY read_at, tool`;
    expect(rows.map(row => [row.key_kind, row.tool, row.detail])).toEqual([["keeper", "principles", "0"], ["keeper", "recall", "job offer"]]);
    expect(rows.every(row => row.key_id === keyId && row.profile_id === owner.profileId)).toBe(true);
  });

  it("shows the owner the log with the key's own name, and never to a key", async () => {
    const routes = app();
    current = session(randomUUID());
    const listed = await (await routes.request("/api/mcp-reads")).json() as { reads: Array<{ tool: string; detail: string | null; key: { label: string | null; prefix: string | null; revoked: boolean } }> };
    expect(listed.reads.map(read => read.tool)).toEqual(["recall", "principles"]);
    expect(listed.reads[0]!.key).toEqual({ kind: "keeper", label: "Claude on my laptop", prefix: "waka_keeper_ab12", revoked: false });
    expect((await routes.request(`/api/mcp-reads?profile=${randomUUID()}`)).status).toBe(404);
    current = session(`keeper-key:${keyId}`);
    expect((await routes.request("/api/mcp-reads")).status).toBe(403);
  });

  it("keeps ninety days", async () => {
    await t.sql`INSERT INTO mcp_reads (profile_id, key_kind, key_id, tool, read_at)
      VALUES (${owner.profileId}, 'keeper', ${keyId}, 'signals', now() - interval '91 days')`;
    expect(await sweepMcpReads(t.db as never, new Date())).toBe(1);
    expect((await t.sql`SELECT count(*)::int AS n FROM mcp_reads`)[0]!.n).toBe(2);
  });
});
