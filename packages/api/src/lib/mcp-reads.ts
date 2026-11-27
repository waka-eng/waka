/**
 * WHAT EACH KEY READ (founder, 2026-11-26, agent to agent: "build all except
 * 5"). A standing key (the person's keeper key, or an agent profile's key)
 * reads a person's memory through the same API the app uses. Every read it
 * makes that succeeds is written to `mcp_reads`, once, after the route has
 * answered: so a refused or failed read leaves no mark, and the route itself
 * decided whether the key was allowed. Browser and app sessions are never
 * logged here; their reads are the person's own.
 *
 * Recording never fails the read: a lost row is a gap in a log, a failed
 * read is a broken agent.
 */
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import type { MiddlewareHandler } from "hono";

import { agentKeys, keeperKeys, mcpReads, MCP_READ_KEEP_DAYS, profiles, type McpReadTool } from "../db/index.js";
import { getDb } from "./db.js";
import type { AuthEnv } from "./middleware.js";
import type { AuthenticatedSession } from "./session.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_MS = 86_400_000;

/** The standing key behind a session, or null for a browser or app session. */
export function standingKey(session: AuthenticatedSession | undefined): { kind: "keeper" | "agent"; id: string } | null {
  const match = /^(keeper|agent)-key:(.+)$/.exec(session?.sessionId ?? "");
  return match && UUID.test(match[2]!) ? { kind: match[1] as "keeper" | "agent", id: match[2]! } : null;
}

/** Which tool a GET path is, or null for a read this log does not keep. */
export function readToolOf(path: string): McpReadTool | null {
  const route = path.replace(/\/+$/, "");
  if (route === "/api/principles.md" || route === "/api/principles") return "principles";
  if (route === "/api/recall") return "recall";
  if (route === "/api/inspirations") return "inspirations";
  if (/^\/api\/inspirations\/[0-9a-f-]{36}$/i.test(route)) return "inspiration";
  if (route === "/api/signals" || /^\/api\/signals\/[0-9a-f-]{36}$/i.test(route)) return "signals";
  if (route === "/api/top-of-mind") return "top_of_mind";
  if (route === "/api/profiles" || /^\/api\/profiles\/[0-9a-f-]{36}$/i.test(route)) return "profiles";
  return null;
}

/** The one detail a person needs to recognise a read: never the memory itself. */
async function detailOf(tool: McpReadTool, query: Record<string, string>, response: Response): Promise<string | null> {
  if (tool === "recall") return query.q ? query.q.trim().slice(0, 120) : null;
  if (tool === "principles") {
    try {
      const body = await response.clone().text();
      if (response.headers.get("content-type")?.includes("markdown")) {
        return String(body.match(/^\d+\. `p-[0-9a-f]{8}`/gm)?.length ?? 0);
      }
      const parsed = JSON.parse(body) as { principles?: unknown[] };
      return Array.isArray(parsed.principles) ? String(parsed.principles.length) : null;
    } catch { return null; }
  }
  return null;
}

export function recordMcpReads(getDatabase: typeof getDb = getDb): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    await next();
    if (c.req.method !== "GET" || c.res.status < 200 || c.res.status >= 300) return;
    const key = standingKey(c.get("session"));
    const tool = readToolOf(c.req.path);
    if (!key || !tool) return;
    const query = c.req.query();
    const session = c.get("session");
    /* Whose memory: the route answered 2xx, so a named profile was one this
       key may read; without one it read its own. */
    const profileId = query.profile && UUID.test(query.profile) ? query.profile : session.profile.id;
    try {
      await getDatabase().insert(mcpReads).values({
        profileId, keyKind: key.kind, keyId: key.id, tool, detail: await detailOf(tool, query, c.res),
      });
    } catch (error) {
      console.warn("[mcp-read] not recorded", error instanceof Error ? error.name : "error");
    }
  };
}

export type RecentMcpRead = { id: string; tool: McpReadTool; detail: string | null; readAt: string; key: { kind: "keeper" | "agent"; label: string | null; prefix: string | null; revoked: boolean } };

/** The newest reads of the given profiles' memory, with each key's own name. */
export async function loadRecentMcpReads(db: ReturnType<typeof getDb>, profileIds: string[], limit = 30): Promise<RecentMcpRead[]> {
  if (!profileIds.length) return [];
  const rows = await db.select().from(mcpReads).where(inArray(mcpReads.profileId, profileIds))
    .orderBy(desc(mcpReads.readAt), desc(mcpReads.id)).limit(limit);
  const ids = (kind: "keeper" | "agent") => [...new Set(rows.filter(row => row.keyKind === kind).map(row => row.keyId))];
  const keeperIds = ids("keeper"), agentIds = ids("agent");
  const [keepers, agents] = await Promise.all([
    keeperIds.length ? db.select({ id: keeperKeys.id, label: keeperKeys.label, prefix: keeperKeys.prefix, revokedAt: keeperKeys.revokedAt })
      .from(keeperKeys).where(inArray(keeperKeys.id, keeperIds)) : [],
    agentIds.length ? db.select({ id: agentKeys.id, label: agentKeys.label, prefix: agentKeys.prefix, revokedAt: agentKeys.revokedAt })
      .from(agentKeys).where(inArray(agentKeys.id, agentIds)) : [],
  ]);
  const named = new Map([...keepers, ...agents].map(row => [row.id, row]));
  return rows.map(row => {
    const key = named.get(row.keyId);
    return { id: row.id, tool: row.tool, detail: row.detail, readAt: row.readAt.toISOString(),
      key: { kind: row.keyKind, label: key?.label ?? null, prefix: key?.prefix ?? null, revoked: !key || key.revokedAt !== null } };
  });
}

/** The profiles an account owns: the only memory whose log it may see. */
export async function ownedProfileIds(db: ReturnType<typeof getDb>, accountId: string): Promise<string[]> {
  return (await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.accountId, accountId))).map(row => row.id);
}

/** The daily run's sweep: reads older than `MCP_READ_KEEP_DAYS` go. */
export async function sweepMcpReads(db: Pick<ReturnType<typeof getDb>, "delete">, now: Date, profileId?: string): Promise<number> {
  const cutoff = new Date(now.getTime() - MCP_READ_KEEP_DAYS * DAY_MS);
  const gone = await db.delete(mcpReads)
    .where(profileId ? and(lt(mcpReads.readAt, cutoff), eq(mcpReads.profileId, profileId)) : lt(mcpReads.readAt, cutoff))
    .returning({ id: mcpReads.id });
  return gone.length;
}
