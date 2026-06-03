import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import {
  createActionRecommendationsRoutes,
  type SaveActionRecommendationStateInput,
} from "./action-recommendations.js";
import type { TopOfMindNoteSurface } from "./top-of-mind.js";
import type { ActionRecommendationState } from "../lib/action-recommendations.js";

const user = { id: "00000000-0000-4000-8000-000000000001" };

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
  it("returns only active high-confidence recommendations and hides persisted removals", async () => {
    const db = {};
    const states: ActionRecommendationState[] = [];
    const listTopOfMindNotes = vi.fn(async () => [note]);
    const listStates = vi.fn(async () => states);
    const saveState = vi.fn(
      async (_db: unknown, input: SaveActionRecommendationStateInput) => {
        const state = {
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
        listTopOfMindNotes,
        listStates,
        saveState,
      }),
    );

    const firstResponse = await app.request("/api/action-recommendations");
    expect(firstResponse.status).toBe(200);
    const firstBody = (await firstResponse.json()) as {
      actionRecommendations: Array<{
        id: string;
        text: string;
        sourceTopOfMindId: string;
        status: string;
        kind: string;
        evidenceSnippets: string[];
      }>;
    };
    const action = firstBody.actionRecommendations[0];
    expect(action).toMatchObject({
      text: "Make the rough thing first, then show one person before explaining it.",
      sourceTopOfMindId: note.id,
      status: "active",
      kind: "make_artifact",
    });
    expect(action.evidenceSnippets).toEqual([
      "Architecture essay about bridge rhythms in city walks",
    ]);

    const stateResponse = await app.request(
      `/api/action-recommendations/${action.id}/state`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceTopOfMindId: note.id,
          status: "removed",
        }),
      },
    );
    expect(stateResponse.status).toBe(200);
    expect(saveState).toHaveBeenCalledWith(db, {
      userId: user.id,
      actionId: action.id,
      sourceTopOfMindId: note.id,
      status: "removed",
    });

    const secondResponse = await app.request("/api/action-recommendations");
    await expect(secondResponse.json()).resolves.toEqual({
      actionRecommendations: [],
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
      }),
    );

    const listResponse = await app.request("/api/action-recommendations");
    const listBody = (await listResponse.json()) as {
      actionRecommendations: Array<{ id: string }>;
    };
    const actionId = listBody.actionRecommendations[0]?.id;
    expect(actionId).toBeTruthy();

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
      }),
    );

    const listResponse = await app.request("/api/action-recommendations");
    const listBody = (await listResponse.json()) as {
      actionRecommendations: Array<{ id: string }>;
    };
    const actionId = listBody.actionRecommendations[0]?.id;
    expect(actionId).toBeTruthy();

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
