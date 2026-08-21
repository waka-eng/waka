import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { accounts } from "../db/index.js";

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

vi.mock("../lib/session.js", async (importOriginal) => ({
  // `describeUserAgent` is a pure formatter and the callback now labels the
  // session it mints with it — mocking it away would test a login that no
  // longer exists.
  ...(await importOriginal<typeof import("../lib/session.js")>()),
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

/**
 * A queue of canned `select` results plus recorders for what the callback
 * writes: `setCalls` collects every `update().set()` payload and
 * `insertCalls` every `insert().values()` payload, tagged with its table.
 */
function makeDb(selectResults: unknown[][]) {
  const select = vi.fn(() => {
    const chain: any = {};
    chain.from = vi.fn(() => chain);
    chain.where = vi.fn(() => ({
      limit: vi.fn(async () => selectResults.shift() ?? []),
    }));
    return chain;
  });

  const setCalls: Array<{ table: unknown; values: any }> = [];
  const update = vi.fn((table: unknown) => ({
    set: vi.fn((values: any) => {
      setCalls.push({ table, values });
      const result: any = Promise.resolve(undefined);
      result.where = vi.fn(() => {
        const written: any = Promise.resolve(undefined);
        written.returning = vi.fn(async () => [{ id: "profile-1" }]);
        return written;
      });
      return result;
    }),
  }));

  const insertCalls: Array<{ table: unknown; values: any }> = [];
  const insert = vi.fn((table: unknown) => ({
    values: vi.fn((values: any) => {
      insertCalls.push({ table, values });
      const result: any = Promise.resolve(undefined);
      result.returning = vi.fn(async () =>
        table === accounts
          ? [{ id: "new-account-id", email: values.email }]
          : [{ id: "new-profile-id" }],
      );
      return result;
    }),
  }));

  /* Sessions standing on a credential that is being dropped are deleted, so
     the double has to model a delete and record it — the revocation is the
     security-relevant half of linking, not an incidental write. */
  const deleteCalls: Array<{ table: unknown }> = [];
  const del = vi.fn((table: unknown) => {
    deleteCalls.push({ table });
    return { where: vi.fn(async () => undefined) };
  });

  const db: any = { select, update, insert, delete: del, setCalls, insertCalls, deleteCalls };
  db.transaction = vi.fn(async (work: (tx: typeof db) => Promise<unknown>) => work(db));
  return db;
}

/** bySub miss → byEmail hit → the account's existing human profile. */
function linkableAccountDb(passwordHash: string | null = null) {
  return makeDb([
    [],
    [{ id: "account-1", email: "user@example.com", googleSub: null, passwordHash }],
    [{ id: "profile-1", name: "Existing" }],
  ]);
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
    const db = linkableAccountDb();
    mockState.db = db;
    mockGoogleToken({ email_verified: true });

    const response = await callbackRequest();

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("http://localhost:5173/");
    // google_sub is the account's key; the avatar belongs to the profile.
    expect(db.setCalls[0]!.values).toMatchObject({ googleSub: "google-sub-123" });
    expect(db.setCalls[1]!.values).toMatchObject({
      avatarUrl: "https://example.com/avatar.png",
    });
    expect(response.headers.get("set-cookie")).toContain("waka_session=signed-session-token");
    expect(mockState.createSessionRow).toHaveBeenCalledWith({
      profileId: "profile-1",
      token: "signed-session-token",
      deviceLabel: "Browser",
    });
  });

  it("keeps a name the person already chose instead of overwriting it with Google's", async () => {
    const db = linkableAccountDb();
    mockState.db = db;
    mockGoogleToken({ email_verified: true });

    await callbackRequest();

    expect(db.setCalls[1]!.values).toMatchObject({ name: "Existing" });
  });

  it("creates the account and its human profile together on a first sign-in", async () => {
    const db = makeDb([[], []]);
    mockState.db = db;
    mockGoogleToken({ email_verified: true });

    const response = await callbackRequest();

    expect(response.status).toBe(302);
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(db.insertCalls[0]!.values).toMatchObject({
      email: "user@example.com",
      passwordHash: null,
      googleSub: "google-sub-123",
    });
    expect(db.insertCalls[1]!.values).toMatchObject({
      accountId: "new-account-id",
      type: "human",
      name: "Google User",
    });
    // The session acts as the profile that owns the memory, not the account.
    expect(mockState.createSessionRow).toHaveBeenCalledWith({
      profileId: "new-profile-id",
      token: "signed-session-token",
      deviceLabel: "Browser",
    });
  });

  it("returns an invited user to the in-app join offer after OAuth", async () => {
    mockState.db = linkableAccountDb();
    mockGoogleToken({ email_verified: true });

    const response = await callbackRequest("/?join=ROOM-123");

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "http://localhost:5173/?join=ROOM-123",
    );
  });

  it("rejects a backslash-shaped cross-origin return path", async () => {
    mockState.db = linkableAccountDb();
    mockGoogleToken({ email_verified: true });

    const response = await callbackRequest("/\\evil.example/path");

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("http://localhost:5173/");
  });

  it("refuses to move a link when the email already belongs to another Google account", async () => {
    const db = makeDb([
      [],
      [{ id: "account-1", email: "user@example.com", googleSub: "some-other-sub" }],
    ]);
    mockState.db = db;
    mockGoogleToken({ email_verified: true });

    const response = await callbackRequest();

    expect(response.headers.get("location")).toContain("error=account_conflict");
    expect(db.update).not.toHaveBeenCalled();
    expect(mockState.createSessionRow).not.toHaveBeenCalled();
  });
});

/**
 * ACCOUNT PRE-HIJACKING.
 *
 * Password signup does not verify the address, so anyone can hold an account
 * on someone else's email. When the real owner arrives through Google — which
 * HAS verified it — this route links the two and signs them in. Before this
 * was closed, the squatter's password survived that link, so they kept access
 * to an account that then filled with the victim's inspirations, signals and
 * groups.
 *
 * Google has proven who owns the address. The password holder never did, so
 * the unproven credential is what goes.
 */
describe("linking a Google identity to an account that had a password", () => {
  it("drops the password, because nobody ever proved they owned that address", async () => {
    const db = linkableAccountDb("argon2-hash-of-something");
    mockState.db = db;
    mockGoogleToken({ email_verified: true });

    await callbackRequest();

    expect(
      db.setCalls[0]!.values,
      "the squatter can still sign in with the password they set",
    ).toMatchObject({ googleSub: "google-sub-123", passwordHash: null });
  });

  it("revokes the sessions that credential was already holding open", async () => {
    const db = linkableAccountDb("argon2-hash-of-something");
    mockState.db = db;
    mockGoogleToken({ email_verified: true });

    await callbackRequest();

    expect(
      db.deleteCalls.length,
      "an open session keeps the access that dropping the password removed",
    ).toBeGreaterThan(0);
  });

  it("leaves a Google-only account alone, having no password to drop", async () => {
    const db = linkableAccountDb(null);
    mockState.db = db;
    mockGoogleToken({ email_verified: true });

    await callbackRequest();

    expect(db.setCalls[0]!.values).not.toHaveProperty("passwordHash");
    expect(db.deleteCalls.length, "nothing was at risk, so nobody is signed out").toBe(0);
  });
});
