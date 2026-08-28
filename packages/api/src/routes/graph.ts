/**
 * `GET /api/graph` — one profile's mind as nodes and edges.
 *
 * The 2026-08-17 meeting sketched an agent's brain as a graph a person can
 * LOOK at, Obsidian-like: principles at the top, and under each the signals
 * it grew from, and under those the experiences whose memories evidence
 * them ("이 탑 마인드가 어떤 영감에서 왔는지 다시 추가 쿼리를 해서 가져올 수
 * 있게"). This endpoint is that picture's data, and only the picture's data:
 *
 *   - nodes carry STATEMENTS AND NAMES, never capture text. A graph that
 *     printed raw memories would be the export surface with worse access
 *     control; the drill-down to actual memories stays on the routes that
 *     own their tenancy checks.
 *   - the whole answer is bounded — this is a rendering, not a sync.
 *
 * Works for any profile the session may READ (the matrix decides), which is
 * what makes it the agent-inspection surface: pick the marketing agent in
 * the web app, see what it has come to hold.
 */
import { and, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";

import {
  experiences,
  inspirations,
  principles,
  principleSignals,
  signalEvidence,
  signals,
} from "../db/index.js";
import { getDb } from "../lib/db.js";
import { requireAuth, type AuthEnv } from "../lib/middleware.js";
import { resolveTargetProfile } from "./inspirations-tenancy.js";

const graphQuerySchema = z
  .object({ profile: z.string().uuid("profile must be a uuid").optional() })
  .strict();

/** Enough for a real mind, small enough to always draw. */
const MAX_GRAPH_SIGNALS = 120;
const MAX_GRAPH_PRINCIPLES = 40;

export interface GraphNode {
  id: string;
  kind: "principle" | "signal" | "experience";
  /** A principle's or signal's statement; an experience's name. */
  label: string;
  /** Signals carry their status so the view can light them differently. */
  status?: string;
}

export interface GraphEdge {
  from: string;
  to: string;
}

export interface GraphRouteDependencies {
  getDatabase?: typeof getDb;
  authMiddleware?: MiddlewareHandler<AuthEnv>;
}

export function createGraphRoutes(deps: GraphRouteDependencies = {}): Hono<AuthEnv> {
  const routes = new Hono<AuthEnv>();
  const getDatabase = deps.getDatabase ?? getDb;

  routes.use("*", deps.authMiddleware ?? requireAuth);

  routes.get("/", async (c) => {
    const parsed = graphQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json(
        { error: "Invalid query", details: parsed.error.flatten().fieldErrors },
        400,
      );
    }

    const db = getDatabase();
    const session = c.get("session");
    const target = await resolveTargetProfile(db, session, parsed.data.profile, "read");
    if (!target.ok) return c.json(target.body, target.status);

    const [principleRows, signalRows, experienceRows] = await Promise.all([
      db
        .select({ id: principles.id, statement: principles.statement })
        .from(principles)
        .where(eq(principles.profileId, target.profileId))
        .orderBy(desc(principles.createdAt))
        .limit(MAX_GRAPH_PRINCIPLES),
      db
        .select({ id: signals.id, statement: signals.statement, status: signals.status })
        .from(signals)
        .where(
          and(
            eq(signals.profileId, target.profileId),
            ne(signals.status, "retired"),
            isNull(signals.dismissedAt),
          ),
        )
        .orderBy(desc(signals.lastEvidenceAt))
        .limit(MAX_GRAPH_SIGNALS),
      db
        .select({ id: experiences.id, name: experiences.name })
        .from(experiences)
        .where(eq(experiences.profileId, target.profileId)),
    ]);

    const signalIds = signalRows.map((row) => row.id);

    const [principleEdges, experienceEdges] = await Promise.all([
      signalIds.length === 0
        ? Promise.resolve([])
        : db
            .select({
              principleId: principleSignals.principleId,
              signalId: principleSignals.signalId,
            })
            .from(principleSignals)
            .where(inArray(principleSignals.signalId, signalIds)),
      /* signal → experience is DERIVED, never stored: an edge exists where a
         memory kept during that experience stands as evidence under that
         signal. Distinct, because five memories from one trip are one edge. */
      signalIds.length === 0
        ? Promise.resolve([])
        : db
            .selectDistinct({
              signalId: signalEvidence.signalId,
              experienceId: inspirations.experienceId,
            })
            .from(signalEvidence)
            .innerJoin(inspirations, eq(inspirations.id, signalEvidence.inspirationId))
            .where(
              and(
                inArray(signalEvidence.signalId, signalIds),
                eq(inspirations.profileId, target.profileId),
              ),
            ),
    ]);

    const principleIds = new Set(principleRows.map((row) => row.id));
    const experienceIds = new Set(experienceRows.map((row) => row.id));

    const nodes: GraphNode[] = [
      ...principleRows.map((row) => ({
        id: row.id,
        kind: "principle" as const,
        label: row.statement,
      })),
      ...signalRows.map((row) => ({
        id: row.id,
        kind: "signal" as const,
        label: row.statement,
        status: row.status,
      })),
      ...experienceRows.map((row) => ({
        id: row.id,
        kind: "experience" as const,
        label: row.name,
      })),
    ];

    const edges: GraphEdge[] = [
      ...principleEdges
        .filter((edge) => principleIds.has(edge.principleId))
        .map((edge) => ({ from: edge.principleId, to: edge.signalId })),
      ...experienceEdges.flatMap((edge) =>
        edge.experienceId !== null && experienceIds.has(edge.experienceId)
          ? [{ from: edge.signalId, to: edge.experienceId }]
          : [],
      ),
    ];

    return c.json({ profileId: target.profileId, nodes, edges });
  });

  return routes;
}

export const graphRoutes = createGraphRoutes();
