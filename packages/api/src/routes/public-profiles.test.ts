import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import {
  createPublicProfileRoutes,
  type PublicProfileOwner,
  type PublicTopOfMind,
} from "./public-profiles.js";

const owner: PublicProfileOwner = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "River",
  publicHandle: "q00",
  preferredLocale: "en-US",
  publicTopOfMindEnabled: true,
};

const topOfMind: PublicTopOfMind = {
  version: 3,
  publishedAt: "2026-06-22T01:00:00.000Z",
  entries: [
    {
      type: "pattern",
      body: "Making keeps appearing as the live edge.",
      belief: "The object gets built in public or not at all.",
      prompt: null,
      pinned: true,
    },
    {
      type: "question",
      body: "What would a practical room actually look like?",
      belief: null,
      prompt: "Name one room that already works.",
      pinned: false,
    },
  ],
};

function appFor(input: {
  getProfileByHandle?: (db: unknown, handle: string) => Promise<PublicProfileOwner | null>;
  getTopOfMind?: (
    db: unknown,
    args: { profileId: string; limit: number },
  ) => Promise<PublicTopOfMind | null>;
}) {
  const app = new Hono();
  app.route(
    "/api/public/profiles",
    createPublicProfileRoutes({
      getDatabase: () => ({}) as any,
      getProfileByHandle: input.getProfileByHandle as any,
      getTopOfMind: input.getTopOfMind as any,
    }),
  );
  return app;
}

describe("GET /api/public/profiles/:handle", () => {
  it("returns the live top of mind without any private identifier", async () => {
    const getProfileByHandle = vi.fn(async () => owner);
    const getTopOfMind = vi.fn(async () => topOfMind);

    const response = await appFor({ getProfileByHandle, getTopOfMind }).request(
      "/api/public/profiles/@Q00?limit=3",
    );

    expect(response.status).toBe(200);
    expect(getProfileByHandle).toHaveBeenCalledWith(expect.anything(), "q00");
    expect(getTopOfMind).toHaveBeenCalledWith(expect.anything(), {
      profileId: owner.id,
      limit: 3,
    });

    const body = (await response.json()) as any;
    expect(body.profile).toEqual({
      name: "River",
      handle: "q00",
      preferredLocale: "en-US",
    });
    expect(body.topOfMind.version).toBe(3);
    expect(body.topOfMind.entries[0]).toMatchObject({
      type: "pattern",
      body: "Making keeps appearing as the live edge.",
      pinned: true,
    });

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(owner.id);
    expect(serialized).not.toContain("profileId");
    expect(serialized).not.toContain("signal");
    expect(serialized).not.toContain("inspiration");
  });

  it("normalizes hyphenated public handles before lookup", async () => {
    const hyphenated = { ...owner, publicHandle: "river-room" };
    const getProfileByHandle = vi.fn(async () => hyphenated);

    const response = await appFor({
      getProfileByHandle,
      getTopOfMind: vi.fn(async () => null),
    }).request("/api/public/profiles/@River-Room");

    expect(response.status).toBe(200);
    expect(getProfileByHandle).toHaveBeenCalledWith(expect.anything(), "river-room");
    await expect(response.json()).resolves.toMatchObject({
      profile: { handle: "river-room" },
      topOfMind: null,
    });
  });

  it("never reads the artifact when the owner has not published it", async () => {
    const getTopOfMind = vi.fn(async () => topOfMind);

    const response = await appFor({
      getProfileByHandle: vi.fn(async () => ({ ...owner, publicTopOfMindEnabled: false })),
      getTopOfMind,
    }).request("/api/public/profiles/q00");

    expect(response.status).toBe(200);
    expect(getTopOfMind).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      profile: { name: "River" },
      topOfMind: null,
    });
  });

  it("returns 404 when the public profile is disabled or missing", async () => {
    const response = await appFor({
      getProfileByHandle: vi.fn(async () => null),
      getTopOfMind: vi.fn(async () => topOfMind),
    }).request("/api/public/profiles/q00");

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Public profile not found",
    });
  });

  it("answers a handle that could never exist without touching the database", async () => {
    const getProfileByHandle = vi.fn(async () => owner);

    const response = await appFor({
      getProfileByHandle,
      getTopOfMind: vi.fn(async () => null),
    }).request("/api/public/profiles/me");

    expect(response.status).toBe(404);
    expect(getProfileByHandle).not.toHaveBeenCalled();
  });

  it("rejects an out-of-range limit", async () => {
    const response = await appFor({
      getProfileByHandle: vi.fn(async () => owner),
      getTopOfMind: vi.fn(async () => topOfMind),
    }).request("/api/public/profiles/q00?limit=99");

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Invalid public profile query",
      details: { limit: expect.any(Array) },
    });
  });
});
