/**
 * POST /api/auth/login, END TO END, AGAINST A STORE THAT REMEMBERS.
 *
 * The unit tests next door pin the policy in isolation. These drive the actual
 * route, because the hole was never in a helper — it was that the handler
 * asked nobody anything before spending a bcrypt compare, and answered 401 as
 * many times as you liked.
 *
 * The fake below is a real store with fake plumbing: `login_failures` rows live
 * in a Map that survives across requests, so "the eleventh attempt is refused"
 * is a fact about accumulated state rather than about a spy. Nothing here
 * touches a database, and no row is invented — every count is one this route
 * put there by failing a login in the test above it.
 */
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { accounts, loginFailures } from "../db/index.js";

process.env.JWT_SECRET ??= "test-login-throttle-route-secret";
/* The per-source budget is off unless a deployment declares its proxy depth,
   and these cases are about the per-address budget. Cleared explicitly so an
   inherited environment cannot quietly change what is being tested. */
delete process.env.WAKA_TRUSTED_PROXY_HOPS;

const dbState = vi.hoisted(() => ({ db: undefined as any }));

vi.mock("../lib/db.js", () => ({
  getDb: () => dbState.db,
}));

vi.mock("../lib/auth.js", () => ({
  SESSION_COOKIE_NAME: "waka_session",
  SESSION_TTL_SECONDS: 60 * 60 * 24 * 30,
  buildSessionClearCookie: () => "waka_session=; Max-Age=0; Path=/",
  buildSessionCookie: () => "waka_session=signed-token; Path=/; HttpOnly",
  hashPassword: vi.fn(async (plaintext: string) => `hashed:${plaintext}`),
  signSessionToken: vi.fn(async () => "signed-token"),
  /* The one stand-in that matters: a hash here is the literal string
     "hashed:<password>", so a case can hold a right answer and a wrong one
     without carrying a bcrypt digest around. */
  verifyPassword: vi.fn(async (plaintext: string, hash: string) => hash === `hashed:${plaintext}`),
  verifySessionToken: vi.fn(async () => null),
  wantsSecureCookie: () => false,
}));

vi.mock("../lib/session.js", () => ({
  createSessionRow: vi.fn(async () => undefined),
  describeUserAgent: () => null,
  revokeSessionByToken: vi.fn(async () => undefined),
  hashSessionToken: vi.fn(async () => "hashed-token"),
}));

/* Signup posts a verification link; that has its own tests and its own table,
   and the fake store below only knows about login_failures. */
vi.mock("../lib/email-verification.js", () => ({
  issueVerification: vi.fn(async () => ({ sent: true, token: null })),
}));

import { IDENTIFIER_FAILURE_BUDGET, LOGIN_DEVICE_COOKIE_NAME } from "../lib/login-throttle.js";
import { authRoutes } from "./auth.js";

function app() {
  const hono = new Hono();
  hono.route("/api/auth", authRoutes);
  return hono;
}

interface AccountFixture {
  email: string;
  password: string;
  row: unknown;
}

function accountFixture(name: string): AccountFixture {
  const email = `${name}@example.com`;
  const password = `${name}-knows-this-one`;
  return {
    email,
    password,
    row: {
      account: { id: `account-${name}`, email, onboardingCompletedAt: null },
      profile: {
        id: `profile-${name}`,
        accountId: `account-${name}`,
        type: "human",
        name,
        avatarUrl: null,
        preferredLocale: "en-US",
        publicHandle: null,
        publicProfileEnabled: false,
        publicTopOfMindEnabled: false,
      },
      passwordHash: `hashed:${password}`,
    },
  };
}

interface BucketRow {
  keyHash: string;
  scope: string;
  failures: number;
  windowStartedAt: Date;
  updatedAt: Date;
}

/**
 * One `login_failures` table plus one account row.
 *
 * The store is passed in rather than created here so two of these can share
 * it: that is how "a flood against one address does not reach another" is
 * expressed — different accounts, same counter table.
 *
 * The select for `login_failures` hands back every row rather than filtering.
 * The caller looks each bucket up by its own key hash, so an unfiltered answer
 * is the same answer a `WHERE key_hash IN (…)` would have given, and the fake
 * does not have to interpret a drizzle condition to stay honest.
 */
function makeDb(
  store: Map<string, BucketRow>,
  account: AccountFixture | null,
  creates?: AccountFixture,
) {
  const db: any = {};

  db.select = () => {
    const chain: any = {};
    chain.from = (table: unknown) => {
      chain.table = table;
      return chain;
    };
    chain.innerJoin = () => chain;
    chain.where = () => {
      if (chain.table === loginFailures) {
        return Promise.resolve([...store.values()]);
      }
      const rows = account ? [account.row] : [];
      const result: any = Promise.resolve(rows);
      result.limit = async () => rows;
      return result;
    };
    return chain;
  };

  db.insert = () => ({
    values: (row: BucketRow) => ({
      onConflictDoUpdate: async () => {
        store.set(row.keyHash, row);
      },
    }),
  });

  db.delete = () => ({ where: async () => undefined });

  /* Signup writes the account and its human profile in one transaction. Only
     the shape matters here — the rows come straight back out as the fixture. */
  db.transaction = async (work: (tx: unknown) => Promise<unknown>) =>
    work({
      insert: (table: unknown) => ({
        values: () => ({
          returning: async () => {
            const row = creates?.row as { account: unknown; profile: unknown } | undefined;
            return [table === accounts ? row?.account : row?.profile];
          },
        }),
      }),
    });

  return db;
}

async function login(
  credentials: { email: string; password: string },
  cookie?: string,
): Promise<Response> {
  return app().request("/api/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(credentials),
  });
}

/** Pull the device credential out of a successful login's Set-Cookie headers. */
function deviceCookie(res: Response): string {
  const header = res.headers.get("set-cookie") ?? "";
  const match = new RegExp(`${LOGIN_DEVICE_COOKIE_NAME}=([^;]+)`).exec(header);
  expect(match).not.toBeNull();
  return `${LOGIN_DEVICE_COOKIE_NAME}=${match![1]}`;
}

let store: Map<string, BucketRow>;
const owner = accountFixture("owner");
const bystander = accountFixture("bystander");

beforeEach(() => {
  store = new Map();
  dbState.db = makeDb(store, owner);
});

describe("guessing a password", () => {
  /**
   * THE REGRESSION.
   *
   * Against the unfixed handler every one of these is a 401 and the loop could
   * run to a million. The number that matters is not 429 in particular — it is
   * that attempt N+1 gets a different answer from attempt N.
   */
  it("stops being answered once the address's budget is spent", async () => {
    for (let attempt = 0; attempt < IDENTIFIER_FAILURE_BUDGET; attempt += 1) {
      const res = await login({ email: owner.email, password: "not-the-password" });
      expect(res.status).toBe(401);
    }

    const refused = await login({ email: owner.email, password: "not-the-password" });

    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  /**
   * A refusal that still checked the password would be worse than no refusal:
   * the attacker would read 429-for-wrong and 200-for-right off the status
   * line and keep going with a free oracle.
   */
  it("refuses an unrecognised browser even when it finally has the right password", async () => {
    for (let attempt = 0; attempt < IDENTIFIER_FAILURE_BUDGET; attempt += 1) {
      await login({ email: owner.email, password: "not-the-password" });
    }

    const res = await login({ email: owner.email, password: owner.password });

    expect(res.status).toBe(429);
  });

  /**
   * The counter is keyed on what was typed, not on what exists. If only real
   * accounts were counted, 429-vs-401 would answer "is this address
   * registered?" — the question /signup's 409 already answers and that this
   * limit exists to make expensive.
   */
  it("counts attempts against an address that has no account here", async () => {
    dbState.db = makeDb(store, null);

    for (let attempt = 0; attempt < IDENTIFIER_FAILURE_BUDGET; attempt += 1) {
      const res = await login({ email: "nobody@example.com", password: "guess" });
      expect(res.status).toBe(401);
    }

    const refused = await login({ email: "nobody@example.com", password: "guess" });

    expect(refused.status).toBe(429);
  });

  it("leaves every other address alone while one is being ground at", async () => {
    for (let attempt = 0; attempt <= IDENTIFIER_FAILURE_BUDGET; attempt += 1) {
      await login({ email: owner.email, password: "not-the-password" });
    }
    expect((await login({ email: owner.email, password: "not-the-password" })).status).toBe(429);

    dbState.db = makeDb(store, bystander);
    const res = await login({ email: bystander.email, password: bystander.password });

    expect(res.status).toBe(200);
  });

  it("forgets the failures a correct password has just disproved", async () => {
    for (let attempt = 0; attempt < IDENTIFIER_FAILURE_BUDGET - 1; attempt += 1) {
      await login({ email: owner.email, password: "not-the-password" });
    }

    expect((await login({ email: owner.email, password: owner.password })).status).toBe(200);

    /* One more fumble would have been the eleventh and refused; after a
       successful login it is the first of a fresh window. */
    const res = await login({ email: owner.email, password: "not-the-password" });
    expect(res.status).toBe(401);
  });
});

describe("the account holder is not the one who pays", () => {
  /**
   * THE PROPERTY THE WHOLE DESIGN IS BUILT AROUND.
   *
   * Someone floods this address with wrong passwords from wherever they like.
   * The person who owns it opens the browser they always use, types the
   * password they have always used, and gets in. If this case ever fails, the
   * fix for brute force has become a way to lock people out of their accounts
   * by knowing their email address — and that is strictly worse than the bug
   * it replaced, because it can be aimed.
   */
  it("lets the owner's own browser in through a flood that has spent the budget", async () => {
    const first = await login({ email: owner.email, password: owner.password });
    expect(first.status).toBe(200);
    const knownBrowser = deviceCookie(first);

    /* The flood, from somewhere that has never signed in as this address. */
    for (let attempt = 0; attempt <= IDENTIFIER_FAILURE_BUDGET * 2; attempt += 1) {
      await login({ email: owner.email, password: "not-the-password" });
    }
    expect((await login({ email: owner.email, password: owner.password })).status).toBe(429);

    const res = await login({ email: owner.email, password: owner.password }, knownBrowser);

    expect(res.status).toBe(200);
  });

  /**
   * The exemption only helps a browser that has one, so a brand-new account
   * must not have to survive its first flood before earning it. Choosing the
   * password at signup is the same proof supplying it at login is.
   */
  it("recognises the browser an account was created from", async () => {
    const newcomer = accountFixture("newcomer");
    dbState.db = makeDb(store, null, newcomer);

    const created = await app().request("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: newcomer.email, password: newcomer.password }),
    });
    expect(created.status).toBe(201);
    const signupBrowser = deviceCookie(created);

    dbState.db = makeDb(store, newcomer);
    for (let attempt = 0; attempt <= IDENTIFIER_FAILURE_BUDGET; attempt += 1) {
      await login({ email: newcomer.email, password: "not-the-password" });
    }
    expect((await login({ email: newcomer.email, password: newcomer.password })).status).toBe(429);

    const res = await login({ email: newcomer.email, password: newcomer.password }, signupBrowser);

    expect(res.status).toBe(200);
  });

  /** The exemption is earned per address, so it cannot be bought elsewhere. */
  it("does not let a credential earned on one address answer for another", async () => {
    const mine = deviceCookie(await login({ email: owner.email, password: owner.password }));

    dbState.db = makeDb(store, bystander);
    for (let attempt = 0; attempt <= IDENTIFIER_FAILURE_BUDGET; attempt += 1) {
      await login({ email: bystander.email, password: "not-the-password" }, mine);
    }

    const res = await login({ email: bystander.email, password: bystander.password }, mine);

    expect(res.status).toBe(429);
  });
});
