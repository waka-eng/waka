import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthenticatedSession } from "../lib/session.js";

// The consent token is an HMAC over the session, callback, and state.
process.env.JWT_SECRET ??= "test-consent-secret";

const HUMAN_SESSION: AuthenticatedSession = {
  sessionId: "session-1",
  account: { id: "account-1", email: "user@example.com" },
  profile: {
    id: "profile-human",
    accountId: "account-1",
    type: "human",
    name: "Mina",
    preferredLocale: "en-US",
  },
};

const AGENT_SESSION: AuthenticatedSession = {
  sessionId: "session-2",
  account: { id: "account-1", email: "user@example.com" },
  profile: {
    id: "profile-agent",
    accountId: "account-1",
    type: "agent",
    name: "Scout",
    preferredLocale: "en-US",
  },
};

const HUMAN_ROW = {
  id: "profile-human",
  accountId: "account-1",
  name: "Mina",
  type: "human" as const,
};
const AGENT_ROW = {
  id: "profile-agent",
  accountId: "account-1",
  name: "Scout",
  type: "agent" as const,
};

const mockState = vi.hoisted(() => ({
  db: undefined as any,
  createSessionRow: vi.fn(async () => undefined),
  signSessionToken: vi.fn(async () => "signed-session-token"),
  session: undefined as any,
  authenticated: true,
}));

vi.mock("../lib/db.js", () => ({
  getDb: () => mockState.db,
}));

vi.mock("../lib/auth.js", () => ({
  SESSION_COOKIE_NAME: "waka_session",
  SESSION_TTL_SECONDS: 60 * 60 * 24 * 30,
  signSessionToken: mockState.signSessionToken,
  verifySessionToken: vi.fn(async () => null),
}));

// hashSessionToken is a pure SHA-256 helper with no I/O — keep the real
// implementation so a code minted by /consent and looked up by /exchange
// hash to the same value. Only createSessionRow (a DB write) is stubbed.
vi.mock("../lib/session.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/session.js")>();
  return {
    ...actual,
    createSessionRow: mockState.createSessionRow,
  };
});

// The access matrix stays real: deciding which profile a credential may be
// minted for is this route's whole job on the consent side.
vi.mock("../lib/middleware.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/middleware.js")>();
  return {
    ...actual,
    requireAuth: async (c: any, next: any) => {
      if (!mockState.authenticated) {
        return c.json({ error: "Authentication required" }, 401);
      }
      c.set("session", mockState.session);
      c.set("sessionToken", "browser-token");
      await next();
    },
  };
});

import { hashSessionToken } from "../lib/session.js";
import { bindableProfiles, cliAuthRoutes } from "./auth-cli.js";

function createApp() {
  const app = new Hono();
  app.route("/api/auth/cli", cliAuthRoutes);
  return app;
}

/**
 * A queue of canned `select` results consumed in call order, plus spies for
 * insert/delete. `.where()` resolves directly and also carries `.limit()` and
 * `.orderBy()`, so one mock serves every query shape in this file.
 */
function makeDb(selectResults: unknown[][] = [], deleteResults: unknown[][] = []) {
  const select = vi.fn(() => {
    const chain: any = {};
    chain.from = vi.fn(() => chain);
    chain.innerJoin = vi.fn(() => chain);
    chain.where = vi.fn(() => {
      const rows = selectResults.shift() ?? [];
      const result: any = Promise.resolve(rows);
      result.limit = vi.fn(async () => rows);
      result.orderBy = vi.fn(async () => rows);
      return result;
    });
    return chain;
  });
  const insertValues = vi.fn(async (_values: unknown) => undefined);
  const insert = vi.fn(() => ({ values: insertValues }));
  // delete().where() is awaitable (for the codes deleted without RETURNING)
  // and also carries .returning() (the single-use exchange claim).
  const deleteWhere = vi.fn(() => {
    const result: any = Promise.resolve(undefined);
    result.returning = vi.fn(async () => deleteResults.shift() ?? []);
    return result;
  });
  const del = vi.fn(() => ({ where: deleteWhere }));
  return { select, insert, insertValues, delete: del, deleteWhere };
}

const CALLBACK = "http://127.0.0.1:5555/callback";

function startUrl(params: Record<string, string>): string {
  const query = new URLSearchParams(params).toString();
  return `/api/auth/cli/start?${query}`;
}

/** Pull the hidden fields out of the rendered consent form. */
function readFormFields(html: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const match of html.matchAll(
    /<input type="hidden" name="([^"]+)" value="([^"]*)"/g,
  )) {
    fields[match[1]!] = match[2]!.replace(/&amp;/g, "&").replace(/&#39;/g, "'");
  }
  return fields;
}

function postConsent(fields: Record<string, string>) {
  return createApp().request("/api/auth/cli/consent", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
    redirect: "manual",
  });
}

beforeEach(() => {
  mockState.createSessionRow.mockClear();
  mockState.signSessionToken.mockClear();
  mockState.authenticated = true;
  mockState.session = HUMAN_SESSION;
  mockState.db = makeDb([]);
});

/**
 * The candidate filter, tested directly, because nothing else can reach it.
 *
 * `bindableProfiles` carries two rules: candidates come from the account
 * rather than the request, and an agent-bound session is narrowed to its own
 * profile by the `write` arm of the access matrix. Both routes now refuse an
 * agent session before the helper runs, so every request-level assertion in
 * this file answers the same whether that second rule is there or not — the
 * test that used to cover it ("offers an agent session only its own
 * profile") could not survive the gate, and replacing the filter body with a
 * bare `return rows;` leaves the whole suite green.
 *
 * That is how a defence decays into a comment. The gate and the filter are
 * separate defences on separate assumptions, so each is asserted separately:
 * the gate by the two route tests below, the filter here.
 */
describe("bindableProfiles", () => {
  it("offers an agent session only its own profile, never the human's", async () => {
    mockState.db = makeDb([[HUMAN_ROW, AGENT_ROW]]);

    const candidates = await bindableProfiles(AGENT_SESSION);

    expect(candidates.map((row) => row.id)).toEqual(["profile-agent"]);
  });

  /**
   * The other half of the same rule: a human session is the account's admin,
   * so narrowing must not catch it.
   *
   * This does not catch a bug the route tests would miss — tightening the
   * filter to "own profile only" already turns two of them red. What it does
   * is pin the rule AT THE HELPER, where it is stated, rather than incidentally
   * through a rendered page two layers up. That distinction earned its place
   * here: the gate added in this commit rejects an agent session before the
   * filter is ever reached, so route-level tests can no longer see the filter
   * at all. A defence nothing fails for is a defence that will be deleted by
   * someone who cannot tell it is load-bearing.
   */
  it("offers a human session every profile the account owns", async () => {
    mockState.db = makeDb([[HUMAN_ROW, AGENT_ROW]]);

    const candidates = await bindableProfiles(HUMAN_SESSION);

    expect(candidates.map((row) => row.id)).toEqual([
      "profile-human",
      "profile-agent",
    ]);
  });
});

describe("GET /api/auth/cli/start", () => {
  it("401s when the browser has no live WAKA session", async () => {
    mockState.authenticated = false;

    const res = await createApp().request(
      startUrl({ callback: CALLBACK, state: "abc" }),
      { redirect: "manual" },
    );

    expect(res.status).toBe(401);
  });

  it("rejects a non-loopback callback", async () => {
    const res = await createApp().request(
      startUrl({ callback: "https://evil.example/callback", state: "abc" }),
      { redirect: "manual" },
    );

    expect(res.status).toBe(400);
    expect(mockState.db.insert).not.toHaveBeenCalled();
  });

  it("rejects a same-origin (non-loopback) callback", async () => {
    const res = await createApp().request(
      startUrl({ callback: "http://waka.example/callback", state: "abc" }),
      { redirect: "manual" },
    );

    expect(res.status).toBe(400);
  });

  it("requires state", async () => {
    const res = await createApp().request(startUrl({ callback: CALLBACK }), {
      redirect: "manual",
    });

    expect(res.status).toBe(400);
  });

  /**
   * The reason the consent page exists. A session cookie is SameSite=Lax,
   * which is sent on exactly this kind of top-level navigation — so if the
   * bare GET still minted, any page able to navigate the browser here while
   * the person was signed in would have handed a live credential to a local
   * port of its choosing, silently.
   */
  it("mints nothing and issues no redirect — it renders a page", async () => {
    const db = makeDb([[HUMAN_ROW, AGENT_ROW]]);
    mockState.db = db;

    const res = await createApp().request(
      startUrl({ callback: CALLBACK, state: "drive-by" }),
      { redirect: "manual" },
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
    expect(db.insert).not.toHaveBeenCalled();

    const html = await res.text();
    expect(html).toContain("<form method=\"post\" action=\"/api/auth/cli/consent\"");
    expect(html).toContain("user@example.com");
  });

  it("offers every profile the session may bind, and preselects the named one", async () => {
    mockState.db = makeDb([[HUMAN_ROW, AGENT_ROW]]);

    const res = await createApp().request(
      startUrl({ callback: CALLBACK, state: "s", profile: "Scout" }),
      { redirect: "manual" },
    );
    const html = await res.text();

    expect(html).toContain('value="profile-human"');
    expect(html).toContain('value="profile-agent"');
    expect(html).toMatch(/value="profile-agent"\s+checked/);
  });

  /**
   * The earlier version of this test asserted the narrower rule — an agent
   * session was served the page, but offered only its own profile. It could
   * not stay in this shape: an agent session does not get a page at all now,
   * so there is no profile list to read the narrowing off. The rule itself is
   * not subsumed, only hidden from here, and it kept its coverage by moving
   * up to the `bindableProfiles` describe rather than by being dropped.
   *
   * `requireAuth` accepts a Bearer token, which is precisely what an agent's
   * CLI credential presents, so this endpoint was reachable by a process with
   * no person in front of it. An agent that can render the consent page is an
   * agent one self-submitted form away from a second 30-day credential.
   *
   * The other half of the gate — that a human session is still served — is
   * not restated here: every other test in this file and the next runs on
   * HUMAN_SESSION and asserts a 200 page or a 302 with a code, so a gate that
   * refused too much would take most of this file down with it.
   */
  it("refuses an agent session outright — no page, no profile list", async () => {
    mockState.session = AGENT_SESSION;
    const db = makeDb([[HUMAN_ROW, AGENT_ROW]]);
    mockState.db = db;

    const res = await createApp().request(
      startUrl({ callback: CALLBACK, state: "s" }),
      { redirect: "manual" },
    );

    expect(res.status).toBe(403);
    const html = await res.text();
    expect(html).not.toContain('value="profile-agent"');
    expect(html).not.toContain('value="profile-human"');
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("escapes a device label rather than reflecting it into the page", async () => {
    mockState.db = makeDb([[HUMAN_ROW]]);

    const res = await createApp().request(
      startUrl({ callback: CALLBACK, state: "s", device: '<script>alert(1)</script>' }),
      { redirect: "manual" },
    );
    const html = await res.text();

    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("POST /api/auth/cli/consent", () => {
  async function renderThenFields(
    overrides: Record<string, string> = {},
    rows: unknown[] = [HUMAN_ROW, AGENT_ROW],
  ) {
    mockState.db = makeDb([rows as unknown[]]);
    const res = await createApp().request(
      startUrl({ callback: CALLBACK, state: "my-state", ...overrides }),
      { redirect: "manual" },
    );
    return readFormFields(await res.text());
  }

  it("mints a one-time code, stores only its hash, and redirects to the callback", async () => {
    const fields = await renderThenFields();
    const db = makeDb([[HUMAN_ROW, AGENT_ROW]]);
    mockState.db = db;

    const res = await postConsent({ ...fields, profileId: "profile-human" });

    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location")!);
    expect(location.origin).toBe("http://127.0.0.1:5555");
    expect(location.searchParams.get("state")).toBe("my-state");

    const code = location.searchParams.get("code");
    expect(code).toBeTruthy();

    expect(db.insertValues).toHaveBeenCalledTimes(1);
    const stored = db.insertValues.mock.calls[0]![0] as {
      profileId: string;
      codeHash: string;
    };
    expect(stored.profileId).toBe("profile-human");
    expect(stored.codeHash).toBe(await hashSessionToken(code!));
    expect(stored.codeHash).not.toBe(code);
  });

  it("binds the code to the chosen profile", async () => {
    const fields = await renderThenFields();
    const db = makeDb([[HUMAN_ROW, AGENT_ROW]]);
    mockState.db = db;

    await postConsent({ ...fields, profileId: "profile-agent" });

    const stored = db.insertValues.mock.calls[0]![0] as { profileId: string };
    expect(stored.profileId).toBe("profile-agent");
  });

  it("refuses without a consent token", async () => {
    const fields = await renderThenFields();
    mockState.db = makeDb([[HUMAN_ROW]]);

    const res = await postConsent({
      ...fields,
      consent: "",
      profileId: "profile-human",
    });

    expect(res.status).toBe(400);
    expect(mockState.db.insert).not.toHaveBeenCalled();
  });

  it("refuses a forged consent token", async () => {
    const fields = await renderThenFields();
    mockState.db = makeDb([[HUMAN_ROW]]);

    const res = await postConsent({
      ...fields,
      consent: `${Date.now() + 60_000}.not-a-real-signature`,
      profileId: "profile-human",
    });

    expect(res.status).toBe(400);
    expect(mockState.db.insert).not.toHaveBeenCalled();
  });

  it("refuses a token minted for a different callback", async () => {
    const fields = await renderThenFields();
    mockState.db = makeDb([[HUMAN_ROW]]);

    const res = await postConsent({
      ...fields,
      callback: "http://127.0.0.1:9999/callback",
      profileId: "profile-human",
    });

    expect(res.status).toBe(400);
    expect(mockState.db.insert).not.toHaveBeenCalled();
  });

  /**
   * Candidates come from the account, so a profile id that is not one of them
   * is not a profile this session may mint for — the request naming it is the
   * only place it appears.
   *
   * This used to be written with an agent session reaching for the human
   * profile. That shape is now refused a step earlier by humanSessionsOnly,
   * which would have made this a test of the gate rather than of the
   * candidate check, so it is written with a session that does get through.
   */
  it("refuses a profile that is not one of the account's", async () => {
    const fields = await renderThenFields();
    mockState.db = makeDb([[HUMAN_ROW, AGENT_ROW]]);

    const res = await postConsent({
      ...fields,
      profileId: "profile-belonging-to-someone-else",
    });

    expect(res.status).toBe(400);
    expect(mockState.db.insert).not.toHaveBeenCalled();
  });

  /**
   * THE WHOLE ATTACK, DRIVEN END TO END WITH NOTHING BUT THE AGENT'S OWN
   * CREDENTIAL.
   *
   * No human is simulated anywhere in this test: the same agent session
   * renders the consent page and submits it. That is what made the finding
   * real rather than theoretical — `requireAuth` accepts a Bearer token, an
   * agent's CLI credential is a Bearer token, and the consent token is an
   * HMAC this route signs for itself, so the agent could collect a valid one
   * from /start and hand it straight back to /consent. Every "a person saw
   * this and pressed Allow" check was satisfied by the agent.
   *
   * The cost is that revocation stops converging. Ending a connection is the
   * account holder's documented remedy for a misbehaving agent (sessions.ts),
   * and it only works if the set of connections shrinks when you end one. A
   * spare token that can mint more means they revoke one and the agent mints
   * two.
   *
   * Asserting `insert` was never called matters as much as the status: the
   * insert IS the minting. A 403 with a row written would be a fix in name.
   */
  it("refuses an agent session walking the flow to mint itself another session", async () => {
    mockState.session = AGENT_SESSION;
    const fields = await renderThenFields({}, [AGENT_ROW]);
    const db = makeDb([[AGENT_ROW]]);
    mockState.db = db;

    const res = await postConsent({ ...fields, profileId: "profile-agent" });

    expect(
      db.insertValues,
      "an agent minted itself a login code with no person in the loop",
    ).not.toHaveBeenCalled();
    expect(res.status).toBe(403);
    expect(res.headers.get("location")).toBeNull();
  });

  it("accepts http://localhost as well as http://127.0.0.1", async () => {
    mockState.db = makeDb([[HUMAN_ROW]]);
    const rendered = await createApp().request(
      startUrl({ callback: "http://localhost:7777/cb", state: "s" }),
      { redirect: "manual" },
    );
    const fields = readFormFields(await rendered.text());
    mockState.db = makeDb([[HUMAN_ROW]]);

    const res = await postConsent({ ...fields, profileId: "profile-human" });

    expect(res.status).toBe(302);
    expect(new URL(res.headers.get("location")!).hostname).toBe("localhost");
  });
});

describe("POST /api/auth/cli/exchange", () => {
  function exchangeRequest(code: string) {
    return createApp().request("/api/auth/cli/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
  }

  it("claims by delete-returning; an unknown code yields no row and mints nothing", async () => {
    mockState.db = makeDb([], [[]]);

    const res = await exchangeRequest("nonexistent-code");

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/invalid or already-used/i);
    // The claim runs (that is the single-use guarantee), but nothing follows it.
    expect(mockState.db.deleteWhere).toHaveBeenCalledTimes(1);
    expect(mockState.signSessionToken).not.toHaveBeenCalled();
    expect(mockState.createSessionRow).not.toHaveBeenCalled();
  });

  it("deletes an expired code (single-use even on failure) and refuses to mint a session", async () => {
    mockState.db = makeDb(
      [],
      [
        [
          {
            id: "code-row-1",
            profileId: "profile-agent",
            deviceLabel: null,
            expiresAt: new Date(Date.now() - 1000),
          },
        ],
      ],
    );

    const res = await exchangeRequest("some-code");

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/expired/i);
    // The row is gone even though it was expired: the claim consumed it.
    expect(mockState.db.deleteWhere).toHaveBeenCalledTimes(1);
    expect(mockState.signSessionToken).not.toHaveBeenCalled();
  });

  it("exchanges a valid code for a session bound to the code's profile", async () => {
    mockState.db = makeDb(
      [[{ id: "profile-agent", email: "user@example.com" }]],
      [
        [
          {
            id: "code-row-2",
            profileId: "profile-agent",
            deviceLabel: "claude-code",
            expiresAt: new Date(Date.now() + 60_000),
          },
        ],
      ],
    );

    const res = await exchangeRequest("valid-code");

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      token: string;
      expiresAt: string;
      user: { email: string };
    };
    expect(body.token).toBe("signed-session-token");
    expect(body.user).toEqual({ email: "user@example.com" });
    expect(Date.parse(body.expiresAt)).toBeGreaterThan(Date.now());
    expect(mockState.db.deleteWhere).toHaveBeenCalledTimes(1);
    expect(mockState.signSessionToken).toHaveBeenCalledWith({
      profileId: "profile-agent",
      email: "user@example.com",
    });
    expect(mockState.createSessionRow).toHaveBeenCalledWith({
      profileId: "profile-agent",
      token: "signed-session-token",
      deviceLabel: "claude-code",
    });
  });

  it("refuses a code whose profile is gone", async () => {
    mockState.db = makeDb(
      [[]],
      [
        [
          {
            id: "code-row-3",
            profileId: "profile-erased",
            deviceLabel: null,
            expiresAt: new Date(Date.now() + 60_000),
          },
        ],
      ],
    );

    const res = await exchangeRequest("valid-code");

    expect(res.status).toBe(400);
    expect(mockState.createSessionRow).not.toHaveBeenCalled();
  });

  it("rejects a code reused a second time", async () => {
    // The first exchange succeeds; the second sees an empty result because
    // the row was already deleted by the first call.
    mockState.db = makeDb(
      [[{ id: "profile-human", email: "user@example.com" }]],
      [
        [
          {
            id: "code-row-4",
            profileId: "profile-human",
            deviceLabel: null,
            expiresAt: new Date(Date.now() + 60_000),
          },
        ],
        [],
      ],
    );

    const first = await exchangeRequest("valid-code");
    expect(first.status).toBe(200);

    const second = await exchangeRequest("valid-code");
    expect(second.status).toBe(400);
    const body = (await second.json()) as { error: string };
    expect(body.error).toMatch(/invalid or already-used/i);
  });
});
