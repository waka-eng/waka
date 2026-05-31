import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const queueMocks = vi.hoisted(() => ({
  enqueueMeaningGraphRebuild: vi.fn(),
  getLatestMeaningGraphRebuildJob: vi.fn(),
  getMeaningGraphRebuildJob: vi.fn(),
  scheduleBackgroundJobDrain: vi.fn(),
}));

vi.mock("../lib/queue.js", () => queueMocks);

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
  query.leftJoin = vi.fn(() => query);
  query.where = vi.fn(() => query);
  query.orderBy = vi.fn(() => query);
  query.limit = vi.fn(async () => terminal);
  query.then = (resolve: (value: T) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(terminal).then(resolve, reject);
  return query;
}

function createApp(db: any = { select: vi.fn() }) {
  const app = new Hono();
  app.route(
    "/api/admin/meaning-graph",
    createAdminMeaningGraphRoutes({
      getDatabase: () => db,
      authMiddleware: authMiddleware(),
      adminGate: gateMiddleware(),
    }),
  );
  return app;
}

function makeJob(overrides: Record<string, any> = {}) {
  const now = new Date("2026-05-24T12:00:00.000Z");
  return {
    id: "11111111-1111-4111-8111-111111111111",
    type: "meaning_graph_rebuild",
    status: "pending",
    payload: {
      requestedByUserId: user.id,
      phase: "queued",
      totalInspirations: 0,
      processedInspirations: 0,
      nodesTouched: 0,
      evidenceTouched: 0,
      edgesTouched: 0,
    },
    attempts: 0,
    maxAttempts: 1,
    runAfter: now,
    lockedAt: null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/admin/meaning-graph/rebuild", () => {
  it("enqueues a rebuild job and returns status metadata", async () => {
    queueMocks.enqueueMeaningGraphRebuild.mockResolvedValue({ jobId: "job-1", job: makeJob() });
    const app = createApp();

    const response = await app.request("/api/admin/meaning-graph/rebuild", { method: "POST" });

    expect(response.status).toBe(202);
    expect(queueMocks.enqueueMeaningGraphRebuild).toHaveBeenCalledWith(user.id);
    const body = (await response.json()) as { job: Record<string, any>; statusUrl: string };
    expect(body.statusUrl).toBe(`/api/admin/meaning-graph/rebuild/${body.job.id}`);
    expect(body.job).toMatchObject({
      id: "11111111-1111-4111-8111-111111111111",
      type: "meaning_graph_rebuild",
      status: "pending",
      payload: expect.objectContaining({ phase: "queued" }),
      attempts: 0,
      maxAttempts: 1,
      lastError: null,
    });
    expect(body.job.createdAt).toBe("2026-05-24T12:00:00.000Z");
  });
});

describe("GET /api/admin/meaning-graph/rebuild", () => {
  it("returns the latest job and nudges the worker for active jobs", async () => {
    queueMocks.getLatestMeaningGraphRebuildJob.mockResolvedValue(
      makeJob({ status: "running", payload: { ...makeJob().payload, phase: "processing" } }),
    );
    const app = createApp();

    const response = await app.request("/api/admin/meaning-graph/rebuild");

    expect(response.status).toBe(200);
    expect(queueMocks.getLatestMeaningGraphRebuildJob).toHaveBeenCalledWith(user.id);
    expect(queueMocks.scheduleBackgroundJobDrain).toHaveBeenCalledTimes(1);
    const body = (await response.json()) as { job: Record<string, any> };
    expect(body.job).toMatchObject({ status: "running", payload: expect.objectContaining({ phase: "processing" }) });
  });
});

describe("GET /api/admin/meaning-graph", () => {
  it("returns context nodes, relationship edges, evidence, notes, and feedback", async () => {
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
        packetText: "waka.signal_packet.v1\nWHAT_HIT\nchoosing what to build gets harder",
        tokenEstimate: 24,
      },
      {
        meaningNodeId: "node-2",
        inspirationId: "insp-1",
        packetId: "packet-1",
        reason: "The same save points to environments where judgment can be discussed honestly.",
        weight: 72,
        confidence: 82,
        source: "meaning_graph_writer",
        createdAt: now,
        inspirationText: "AI makes building faster, but choosing what to build gets harder.",
        inspirationCreatedAt: now,
        sparkText: "choosing what to build gets harder",
        packetText: "waka.signal_packet.v1\nWHAT_HIT\nchoosing what to build gets harder",
        tokenEstimate: 24,
      },
    ];
    const recentInspirations = [
      {
        id: "insp-1",
        text: "AI makes building faster, but choosing what to build gets harder.",
        cluster: null,
        createdAt: now,
        packetId: "packet-1",
        packetCreatedAt: now,
      },
    ];
    const relatedTopOfMind = [
      {
        id: "note-1",
        title: "You seem pulled toward rooms where honest builders make in public.",
        why: "This may matter because the signal points to the environments where ambition feels alive.",
        idempotencyKey: `top_of_mind_context_node:v1:${user.id}:node-2`,
        score: 91,
        createdAt: now,
      },
    ];
    const nodeFeedback = [
      {
        id: "feedback-1",
        targetId: "node-2",
        targetType: "context_node",
        value: "important",
        emotionLabel: "want",
        correctionText: "This is exactly the kind of room I want.",
        source: "user",
        createdAt: now,
      },
    ];
    const db = {
      select: vi
        .fn()
        .mockReturnValueOnce(createSelect(nodes))
        .mockReturnValueOnce(createSelect(edges))
        .mockReturnValueOnce(createSelect(evidence))
        .mockReturnValueOnce(createSelect(recentInspirations))
        .mockReturnValueOnce(createSelect(relatedTopOfMind))
        .mockReturnValueOnce(createSelect(nodeFeedback))
        .mockReturnValueOnce(createSelect([{ count: 12 }]))
        .mockReturnValueOnce(createSelect([{ count: 11 }]))
        .mockReturnValueOnce(createSelect([{ count: 2 }]))
        .mockReturnValueOnce(createSelect([{ count: 1 }]))
        .mockReturnValueOnce(createSelect([{ count: 1 }]))
        .mockReturnValueOnce(createSelect([{ count: 1 }]))
        .mockReturnValueOnce(createSelect([{ count: 0 }])),
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
        meta: {
          nodeCount: number;
          edgeCount: number;
          evidenceCount: number;
          limit: number;
          health: {
            inspirationCount: number;
            packetCount: number;
            nodeCount: number;
            edgeCount: number;
            evidenceCount: number;
            inspirationsWithoutPackets: number;
            nodesWithoutEvidence: number;
            edgeDensity: number;
            status: string;
            warnings: Array<{ type: string; message: string }>;
          };
        };
        nodes: Array<Record<string, any>>;
        edges: Array<Record<string, unknown>>;
        recentInspirations: Array<Record<string, any>>;
      };
    };
    expect(body.graph.meta).toMatchObject({
      nodeCount: 2,
      edgeCount: 1,
      evidenceCount: 2,
      limit: 2,
      health: {
        inspirationCount: 12,
        packetCount: 11,
        nodeCount: 2,
        edgeCount: 1,
        evidenceCount: 1,
        inspirationsWithoutPackets: 1,
        nodesWithoutEvidence: 0,
        edgeDensity: 0.5,
        status: "stale",
      },
    });
    expect(body.graph.meta.health.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "stale" })]),
    );
    expect(body.graph.nodes[0]).toMatchObject({
      id: "node-1",
      type: "question",
      contextType: "open_question",
      ambitionDimension: "next_experiment",
      label: "what is worth building when building itself gets cheap",
      weight: 140,
      evidenceCount: 2,
      relatedTopOfMindNotes: [],
      feedback: [],
    });
    expect(body.graph.nodes[1]).toMatchObject({
      id: "node-2",
      contextType: "environment",
      ambitionDimension: "place",
      relatedTopOfMindNotes: [
        expect.objectContaining({
          id: "note-1",
          title: "You seem pulled toward rooms where honest builders make in public.",
        }),
      ],
      feedback: [
        expect.objectContaining({
          id: "feedback-1",
          value: "important",
          emotionLabel: "want",
          correctionText: "This is exactly the kind of room I want.",
        }),
      ],
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
    expect(body.graph.recentInspirations[0]).toMatchObject({
      id: "insp-1",
      meaningNotes: [
        expect.objectContaining({
          id: "node-1",
          contextType: "open_question",
          reason: "WAKA building/AI signals promoted this as a live question.",
        }),
        expect.objectContaining({
          id: "node-2",
          reason: "The same save points to environments where judgment can be discussed honestly.",
        }),
      ],
      relationshipEdges: [
        expect.objectContaining({
          id: "edge-1",
          sourceReason: "WAKA building/AI signals promoted this as a live question.",
          targetReason:
            "The same save points to environments where judgment can be discussed honestly.",
        }),
      ],
    });
  });
});
