import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import {
  createTopOfMindRoutes,
  type TopOfMindNoteSurface,
} from "./top-of-mind.js";

const user = { id: "00000000-0000-4000-8000-000000000001" };

function authMiddleware() {
  return async (c: any, next: () => Promise<void>) => {
    c.set("user", user);
    await next();
  };
}

function createMomentsSelect<T>(terminal: T) {
  const limit = vi.fn(async () => terminal);
  return {
    limit,
    builder: {
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({ limit })),
        })),
      })),
    },
  };
}

function createRelatedRowsSelect<T>(terminal: T) {
  return {
    from: vi.fn(() => ({
      innerJoin: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(async () => terminal),
        })),
      })),
    })),
  };
}

function createFeedbackRowsSelect<T>(terminal: T) {
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        orderBy: vi.fn(async () => terminal),
      })),
    })),
  };
}

describe("GET /api/top-of-mind", () => {
  it("returns top-of-mind notes and keeps the preview compatibility field", async () => {
    const topOfMind = {
      generatedAt: "2026-05-24T12:00:00.000Z",
      headline: "Top of mind: what kind of life would make this work worth it",
      activeThemes: [],
      activeQuestions: [
        {
          nodeId: "node-1",
          label: "what kind of life would make this work worth it",
          type: "question",
          reason: "The meaning graph infers a live work/life question.",
          evidenceCount: 4,
          lastReinforcedAt: "2026-05-24T10:00:00.000Z",
          supportingInspirations: [],
        },
      ],
      relationshipSignals: [],
      summary: {
        inspirationCount: 12,
        meaningNoteCount: 7,
        relationshipEdgeCount: 3,
      },
    };
    const getTopOfMind = vi.fn(async () => topOfMind);
    const note: TopOfMindNoteSurface = {
      id: "00000000-0000-4000-8000-000000000010",
      userId: user.id,
      title: "I need workrooms where making the thing is the default temperature.",
      ambitionDimension: "work",
      ambientSignal: "I need workrooms where making the thing is the default temperature.",
      matchedEnvironment: "A working culture where rituals become visible through repeated making.",
      antiEnvironment: "Work contexts that reward commentary while the real object stays abstract.",
      evidenceRationale: "Three saved signals are clustering around this frequency.",
      rejectedAlternativeInterpretation: null,
      type: "pattern",
      body: "Multiple signals keep circling the same careful ritual.",
      prompt: null,
      guidance: null,
      confidence: 82,
      status: "active",
      relatedSignalIds: ["00000000-0000-4000-8000-000000000101"],
      relatedContextNodeIds: [],
      createdAt: new Date("2026-05-30T10:00:00.000Z"),
      updatedAt: new Date("2026-05-30T11:00:00.000Z"),
      source: "wow_moment_compatibility",
      isProvisional: true,
      legacy: {
        wowMomentId: "00000000-0000-4000-8000-000000000010",
        wowKind: "recurrence",
        wowScore: 82,
      },
      evidencePreviews: [],
      relatedSignals: [],
    };
    const listNotes = vi.fn(async () => [note]);
    const db = {};
    const app = new Hono();
    app.route(
      "/api/top-of-mind",
      createTopOfMindRoutes({
        getDatabase: () => db as any,
        getTopOfMind,
        listNotes,
        authMiddleware: authMiddleware(),
      }),
    );

    const response = await app.request("/api/top-of-mind?limit=7");

    expect(response.status).toBe(200);
    expect(getTopOfMind).toHaveBeenCalledWith(db, user.id);
    expect(listNotes).toHaveBeenCalledWith(db, { userId: user.id, limit: 7 });
    await expect(response.json()).resolves.toMatchObject({
      topOfMind,
      topOfMindNotes: [
        {
          id: "00000000-0000-4000-8000-000000000010",
          title: "I need workrooms where making the thing is the default temperature.",
          ambitionDimension: "work",
          ambientSignal: "I need workrooms where making the thing is the default temperature.",
          status: "active",
          source: "wow_moment_compatibility",
        },
      ],
    });
  });

  it("serializes active note evidence previews without exposing admin graph internals", async () => {
    const moment = {
      id: "00000000-0000-4000-8000-000000000010",
      userId: user.id,
      title: "Rituals keep returning",
      kind: "recurrence",
      why: "Multiple signals keep circling the same careful ritual.",
      reflectionQuestion: null,
      reflectionGuide: "Try one small version this week.",
      wowScore: 82,
      createdAt: new Date("2026-05-30T10:00:00.000Z"),
      updatedAt: new Date("2026-05-30T11:00:00.000Z"),
    };
    const relatedRows = [
      {
        wowMomentId: moment.id,
        inspirationId: "00000000-0000-4000-8000-000000000101",
        role: "Source signal",
        reason: "This signal shows the recurring ritual.",
        sortOrder: 0,
        inspirationText: "Signal text with enough detail to explain the post-it.",
        inspirationKind: "note",
        inspirationCreatedAt: new Date("2026-05-29T10:00:00.000Z"),
        inspirationWowScore: 64,
      },
    ];
    const momentsSelect = createMomentsSelect([moment]);
    const db = {
      select: vi
        .fn()
        .mockReturnValueOnce(momentsSelect.builder)
        .mockReturnValueOnce(createRelatedRowsSelect(relatedRows))
        .mockReturnValueOnce(
          createRelatedRowsSelect([
            {
              wowMomentId: moment.id,
              meaningNodeId: "00000000-0000-4000-8000-000000000201",
            },
          ]),
        )
        .mockReturnValueOnce(createFeedbackRowsSelect([])),
    };
    const getTopOfMind = vi.fn(async () => ({
      generatedAt: "2026-05-30T12:00:00.000Z",
      headline: "Top of mind",
      activeThemes: [],
      activeQuestions: [],
      relationshipSignals: [],
      summary: {
        inspirationCount: 1,
        meaningNoteCount: 0,
        relationshipEdgeCount: 0,
      },
    }));
    const app = new Hono();
    app.route(
      "/api/top-of-mind",
      createTopOfMindRoutes({
        getDatabase: () => db as any,
        getTopOfMind,
        authMiddleware: authMiddleware(),
      }),
    );

    const response = await app.request("/api/top-of-mind?limit=1");

    expect(response.status).toBe(200);
    expect(momentsSelect.limit).toHaveBeenCalledWith(1);
    const body = (await response.json()) as { topOfMindNotes: unknown[] };
    expect(body.topOfMindNotes).toEqual([
      expect.objectContaining({
        id: moment.id,
        userId: user.id,
        title: "test the question where it can cost something",
        ambitionDimension: "next_experiment",
        ambientSignal: "test the question where it can cost something",
        matchedEnvironment: "A practical setting where rituals keep returning can be tested in public conditions.",
        antiEnvironment: "Analysis loops that keep the question safe, abstract, and uncostly.",
        evidenceRationale:
          "This post-it is inferred from saved signals and may change as the graph gets better evidence.",
        type: "action",
        body: "Multiple signals keep circling the same careful ritual.",
        confidence: 82,
        status: "active",
        relatedSignalIds: ["00000000-0000-4000-8000-000000000101"],
        relatedContextNodeIds: ["00000000-0000-4000-8000-000000000201"],
        evidencePreviews: [
          {
            signalId: "00000000-0000-4000-8000-000000000101",
            role: "Source signal",
            reason: "This signal shows the recurring ritual.",
            textPreview: "Signal text with enough detail to explain the post-it.",
            kind: "note",
            createdAt: "2026-05-29T10:00:00.000Z",
            resonanceScore: 64,
          },
        ],
        relatedSignals: [
          {
            id: "00000000-0000-4000-8000-000000000101",
            preview: "Signal text with enough detail to explain the post-it.",
            kind: "note",
            createdAt: "2026-05-29T10:00:00.000Z",
            resonanceScore: 64,
          },
        ],
        legacy: {
          wowMomentId: moment.id,
          wowKind: "recurrence",
          wowScore: 82,
        },
      }),
    ]);
    expect(JSON.stringify(body.topOfMindNotes)).not.toContain("meaningNodeId");
    expect(JSON.stringify(body.topOfMindNotes)).not.toContain("admin");
  });

  it("derives note status from latest applied feedback provenance", async () => {
    const moment = {
      id: "00000000-0000-4000-8000-000000000010",
      userId: user.id,
      title: "This reflection may be stale",
      kind: "tension",
      why: "The note no longer feels true.",
      reflectionQuestion: null,
      reflectionGuide: null,
      wowScore: 52,
      createdAt: new Date("2026-05-30T10:00:00.000Z"),
      updatedAt: new Date("2026-05-30T11:00:00.000Z"),
    };
    const momentsSelect = createMomentsSelect([moment]);
    const db = {
      select: vi
        .fn()
        .mockReturnValueOnce(momentsSelect.builder)
        .mockReturnValueOnce(createRelatedRowsSelect([]))
        .mockReturnValueOnce(createRelatedRowsSelect([]))
        .mockReturnValueOnce(
          createFeedbackRowsSelect([
            {
              targetId: moment.id,
              metadata: {
                appliedFeedback: {
                  source: "user_feedback",
                  topOfMindNoteStatus: "stale",
                },
              },
            },
          ]),
        ),
    };
    const app = new Hono();
    app.route(
      "/api/top-of-mind",
      createTopOfMindRoutes({
        getDatabase: () => db as any,
        getTopOfMind: vi.fn(async () => ({
          generatedAt: "2026-05-30T12:00:00.000Z",
          headline: "Top of mind",
          activeThemes: [],
          activeQuestions: [],
          relationshipSignals: [],
          summary: {
            inspirationCount: 1,
            meaningNoteCount: 0,
            relationshipEdgeCount: 0,
          },
        })),
        authMiddleware: authMiddleware(),
      }),
    );

    const response = await app.request("/api/top-of-mind?limit=1");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      topOfMindNotes: [{ id: moment.id, status: "stale" }],
    });
  });

  it("rejects invalid list query parameters", async () => {
    const app = new Hono();
    app.route(
      "/api/top-of-mind",
      createTopOfMindRoutes({
        getDatabase: () => ({}) as any,
        getTopOfMind: vi.fn(),
        listNotes: vi.fn(),
        authMiddleware: authMiddleware(),
      }),
    );

    const response = await app.request("/api/top-of-mind?limit=0");

    expect(response.status).toBe(400);
  });
});

describe("GET /api/top-of-mind/:noteId", () => {
  it("returns one note scoped to the signed-in tenant", async () => {
    const noteId = "00000000-0000-4000-8000-000000000010";
    const note: TopOfMindNoteSurface = {
      id: noteId,
      userId: user.id,
      title: "A provisional reflection",
      ambitionDimension: "next_experiment",
      ambientSignal: "test the question where it can cost something",
      matchedEnvironment: "A practical setting where a provisional reflection can be tested in public conditions.",
      antiEnvironment: "Analysis loops that keep the question safe, abstract, and uncostly.",
      evidenceRationale: "This post-it is inferred from saved signals and may change as the graph gets better evidence.",
      rejectedAlternativeInterpretation: null,
      type: "hypothesis",
      body: "This might matter.",
      prompt: "What would make this true?",
      guidance: null,
      confidence: 74,
      status: "active",
      relatedSignalIds: [],
      relatedContextNodeIds: [],
      createdAt: new Date("2026-05-30T10:00:00.000Z"),
      updatedAt: new Date("2026-05-30T11:00:00.000Z"),
      source: "wow_moment_compatibility",
      isProvisional: true,
      legacy: {
        wowMomentId: noteId,
        wowKind: "outlier",
        wowScore: 74,
      },
      evidencePreviews: [],
      relatedSignals: [],
    };
    const getNote = vi.fn(async () => note);
    const db = {};
    const app = new Hono();
    app.route(
      "/api/top-of-mind",
      createTopOfMindRoutes({
        getDatabase: () => db as any,
        getTopOfMind: vi.fn(),
        getNote,
        authMiddleware: authMiddleware(),
      }),
    );

    const response = await app.request(`/api/top-of-mind/${noteId}`);

    expect(response.status).toBe(200);
    expect(getNote).toHaveBeenCalledWith(db, { userId: user.id, noteId });
    await expect(response.json()).resolves.toMatchObject({
      topOfMindNote: {
        id: noteId,
        userId: user.id,
        status: "active",
      },
    });
  });

  it("returns 404 when the note does not belong to the signed-in tenant", async () => {
    const app = new Hono();
    app.route(
      "/api/top-of-mind",
      createTopOfMindRoutes({
        getDatabase: () => ({}) as any,
        getTopOfMind: vi.fn(),
        getNote: vi.fn(async () => null),
        authMiddleware: authMiddleware(),
      }),
    );

    const response = await app.request(
      "/api/top-of-mind/00000000-0000-4000-8000-000000000999",
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Top-of-mind note not found",
    });
  });

  it("validates note ids before querying", async () => {
    const getNote = vi.fn();
    const app = new Hono();
    app.route(
      "/api/top-of-mind",
      createTopOfMindRoutes({
        getDatabase: () => ({}) as any,
        getTopOfMind: vi.fn(),
        getNote,
        authMiddleware: authMiddleware(),
      }),
    );

    const response = await app.request("/api/top-of-mind/not-a-uuid");

    expect(response.status).toBe(400);
    expect(getNote).not.toHaveBeenCalled();
  });
});
