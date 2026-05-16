import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import { createWowStatusRoutes } from "./wow-status.js";

const user = { id: "00000000-0000-4000-8000-000000000001" };

function authMiddleware() {
  return async (c: any, next: () => Promise<void>) => {
    c.set("user", user);
    await next();
  };
}

function createLimitedSelect<T>(terminal: T) {
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

function createWhereSelect<T>(terminal: T) {
  return {
    from: vi.fn(() => ({
      where: vi.fn(async () => terminal),
    })),
  };
}

function createJoinedSelect<T>(terminal: T) {
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

describe("GET /api/wow-status", () => {
  it("returns tenant-scoped inspiration pipeline rows with redacted job errors", async () => {
    const recentInspirations = [
      {
        id: "insp-1",
        text: "  Long bridge note\nwith extra whitespace that should become a compact preview.  ",
        kind: "note",
        category: null,
        cluster: "bridge",
        classifiedAt: new Date("2026-05-10T12:05:00.000Z"),
        importanceScore: 7,
        wowScore: 4,
        createdAt: new Date("2026-05-10T12:00:00.000Z"),
        updatedAt: new Date("2026-05-10T12:05:00.000Z"),
      },
    ];
    const jobs = [
      {
        id: "job-1",
        userId: user.id,
        type: "process_inspiration",
        status: "failed",
        payload: { inspirationId: "insp-1" },
        attempts: 2,
        maxAttempts: 3,
        lastError: "provider secret stack trace",
        createdAt: new Date("2026-05-10T12:01:00.000Z"),
        updatedAt: new Date("2026-05-10T12:04:00.000Z"),
      },
    ];
    const embeddedRows = [{ inspirationId: "insp-1" }];
    const linkedRows = [
      { inspirationId: "insp-1", wowMomentId: "wow-1", title: "Cities keep teaching through bridges" },
      { inspirationId: "insp-1", wowMomentId: "wow-2", title: "Walks reveal hidden structure" },
    ];

    const recentSelect = createLimitedSelect(recentInspirations);
    const jobsSelect = createLimitedSelect(jobs);
    const db = {
      select: vi
        .fn()
        .mockReturnValueOnce(recentSelect.builder)
        .mockReturnValueOnce(jobsSelect.builder)
        .mockReturnValueOnce(createWhereSelect(embeddedRows))
        .mockReturnValueOnce(createJoinedSelect(linkedRows)),
    };
    const app = new Hono();
    app.route(
      "/api/wow-status",
      createWowStatusRoutes({ getDatabase: () => db as any, authMiddleware: authMiddleware() }),
    );

    const response = await app.request("/api/wow-status?limit=1");

    expect(response.status).toBe(200);
    expect(recentSelect.limit).toHaveBeenCalledWith(1);
    const body = await response.json();
    expect(body).toEqual({
      rows: [
        {
          inspiration: {
            id: "insp-1",
            textPreview: "Long bridge note with extra whitespace that should become a compact preview.",
            kind: "note",
            category: null,
            cluster: "bridge",
            classifiedAt: "2026-05-10T12:05:00.000Z",
            importanceScore: 7,
            wowScore: 4,
            createdAt: "2026-05-10T12:00:00.000Z",
            updatedAt: "2026-05-10T12:05:00.000Z",
          },
          job: {
            id: "job-1",
            status: "failed",
            attempts: 2,
            maxAttempts: 3,
            updatedAt: "2026-05-10T12:04:00.000Z",
            lastError: "redacted",
          },
          embedded: true,
          linkedWowMomentCount: 2,
          linkedWowMomentTitles: [
            "Cities keep teaching through bridges",
            "Walks reveal hidden structure",
          ],
        },
      ],
    });
  });

  it("returns an empty row set without running status joins when there are no inspirations", async () => {
    const recentSelect = createLimitedSelect([]);
    const db = { select: vi.fn().mockReturnValueOnce(recentSelect.builder) };
    const app = new Hono();
    app.route(
      "/api/wow-status",
      createWowStatusRoutes({ getDatabase: () => db as any, authMiddleware: authMiddleware() }),
    );

    const response = await app.request("/api/wow-status");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ rows: [] });
    expect(db.select).toHaveBeenCalledTimes(1);
  });
});
