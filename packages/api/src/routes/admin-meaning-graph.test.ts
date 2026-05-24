import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import { createAdminMeaningGraphRoutes } from "./admin-meaning-graph.js";

const user = { id: "00000000-0000-4000-8000-000000000001" };

function authMiddleware() {
  return async (c: any, next: () => Promise<void>) => {
    c.set("user", user);
    await next();
  };
}

function gateMiddleware() {
  return async (_c: any, next: () => Promise<void>) => {
    await next();
  };
}

function createSelect<T>(terminal: T) {
  const query: Record<string, any> = {};
  query.from = vi.fn(() => query);
  query.innerJoin = vi.fn(() => query);
  query.where = vi.fn(() => query);
  query.orderBy = vi.fn(() => query);
  query.limit = vi.fn(async () => terminal);
  return query;
}

describe("GET /api/admin/meaning-graph", () => {
  it("returns active meaning nodes, meaning edges, and evidence", async () => {
    const now = new Date("2026-05-24T12:00:00.000Z");
    const nodes = [
      {
        id: "node-1",
        userId: user.id,
        type: "question",
        label: "what is worth building when building itself gets cheap",
        description: "The save points past raw speed toward judgment.",
        status: "active",
        source: "meaning_graph_writer",
        weight: 140,
        confidence: 88,
        evidenceCount: 2,
        firstSeenAt: now,
        lastReinforcedAt: now,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "node-2",
        userId: user.id,
        type: "environment",
        label: "rooms where people can be honest before they are impressive",
        description: "Environment shapes ambition.",
        status: "active",
        source: "meaning_graph_writer",
        weight: 90,
        confidence: 78,
        evidenceCount: 1,
        firstSeenAt: now,
        lastReinforcedAt: now,
        createdAt: now,
        updatedAt: now,
      },
    ];
    const edges = [
      {
        id: "edge-1",
        userId: user.id,
        sourceNodeId: "node-1",
        targetNodeId: "node-2",
        kind: "points_to",
        weight: 88,
        confidence: 88,
        evidenceCount: 1,
        evidenceInspirationIds: ["insp-1"],
        status: "active",
        source: "meaning_graph_writer",
        lastReinforcedAt: now,
        createdAt: now,
        updatedAt: now,
      },
    ];
    const evidence = [
      {
        meaningNodeId: "node-1",
        inspirationId: "insp-1",
        packetId: "packet-1",
        reason: "WAKA building/AI signals promoted this as a live question.",
        weight: 80,
        confidence: 88,
        source: "meaning_graph_writer",
        createdAt: now,
        inspirationText: "AI makes building faster, but choosing what to build gets harder.",
        inspirationCreatedAt: now,
        sparkText: "choosing what to build gets harder",
        packetText: "waka.meaning_packet.v1\nSPARKS\nchoosing what to build gets harder",
        tokenEstimate: 24,
      },
    ];
    const db = {
      select: vi
        .fn()
        .mockReturnValueOnce(createSelect(nodes))
        .mockReturnValueOnce(createSelect(edges))
        .mockReturnValueOnce(createSelect(evidence)),
    };
    const app = new Hono();
    app.route(
      "/api/admin/meaning-graph",
      createAdminMeaningGraphRoutes({
        getDatabase: () => db as any,
        authMiddleware: authMiddleware(),
        adminGate: gateMiddleware(),
      }),
    );

    const response = await app.request("/api/admin/meaning-graph?limit=2");

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      graph: {
        meta: { nodeCount: number; edgeCount: number; evidenceCount: number; limit: number };
        nodes: Array<Record<string, any>>;
        edges: Array<Record<string, unknown>>;
      };
    };
    expect(body.graph.meta).toEqual({ nodeCount: 2, edgeCount: 1, evidenceCount: 1, limit: 2 });
    expect(body.graph.nodes[0]).toMatchObject({
      id: "node-1",
      type: "question",
      label: "what is worth building when building itself gets cheap",
      weight: 140,
      evidenceCount: 2,
    });
    expect(body.graph.nodes[0]!.evidence[0]).toMatchObject({
      inspirationId: "insp-1",
      preview: "choosing what to build gets harder",
      tokenEstimate: 24,
    });
    expect(body.graph.edges).toEqual([
      expect.objectContaining({
        id: "edge-1",
        sourceNodeId: "node-1",
        targetNodeId: "node-2",
        kind: "points_to",
        confidence: 88,
      }),
    ]);
  });
});
