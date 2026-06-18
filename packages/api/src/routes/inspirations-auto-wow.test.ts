import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return {
    ...actual,
    randomUUID: vi.fn(() => "00000000-0000-4000-8000-000000000002"),
  };
});

vi.mock("../lib/signal-packets.js", () => ({
  persistSignalPacketForSignal: vi.fn(async () => null),
}));

vi.mock("../vault/materialize.js", () => ({
  writeSignalDraftToVault: vi.fn(async () => ({
    id: inspirationId,
    path: "vault/signals/2026-01-01/00000000-0000-4000-8000-000000000002.yaml",
    contentHash: "test-draft-hash",
    docType: "signal",
  })),
  materializeSignalDocument: vi.fn(async () => ({
    id: inspirationId,
    path: "vault/signals/2026-01-01/00000000-0000-4000-8000-000000000002.yaml",
    contentHash: "test-materialized-hash",
    docType: "signal",
  })),
}));

import { createInspirationsRoutes } from "./inspirations.js";

interface CreateInspirationResponse {
  inspiration: { id: string };
  reflections?: Array<{ id: string; question: string; answer: string | null; skipped: boolean }>;
  autoWowGeneration?: { status: string; generated: boolean };
}

const user = { id: "00000000-0000-4000-8000-000000000001" };
const inspirationId = "00000000-0000-4000-8000-000000000002";

function authMiddleware() {
  return async (c: any, next: () => Promise<void>) => {
    c.set("user", user);
    await next();
  };
}

function createInsertDb() {
  const inserted = {
    id: inspirationId,
    userId: user.id,
    text: "automatic wow should not break save",
    kind: "note",
    category: null,
    importanceScore: null,
    wowScore: null,
    cluster: null,
    classifiedAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };
  const insertedReflection = {
    id: "00000000-0000-4000-8000-000000000003",
    inspirationId,
    userId: user.id,
    question: "What did this ask you to protect?",
    answer: "A room for longer experiments.",
    skipped: false,
    createdAt: new Date("2026-01-01T00:00:00.001Z"),
  };
  const valuesCalls: unknown[] = [];
  const returningRows = [[inserted], [], [insertedReflection]];
  let db: any;
  db = {
    insert: vi.fn(() => ({
      values: vi.fn((values: unknown) => {
        const callIndex = valuesCalls.length;
        valuesCalls.push(values);
        return {
          returning: vi.fn(async () => returningRows[callIndex] ?? []),
        };
      }),
    })),
    transaction: vi.fn(async (callback: (tx: any) => Promise<unknown>) => callback(db)),
  };

  return {
    db,
    inserted,
    insertedReflection,
    valuesCalls,
  };
}

describe("POST /api/inspirations automatic WOW generation", () => {
  it("returns 201 without invoking automatic WOW generation inline", async () => {
    const { db } = createInsertDb();
    const app = new Hono();

    app.route(
      "/api/inspirations",
      createInspirationsRoutes({
        getDatabase: () => db,
        authMiddleware: authMiddleware(),
        enqueueClassificationJob: vi.fn(async () => ({ jobId: "00000000-0000-4000-8000-000000000999" })),
        persistScores: vi.fn(async () => ({ importanceScore: 10, wowScore: 20 })),
      }),
    );

    const response = await app.request("/api/inspirations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "automatic wow should not break save", kind: "note" }),
    });

    expect(response.status).toBe(201);
    const body = (await response.json()) as CreateInspirationResponse;
    expect(body.inspiration.id).toBe(inspirationId);
    expect(body.autoWowGeneration).toBeUndefined();
  });

  it("can persist Reflect Deeper Q/A with the inspiration create request", async () => {
    const { db, valuesCalls } = createInsertDb();
    const app = new Hono();

    app.route(
      "/api/inspirations",
      createInspirationsRoutes({
        getDatabase: () => db,
        authMiddleware: authMiddleware(),
        enqueueClassificationJob: vi.fn(async () => ({ jobId: "00000000-0000-4000-8000-000000000999" })),
        persistScores: vi.fn(async () => ({ importanceScore: 10, wowScore: 20 })),
      }),
    );

    const response = await app.request("/api/inspirations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "automatic wow should not break save",
        kind: "note",
        reflections: [
          {
            question: "What did this ask you to protect?",
            answer: "A room for longer experiments.",
            skipped: false,
          },
        ],
      }),
    });

    expect(response.status).toBe(201);
    const body = (await response.json()) as CreateInspirationResponse;
    expect(body.inspiration.id).toBe(inspirationId);
    expect(body.reflections?.[0]).toMatchObject({
      question: "What did this ask you to protect?",
      answer: "A room for longer experiments.",
      skipped: false,
    });
    expect(valuesCalls[2]).toMatchObject([
      {
        inspirationId,
        userId: user.id,
        question: "What did this ask you to protect?",
        answer: "A room for longer experiments.",
        skipped: false,
      },
    ]);
  });
});
