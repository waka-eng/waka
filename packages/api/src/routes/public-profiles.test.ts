import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import {
  createPublicProfileRoutes,
  type PublicProfileOwner,
} from "./public-profiles.js";
import type { TopOfMindNoteSurface } from "./top-of-mind.js";

const profile: PublicProfileOwner = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "River",
  publicHandle: "q00",
  preferredLocale: "en-US",
  publicTopOfMindEnabled: true,
};

const note: TopOfMindNoteSurface = {
  id: "00000000-0000-4000-8000-000000000010",
  userId: profile.id,
  title: "A room where making is the default temperature.",
  ambitionDimension: "work",
  ambientSignal: "Making keeps appearing as the live edge.",
  matchedEnvironment: "A practical room where the object gets built in public.",
  antiEnvironment: "Commentary loops where the object stays theoretical.",
  evidenceRationale: "Several saved signals point at the same working condition.",
  rejectedAlternativeInterpretation: null,
  type: "pattern",
  body: "Multiple signals keep circling a need for concrete making rooms.",
  prompt: null,
  guidance: null,
  confidence: 82,
  status: "active",
  isPinned: false,
  userFeedbackValue: null,
  relatedSignalIds: ["00000000-0000-4000-8000-000000000101"],
  relatedContextNodeIds: ["00000000-0000-4000-8000-000000000201"],
  createdAt: new Date("2026-06-22T01:00:00.000Z"),
  updatedAt: new Date("2026-06-22T01:10:00.000Z"),
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
      role: "Source signal",
      reason: "This signal shows the working-room pattern.",
      textPreview: "A short public-safe preview.",
      kind: "note",
      createdAt: "2026-06-21T10:00:00.000Z",
      resonanceScore: 64,
    },
  ],
  relatedSignals: [
    {
      id: "00000000-0000-4000-8000-000000000101",
      preview: "A short public-safe preview.",
      kind: "note",
      createdAt: "2026-06-21T10:00:00.000Z",
      resonanceScore: 64,
    },
  ],
};

function appFor(input: {
  getProfileByHandle?: (db: unknown, handle: string) => Promise<PublicProfileOwner | null>;
  listNotes?: () => Promise<TopOfMindNoteSurface[]>;
}) {
  const app = new Hono();
  app.route(
    "/api/public/profiles",
    createPublicProfileRoutes({
      getDatabase: () => ({}) as any,
      getProfileByHandle: input.getProfileByHandle as any,
      listNotes: input.listNotes as any,
    }),
  );
  return app;
}

describe("GET /api/public/profiles/:handle", () => {
  it("returns public top-of-mind notes without private identifiers", async () => {
    const getProfileByHandle = vi.fn(async () => profile);
    const listNotes = vi.fn(async () => [note]);
    const response = await appFor({ getProfileByHandle, listNotes }).request(
      "/api/public/profiles/@Q00?limit=3",
    );

    expect(response.status).toBe(200);
    expect(getProfileByHandle).toHaveBeenCalledWith(expect.anything(), "q00");
    expect(listNotes).toHaveBeenCalledWith(expect.anything(), {
      userId: profile.id,
      limit: 3,
      preferredLocale: "en-US",
      // Nobody is authenticated here, so saves kept private must not be read.
      audience: "public",
    });
    const body = await response.json() as any;
    expect(body.profile).toEqual({
      name: "River",
      handle: "q00",
      preferredLocale: "en-US",
    });
    expect(JSON.stringify(body)).not.toContain(profile.id);
    expect(JSON.stringify(body)).not.toContain("userId");
    expect(JSON.stringify(body)).not.toContain("relatedSignalIds");
    expect(JSON.stringify(body)).not.toContain("relatedContextNodeIds");
    expect(JSON.stringify(body)).not.toContain("wowMomentId");
    expect(JSON.stringify(body)).not.toContain("00000000-0000-4000-8000-000000000101");
    expect(body.topOfMindNotes[0]).toMatchObject({
      title: "A room where making is the default temperature.",
      evidencePreviews: [{ textPreview: "A short public-safe preview." }],
    });
  });

  it("normalizes hyphenated public handles before lookup", async () => {
    const hyphenatedProfile = { ...profile, publicHandle: "river-room" };
    const getProfileByHandle = vi.fn(async () => hyphenatedProfile);
    const response = await appFor({
      getProfileByHandle,
      listNotes: vi.fn(async () => []),
    }).request("/api/public/profiles/@River-Room");

    expect(response.status).toBe(200);
    expect(getProfileByHandle).toHaveBeenCalledWith(expect.anything(), "river-room");
    await expect(response.json()).resolves.toMatchObject({
      profile: { handle: "river-room" },
    });
  });

  it("returns 404 when the public profile is disabled or missing", async () => {
    const response = await appFor({
      getProfileByHandle: vi.fn(async () => null),
      listNotes: vi.fn(async () => [note]),
    }).request("/api/public/profiles/q00");

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Public profile not found",
    });
  });
});
