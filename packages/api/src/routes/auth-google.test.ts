import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  db: undefined as any,
  createSessionRow: vi.fn(async () => undefined),
}));

vi.mock("../lib/google-oauth.js", () => ({
  getGoogleClientId: () => "google-client-id",
  getGoogleClientSecret: () => "google-client-secret",
  getGoogleRedirectUri: () => "http://localhost:8787/api/auth/google/callback",
  getOAuthRedirectOrigin: () => "http://localhost:8787",
}));

vi.mock("../lib/db.js", () => ({
  getDb: () => mockState.db,
}));

vi.mock("../lib/auth.js", () => ({
  buildSessionCookie: (token: string) =>
    `waka_session=${token}; Path=/; HttpOnly; SameSite=Lax`,
  signSessionToken: vi.fn(async () => "signed-session-token"),
}));

vi.mock("../lib/session.js", () => ({
  createSessionRow: mockState.createSessionRow,
}));

import { googleAuthRoutes } from "./auth-google.js";

function createApp() {
  const app = new Hono();
  app.route("/api/auth/google", googleAuthRoutes);
  return app;
}

function makeIdToken(claimOverrides: Record<string, unknown>) {
  const claims = {
    iss: "https://accounts.google.com",
    aud: "google-client-id",
    exp: Math.floor(Date.now() / 1000) + 60,
    sub: "google-sub-123",
    email: "User@Example.COM",
    email_verified: true,
    name: "Google User",
    picture: "https://example.com/avatar.png",
    ...claimOverrides,
  };
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none" })}.${encode(claims)}.signature`;
}

function mockGoogleToken(claimOverrides: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify({ id_token: makeIdToken(claimOverrides) }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
}

function makeDb(selectResults: unknown[][]) {
  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(async () => selectResults.shift() ?? []),
      })),
    })),
  }));
  const updateSet = vi.fn();
  const update = vi.fn(() => ({
    set: updateSet.mockImplementation((values: unknown) => ({
      where: vi.fn(() => ({
        returning: vi.fn(async () => [
          {
            id: "existing-user-id",
            email: "user@example.com",
            name: "Existing User",
          },
        ]),
      })),
      values,
    })),
  }));
  const insert = vi.fn(() => ({
    values: vi.fn(() => ({
      returning: vi.fn(async () => [
        {
          id: "new-user-id",
          email: "user@example.com",
          name: "Google User",
        },
      ]),
    })),
  }));
  return { select, update, updateSet, insert };
}

function callbackRequest(returnToCookie?: string) {
  return createApp().request("/api/auth/google/callback?code=code-123&state=state-123", {
    method: "GET",
    redirect: "manual",
    headers: {
      Cookie: `waka_oauth_state=state-123; waka_oauth_pkce=pkce-verifier${
        returnToCookie ? `; waka_oauth_return_to=${encodeURIComponent(returnToCookie)}` : ""
      }`,
    },
  } as RequestInit);
}

beforeEach(() => {
  vi.restoreAllMocks();
  mockState.createSessionRow.mockClear();
  mockState.db = makeDb([]);
  process.env.PUBLIC_WEB_URL = "http://localhost:5173";
});

describe("Google OAuth callback email verification", () => {
  it("rejects an unverified Google email before linking or creating an account", async () => {
    const db = makeDb([]);
    mockState.db = db;
    mockGoogleToken({ email_verified: false });

    const response = await callbackRequest();

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("/login?error=unverified_email");
    expect(db.select).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
    expect(mockState.createSessionRow).not.toHaveBeenCalled();
  });

  it("links an existing password account when Google supplies a verified email", async () => {
    const db = makeDb([
      [],
      [
        {
          id: "existing-user-id",
          email: "user@example.com",
          name: "Existing User",
          googleSub: null,
        },
      ],
    ]);
    mockState.db = db;
    mockGoogleToken({ email_verified: true });

    const response = await callbackRequest();

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("http://localhost:5173/");
    expect(db.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        googleSub: "google-sub-123",
        avatarUrl: "https://example.com/avatar.png",
      }),
    );
    expect(response.headers.get("set-cookie")).toContain("waka_session=signed-session-token");
    expect(mockState.createSessionRow).toHaveBeenCalledWith({
      userId: "existing-user-id",
      token: "signed-session-token",
    });
  });

  it("returns an invited user to the in-app join offer after OAuth", async () => {
    mockState.db = makeDb([
      [],
      [{ id: "existing-user-id", email: "user@example.com", name: "Existing User" }],
    ]);
    mockGoogleToken({ email_verified: true });

    const response = await callbackRequest("/?join=ROOM-123");

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "http://localhost:5173/?join=ROOM-123",
    );
  });

  it("rejects a backslash-shaped cross-origin return path", async () => {
    mockState.db = makeDb([
      [],
      [{ id: "existing-user-id", email: "user@example.com", name: "Existing User" }],
    ]);
    mockGoogleToken({ email_verified: true });

    const response = await callbackRequest("/\\evil.example/path");

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("http://localhost:5173/");
  });
});
