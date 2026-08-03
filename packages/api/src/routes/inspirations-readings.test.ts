/**
 * GET /api/inspirations/:id/readings — route contract.
 *
 * The joins and the membership gate live in `lib/signal-readings.ts`; here we
 * verify the route's own duties: id validation, the owner-or-404 parent check
 * (the anti-enumeration property), and that the lib is called with the
 * authenticated user — never an id the client supplied.
 */

import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import { createInspirationsRoutes } from "./inspirations.js";
import type { SignalReading } from "../lib/signal-readings.js";

const user = { id: "00000000-0000-4000-8000-000000000001" };
const signalId = "00000000-0000-4000-8000-000000000002";

function authMiddleware() {
  return async (c: any, next: () => Promise<void>) => {
    c.set("user", user);
    await next();
  };
}

/**
 * The readings route touches the db directly only for the parent ownership
 * check: `select().from(inspirations).where(...).limit(1)`.
 */
function parentCheckDb(rows: Array<{ id: string }>) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => rows),
        })),
      })),
    })),
  } as any;
}

function mountWith(deps: Parameters<typeof createInspirationsRoutes>[0]) {
  const app = new Hono();
  app.route(
    "/api/inspirations",
    createInspirationsRoutes({ authMiddleware: authMiddleware() as any, ...deps }),
  );
  return app;
}

const aloneReading: SignalReading = {
  context: { scope: "alone" },
  note: {
    id: "00000000-0000-4000-8000-000000000010",
    title: "Tools that make thinking visible",
    kind: "recurrence",
    beliefStatement: "You keep circling tools that make thinking visible.",
    why: "Three saves in two weeks orbit the same instinct.",
    createdAt: "2026-07-01T00:00:00.000Z",
  },
  myRole: { role: "anchor", reason: "The save that started the thread." },
      quote: null,
      quoteSource: null,
  neighbors: [],
};

describe("GET /api/inspirations/:id/readings", () => {
  it("rejects a malformed id with 400 before touching the db", async () => {
    const db = parentCheckDb([]);
    const listSignalReadings = vi.fn();
    const app = mountWith({ getDatabase: () => db, listSignalReadings });

    const response = await app.request("/api/inspirations/not-a-uuid/readings");

    expect(response.status).toBe(400);
    expect(db.select).not.toHaveBeenCalled();
    expect(listSignalReadings).not.toHaveBeenCalled();
  });

  it("returns 404 when the signal does not exist or belongs to someone else", async () => {
    // The parent check is scoped by (id, userId), so a cross-tenant signal and
    // a missing signal are the same empty result — deliberately, so the
    // endpoint cannot be used to probe which ids exist.
    const listSignalReadings = vi.fn();
    const app = mountWith({
      getDatabase: () => parentCheckDb([]),
      listSignalReadings,
    });

    const response = await app.request(`/api/inspirations/${signalId}/readings`);

    expect(response.status).toBe(404);
    expect(listSignalReadings).not.toHaveBeenCalled();
  });

  it("returns the lib's readings for the caller's own signal", async () => {
    const listSignalReadings = vi.fn(async () => [aloneReading]);
    const app = mountWith({
      getDatabase: () => parentCheckDb([{ id: signalId }]),
      listSignalReadings,
    });

    const response = await app.request(`/api/inspirations/${signalId}/readings`);

    expect(response.status).toBe(200);
    // The user id comes from the auth context, never the request.
    expect(listSignalReadings).toHaveBeenCalledWith(expect.anything(), {
      userId: user.id,
      signalId,
    });
    await expect(response.json()).resolves.toEqual({ readings: [aloneReading] });
  });

  it("returns an empty list, not an error, for an uncited signal", async () => {
    // Zero readings is the common case, and the section is simply absent in
    // the UI — the API must treat it as a normal answer.
    const listSignalReadings = vi.fn(async () => []);
    const app = mountWith({
      getDatabase: () => parentCheckDb([{ id: signalId }]),
      listSignalReadings,
    });

    const response = await app.request(`/api/inspirations/${signalId}/readings`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ readings: [] });
  });
});
