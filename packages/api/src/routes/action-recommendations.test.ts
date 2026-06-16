import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import {
  createActionRecommendationsRoutes,
  type SaveActionRecommendationStateInput,
} from "./action-recommendations.js";
import type { TopOfMindNoteSurface } from "./top-of-mind.js";
import {
  selectActionRecommendationCandidates,
  type ActionRecommendationState,
} from "../lib/action-recommendations.js";

const user = { id: "00000000-0000-4000-8000-000000000001" };

function getModelProvider() {
  return Promise.resolve({
    generateActionRecommendation: vi.fn(async () => ({
      text: "Draft the rough bridge-rhythm artifact and show it to one builder by Friday.",
      kind: "make_artifact" as const,
      whyNow: "The current post-it and evidence both point toward learning by making the rough thing public.",
    })),
  });
}

function authMiddleware() {
  return async (c: any, next: () => Promise<void>) => {
    c.set("user", user);
    await next();
  };
}

const note: TopOfMindNoteSurface = {
  id: "00000000-0000-4000-8000-000000000010",
  userId: user.id,
  title: "make the thing before explaining it",
  ambitionDimension: "work",
  ambientSignal: "make the thing before explaining it",
  matchedEnvironment: "A room where rough artifacts become public quickly",
  antiEnvironment: "Commentary loops where nothing gets made",
  evidenceRationale: "Saved signals keep returning to public rough drafts.",
  rejectedAlternativeInterpretation: null,
  type: "pattern",
  body: "Several saved signals connect building, showing, and learning from the room.",
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
  evidencePreviews: [
    {
      signalId: "00000000-0000-4000-8000-000000000101",
      role: "The practice",
      reason: "It names the practice.",
      textPreview: "Architecture essay about bridge rhythms in city walks",
      kind: "note",
      createdAt: "2026-05-29T10:00:00.000Z",
      resonanceScore: 9,
    },
  ],
  relatedSignals: [],
};

describe("GET /api/action-recommendations", () => {
  it("returns an empty list without loading notes, states, or the model provider", async () => {
    const db = {};
    const listTopOfMindNotes = vi.fn(async () => [note]);
    const listStates = vi.fn(async () => []);
    const saveState = vi.fn();
    const getModelProviderSpy = vi.fn(getModelProvider);
    const app = new Hono();
    app.route(
      "/api/action-recommendations",
      createActionRecommendationsRoutes({
        getDatabase: () => db as any,
        authMiddleware: authMiddleware(),
        listTopOfMindNotes,
        listStates,
        saveState,
        getModelProvider: getModelProviderSpy,
      }),
    );

    const response = await app.request("/api/action-recommendations");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      actionRecommendations: [],
    });
    expect(listTopOfMindNotes).not.toHaveBeenCalled();
    expect(listStates).not.toHaveBeenCalled();
    expect(saveState).not.toHaveBeenCalled();
    expect(getModelProviderSpy).not.toHaveBeenCalled();

    const invalidResponse = await app.request(
      "/api/action-recommendations?limit=not-a-number",
    );
    expect(invalidResponse.status).toBe(400);
    await expect(invalidResponse.json()).resolves.toMatchObject({
      error: "Invalid action recommendation query",
    });
  });

  it("persists optional completion outcomes with the completed action", async () => {
    const db = {};
    const saveState = vi.fn(
      async (_db: unknown, input: SaveActionRecommendationStateInput) => ({
        actionId: input.actionId,
        sourceTopOfMindId: input.sourceTopOfMindId,
        status: input.status,
        outcomeText: input.outcomeText ?? null,
        relatedSignalIds: input.relatedSignalIds ?? [],
        updatedAt: new Date("2026-06-01T10:00:00.000Z"),
      }),
    );
    const app = new Hono();
    app.route(
      "/api/action-recommendations",
      createActionRecommendationsRoutes({
        getDatabase: () => db as any,
        authMiddleware: authMiddleware(),
        listTopOfMindNotes: vi.fn(async () => [note]),
        listStates: vi.fn(async () => []),
        saveState,
        getModelProvider,
      }),
    );

    const [candidate] = selectActionRecommendationCandidates({
      notes: [note],
      states: [],
      limit: 5,
    });
    expect(candidate).toBeTruthy();
    const actionId = candidate.id;

    const response = await app.request(
      `/api/action-recommendations/${actionId}/state`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceTopOfMindId: note.id,
          status: "completed",
          outcomeText: "It showed the rough version was enough to start the conversation.",
          relatedSignalIds: ["00000000-0000-4000-8000-000000000101"],
        }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      actionRecommendationState: {
        actionId,
        sourceTopOfMindId: note.id,
        status: "completed",
        outcomeText: "It showed the rough version was enough to start the conversation.",
        relatedSignalIds: ["00000000-0000-4000-8000-000000000101"],
      },
    });
    expect(saveState).toHaveBeenCalledWith(db, {
      userId: user.id,
      actionId,
      sourceTopOfMindId: note.id,
      status: "completed",
      outcomeText: "It showed the rough version was enough to start the conversation.",
      relatedSignalIds: ["00000000-0000-4000-8000-000000000101"],
    });
  });

  it("persists POST state for deterministic candidates when the model provider fails or would generate invalid output", async () => {
    const [candidate] = selectActionRecommendationCandidates({
      notes: [note],
      states: [],
      limit: 5,
    });
    expect(candidate).toBeTruthy();

    const cases = [
      {
        status: "removed" as const,
        getModelProvider: vi.fn(async () => {
          throw new Error("Gemini unavailable");
        }),
      },
      {
        status: "completed" as const,
        getModelProvider: vi.fn(async () => ({
          generateActionRecommendation: vi.fn(async () => ({
            text: "think about it",
            kind: "not_a_real_kind",
            whyNow: "",
          })),
        })),
      },
    ];

    for (const testCase of cases) {
      const db = {};
      const saveState = vi.fn(
        async (_db: unknown, input: SaveActionRecommendationStateInput) => ({
          actionId: input.actionId,
          sourceTopOfMindId: input.sourceTopOfMindId,
          status: input.status,
          outcomeText: input.outcomeText ?? null,
          relatedSignalIds: input.relatedSignalIds ?? [],
          updatedAt: new Date("2026-06-01T10:00:00.000Z"),
        }),
      );
      const app = new Hono();
      app.route(
        "/api/action-recommendations",
        createActionRecommendationsRoutes({
          getDatabase: () => db as any,
          authMiddleware: authMiddleware(),
          listTopOfMindNotes: vi.fn(async () => [note]),
          listStates: vi.fn(async () => []),
          saveState,
          getModelProvider: testCase.getModelProvider as any,
        }),
      );

      const response = await app.request(
        `/api/action-recommendations/${candidate.id}/state`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sourceTopOfMindId: note.id,
            status: testCase.status,
          }),
        },
      );

      expect(response.status).toBe(200);
      expect(testCase.getModelProvider).not.toHaveBeenCalled();
      expect(saveState).toHaveBeenCalledWith(db, {
        userId: user.id,
        actionId: candidate.id,
        sourceTopOfMindId: note.id,
        status: testCase.status,
      });
      await expect(response.json()).resolves.toMatchObject({
        actionRecommendationState: {
          actionId: candidate.id,
          sourceTopOfMindId: note.id,
          status: testCase.status,
        },
      });
    }
  });

  it("rejects body action IDs and unknown recommendation IDs before saving state", async () => {
    const saveState = vi.fn();
    const app = new Hono();
    app.route(
      "/api/action-recommendations",
      createActionRecommendationsRoutes({
        getDatabase: () => ({}) as any,
        authMiddleware: authMiddleware(),
        listTopOfMindNotes: vi.fn(async () => [note]),
        listStates: vi.fn(async () => []),
        saveState,
        getModelProvider,
      }),
    );

    const overrideResponse = await app.request(
      "/api/action-recommendations/not-a-real-action/state",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actionId: "attacker-controlled-action",
          sourceTopOfMindId: note.id,
          status: "removed",
        }),
      },
    );

    expect(overrideResponse.status).toBe(400);
    expect(saveState).not.toHaveBeenCalled();

    const unknownResponse = await app.request(
      "/api/action-recommendations/not-a-real-action/state",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceTopOfMindId: note.id,
          status: "removed",
        }),
      },
    );

    expect(unknownResponse.status).toBe(404);
    expect(saveState).not.toHaveBeenCalled();
  });

  it("returns an existing terminal action state idempotently on retry", async () => {
    const db = {};
    const states: ActionRecommendationState[] = [];
    const saveState = vi.fn(
      async (_db: unknown, input: SaveActionRecommendationStateInput) => {
        const state: ActionRecommendationState = {
          actionId: input.actionId,
          sourceTopOfMindId: input.sourceTopOfMindId,
          status: input.status,
          outcomeText: input.outcomeText ?? null,
          relatedSignalIds: input.relatedSignalIds ?? [],
          updatedAt: new Date("2026-06-01T10:00:00.000Z"),
        };
        states.unshift(state);
        return state;
      },
    );
    const app = new Hono();
    app.route(
      "/api/action-recommendations",
      createActionRecommendationsRoutes({
        getDatabase: () => db as any,
        authMiddleware: authMiddleware(),
        listTopOfMindNotes: vi.fn(async () => [note]),
        listStates: vi.fn(async () => states),
        saveState,
        getModelProvider,
      }),
    );

    const [candidate] = selectActionRecommendationCandidates({
      notes: [note],
      states: [],
      limit: 5,
    });
    expect(candidate).toBeTruthy();
    const actionId = candidate.id;

    const payload = {
      sourceTopOfMindId: note.id,
      status: "completed",
      outcomeText: "The rough version started the conversation.",
    };
    const firstResponse = await app.request(
      `/api/action-recommendations/${actionId}/state`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    expect(firstResponse.status).toBe(200);
    expect(saveState).toHaveBeenCalledTimes(1);

    const retryResponse = await app.request(
      `/api/action-recommendations/${actionId}/state`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    expect(retryResponse.status).toBe(200);
    expect(saveState).toHaveBeenCalledTimes(1);
    await expect(retryResponse.json()).resolves.toMatchObject({
      actionRecommendationState: {
        actionId,
        sourceTopOfMindId: note.id,
        status: "completed",
        outcomeText: "The rough version started the conversation.",
      },
    });
  });
});
