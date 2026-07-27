import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import {
  createGroupRoomRoutes,
  type GroupConversationRoomSurface,
  type GroupRoomFeedbackSurface,
  type GroupRoomPromptSurface,
} from "./group-rooms.js";

const user = { id: "00000000-0000-4000-8000-000000000001" };
const roomId = "00000000-0000-4000-8000-000000000101";
const signalId = "00000000-0000-4000-8000-000000000201";
const promptId = "00000000-0000-4000-8000-000000000301";

function authMiddleware() {
  return async (c: any, next: () => Promise<void>) => {
    c.set("user", user);
    await next();
  };
}

const prompt: GroupRoomPromptSurface = {
  id: promptId,
  roomId,
  promptText:
    "Turn this into a discussion: the same inspiration changes with different people",
  rationale:
    "Generated from room-selected signals so the same saved idea can become a different conversation with different people.",
  actionLabel: "Start with conversation",
  sourceTopOfMindNoteId: null,
  evidencePreviews: [{ signalId, textPreview: "same inspiration, different room" }],
  createdAt: "2026-06-29T17:10:00.000Z",
};

const room: GroupConversationRoomSurface = {
  id: roomId,
  ownerUserId: user.id,
  name: "friends x builders",
  status: "active",
  createdAt: "2026-06-29T17:00:00.000Z",
  updatedAt: "2026-06-29T17:10:00.000Z",
  endedAt: null,
  participants: [
    {
      id: "00000000-0000-4000-8000-000000000401",
      userId: user.id,
      displayName: "",
      invitedEmail: null,
      role: "owner",
      status: "active",
    },
  ],
  selectedSignals: [
    {
      id: "00000000-0000-4000-8000-000000000501",
      signalId,
      userId: user.id,
      textPreview: "same inspiration, different room",
      shareRaw: false,
      createdAt: "2026-06-29T17:02:00.000Z",
    },
  ],
  prompts: [prompt],
  postConversation: {
    feedbackCount: 1,
    latestNote: "This should become the next conversation.",
    nextAction: "Turn the unresolved thread into the next discussion topic",
  },
};

describe("GET /api/group-rooms", () => {
  it("lists only rooms scoped to the signed-in participant", async () => {
    const listRooms = vi.fn(async () => [room]);
    const db = {};
    const app = new Hono();
    app.route(
      "/api/group-rooms",
      createGroupRoomRoutes({
        getDatabase: () => db as any,
        listRooms,
        authMiddleware: authMiddleware(),
      }),
    );

    const response = await app.request("/api/group-rooms?limit=3");

    expect(response.status).toBe(200);
    expect(listRooms).toHaveBeenCalledWith(db, { userId: user.id, limit: 3 });
    await expect(response.json()).resolves.toEqual({ rooms: [room] });
  });
});

describe("POST /api/group-rooms", () => {
  it("creates a room with invited participants without requiring heavy setup", async () => {
    const createRoom = vi.fn(async () => room);
    const app = new Hono();
    app.route(
      "/api/group-rooms",
      createGroupRoomRoutes({
        getDatabase: () => ({}) as any,
        createRoom,
        authMiddleware: authMiddleware(),
      }),
    );

    const response = await app.request("/api/group-rooms", {
      method: "POST",
      body: JSON.stringify({
        name: "friends x builders",
        participantEmails: ["friend@example.com"],
      }),
      headers: { "content-type": "application/json" },
    });

    expect(response.status).toBe(201);
    expect(createRoom).toHaveBeenCalledWith(expect.anything(), {
      userId: user.id,
      name: "friends x builders",
      participantEmails: ["friend@example.com"],
    });
  });
});

describe("POST /api/group-rooms/discussion-topic", () => {
  it("turns a Top of Mind note and selected signals into a room-specific prompt", async () => {
    const createDiscussionTopic = vi.fn(async () => ({ room, prompt }));
    const app = new Hono();
    app.route(
      "/api/group-rooms",
      createGroupRoomRoutes({
        getDatabase: () => ({}) as any,
        createDiscussionTopic,
        authMiddleware: authMiddleware(),
      }),
    );

    const response = await app.request("/api/group-rooms/discussion-topic", {
      method: "POST",
      body: JSON.stringify({
        roomId,
        title: "turn this into a discussion topic",
        sourceTopOfMindNoteId: "00000000-0000-4000-8000-000000000601",
        signalIds: [signalId],
      }),
      headers: { "content-type": "application/json" },
    });

    expect(response.status).toBe(201);
    expect(createDiscussionTopic).toHaveBeenCalledWith(expect.anything(), {
      userId: user.id,
      roomId,
      title: "turn this into a discussion topic",
      sourceTopOfMindNoteId: "00000000-0000-4000-8000-000000000601",
      signalIds: [signalId],
    });
    await expect(response.json()).resolves.toEqual({ room, prompt });
  });

  it("returns 404 when the requested room or selected signal is outside the tenant", async () => {
    const createDiscussionTopic = vi.fn(async () => null);
    const app = new Hono();
    app.route(
      "/api/group-rooms",
      createGroupRoomRoutes({
        getDatabase: () => ({}) as any,
        createDiscussionTopic,
        authMiddleware: authMiddleware(),
      }),
    );

    const response = await app.request("/api/group-rooms/discussion-topic", {
      method: "POST",
      body: JSON.stringify({ roomId, title: "private signal", signalIds: [signalId] }),
      headers: { "content-type": "application/json" },
    });

    expect(response.status).toBe(404);
  });
});

describe("POST /api/group-rooms/:roomId/feedback", () => {
  it("creates post-conversation feedback and returns the next action", async () => {
    const feedback: GroupRoomFeedbackSurface = {
      id: "00000000-0000-4000-8000-000000000701",
      roomId,
      promptId,
      reaction: "unresolved",
      note: "This should become the next conversation.",
      createdAt: "2026-06-29T17:30:00.000Z",
    };
    const createFeedback = vi.fn(async () => ({ room, feedback }));
    const app = new Hono();
    app.route(
      "/api/group-rooms",
      createGroupRoomRoutes({
        getDatabase: () => ({}) as any,
        createFeedback,
        authMiddleware: authMiddleware(),
      }),
    );

    const response = await app.request(`/api/group-rooms/${roomId}/feedback`, {
      method: "POST",
      body: JSON.stringify({
        promptId,
        reaction: "unresolved",
        note: "This should become the next conversation.",
      }),
      headers: { "content-type": "application/json" },
    });

    expect(response.status).toBe(201);
    expect(createFeedback).toHaveBeenCalledWith(expect.anything(), {
      userId: user.id,
      roomId,
      promptId,
      reaction: "unresolved",
      note: "This should become the next conversation.",
    });
    await expect(response.json()).resolves.toEqual({ room, feedback });
  });
});
