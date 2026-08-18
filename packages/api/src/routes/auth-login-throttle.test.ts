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

/**
 * How long the stand-in password compare takes.
 *
 * Zero for every case that guesses one password at a time. The parallel cases
 * set it, because the read-to-write gap they are about is exactly the length of
 * a bcrypt compare: with a real cost in the middle, a burst of requests is
 * provably all past the throttle's read and none of them past its write at the
 * same instant, which is what a brute-force looks like and what a serial suite
 * can never produce.
 */
const compare = vi.hoisted(() => ({ delayMs: 0 }));

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
  verifyPassword: vi.fn(async (plaintext: string, hash: string) => {
    if (compare.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, compare.delayMs));
    }
    return hash === `hashed:${plaintext}`;
  }),
  verifySessionToken: vi.fn(async () => null),
  wantsSecureCookie: () => false,
}));

vi.mock("../lib/session.js", () => ({
  createSessionRow: vi.fn(async () => undefined),
  describeUserAgent: () => null,
  revokeSessionByToken: vi.fn(async () => undefined),
  hashSessionToken: vi.fn(async () => "hashed-token"),
}));

import {
  applyLoginFailureUpsert,
  type LoginFailureRow,
  type LoginFailureStore,
} from "../../test/helpers/login-failure-store.js";
import {
  DEVICE_FAILURE_BUDGET,
  IDENTIFIER_FAILURE_BUDGET,
  LOGIN_DEVICE_COOKIE_NAME,
  LOGIN_FAILURE_WINDOW_MS,
} from "../lib/login-throttle.js";
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
 *
 * The upsert is NOT `store.set(row.keyHash, row)`, which is what it used to be.
 * That stored whatever the caller had worked out, so a burst of requests all
 * wrote the same number and the parallel cases below could not fail. The shared
 * store applies the `SET` clause the way Postgres does — see
 * test/helpers/login-failure-store.ts for why it evaluates the generated SQL
 * rather than assuming what it was for.
 */
function makeDb(
  store: LoginFailureStore,
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
    values: (row: Record<string, unknown>) => ({
      onConflictDoUpdate: async (config: { set: Record<string, unknown> }) => {
        applyLoginFailureUpsert(store, row, config.set);
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

let store: LoginFailureStore;
const owner = accountFixture("owner");
const bystander = accountFixture("bystander");

beforeEach(() => {
  store = new Map();
  compare.delayMs = 0;
  dbState.db = makeDb(store, owner);
});

/** What the table says one scope has been charged, with no row invented. */
function counted(scope: string): number {
  const rows = [...store.values()].filter((row: LoginFailureRow) => row.scope === scope);
  expect(rows).toHaveLength(1);
  return rows[0]!.failures;
}

/** Fire `count` wrong passwords with nothing awaited between them. */
async function burst(count: number, cookie?: string): Promise<Response[]> {
  compare.delayMs = 5;
  try {
    return await Promise.all(
      Array.from({ length: count }, () =>
        login({ email: owner.email, password: "not-the-password" }, cookie),
      ),
    );
  } finally {
    compare.delayMs = 0;
  }
}

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

/**
 * GUESSING IN PARALLEL, WHICH IS THE ONLY WAY ANYONE GUESSES.
 *
 * Every case above waits for each answer before sending the next request. No
 * attacker does that: they open as many connections as they can and let the
 * server sort it out. The first version of this throttle counted correctly
 * under the first pattern and lost almost everything under the second — fifty
 * simultaneous wrong passwords were recorded as one — because the new count was
 * worked out from a read taken before the password compare, and every request
 * inside that compare read the same thing and wrote the same thing back.
 *
 * A serial suite cannot see that, so these exist. They are the reason the
 * counter is now incremented by Postgres inside the write.
 */
describe("guessing in parallel", () => {
  /**
   * THE REGRESSION.
   *
   * The count in the table has to equal the number of guesses that were
   * actually answered, and the next guess after the burst has to meet a budget
   * that knows about all of them. Before the fix: fifty guesses, one recorded,
   * and guess fifty-one answered like the first — a limit an attacker skips
   * simply by not waiting.
   */
  it("charges every guess in a burst, not just the first one to finish", async () => {
    const size = IDENTIFIER_FAILURE_BUDGET * 5;

    const answers = await burst(size);

    expect(counted("identifier")).toBe(size);
    expect((await login({ email: owner.email, password: "not-the-password" })).status).toBe(429);
    /*
     * And what the burst DID get, said plainly rather than left for someone to
     * discover: all of it was answered. The refusal is decided from a count
     * read before the compare, so requests already in flight when the budget
     * runs out are still checked. That overshoot is bounded by how many
     * connections an attacker can hold open at once — see the note on
     * recordLoginFailure for why paying that is cheaper than the alternatives.
     * What it must not do is repeat, which is the assertion above and the one
     * below.
     */
    expect(answers.map((res) => res.status)).toEqual(Array.from({ length: size }, () => 401));
  });

  /** The wave is not free the second time: the count it left behind refuses it. */
  it("refuses the next burst outright instead of letting waves repeat", async () => {
    await burst(IDENTIFIER_FAILURE_BUDGET * 5);
    const spent = counted("identifier");

    const answers = await burst(IDENTIFIER_FAILURE_BUDGET * 5);

    expect(answers.every((res) => res.status === 429)).toBe(true);
    /* Refused before the password check, so a refusal costs the counter
       nothing either — otherwise the window would renew itself forever. */
    expect(counted("identifier")).toBe(spent);
  });

  /**
   * The window still has to end. A count that only ever climbs is atomic and
   * permanently over budget, which is the lockout this whole file is arranged
   * to prevent — so it is checked here, through the route, and not only against
   * the helper in the unit suite.
   */
  it("lets a burst's window close rather than counting forever", async () => {
    await burst(IDENTIFIER_FAILURE_BUDGET * 5);
    expect((await login({ email: owner.email, password: "not-the-password" })).status).toBe(429);

    /* The rows carry the only clock the throttle reads, so moving them back is
       the same instant arriving fifteen minutes later. */
    for (const row of store.values()) {
      row.windowStartedAt = new Date(row.windowStartedAt.getTime() - LOGIN_FAILURE_WINDOW_MS - 1000);
    }

    const res = await login({ email: owner.email, password: "not-the-password" });

    expect(res.status).toBe(401);
    expect(counted("identifier")).toBe(1);
    /* The one that matters to a person: the address is reachable again. A
       counter that survived the window would answer this 429 and every one
       after it, forever, from an unrecognised browser. */
    expect((await login({ email: owner.email, password: owner.password })).status).toBe(200);
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

  /**
   * THE SAME PROPERTY, AGAINST THE FLOOD AS IT IS ACTUALLY DELIVERED.
   *
   * Making the counter atomic made every parallel guess land, which is the
   * point — but it also means a burst spends the address's budget far faster
   * than a serial loop ever did. So the question the whole design answers has
   * to be asked again at that speed: does the person who owns the address still
   * get in? They must, and for the same reason as before — their browser
   * carries a credential the flood cannot mint, and it answers to its own
   * bucket, which the flood never touches.
   */
  it("lets the owner's own browser in through a flood delivered all at once", async () => {
    const knownBrowser = deviceCookie(await login({ email: owner.email, password: owner.password }));

    await burst(IDENTIFIER_FAILURE_BUDGET * 5);

    expect(counted("identifier")).toBe(IDENTIFIER_FAILURE_BUDGET * 5);
    expect((await login({ email: owner.email, password: owner.password })).status).toBe(429);
    expect(
      (await login({ email: owner.email, password: owner.password }, knownBrowser)).status,
    ).toBe(200);
  });

  /**
   * And the exemption is not a hole the burst can widen: a stolen credential
   * gets its own budget, at the same speed, and spends it.
   */
  it("charges a recognised browser's own bucket for every parallel guess it makes", async () => {
    const knownBrowser = deviceCookie(await login({ email: owner.email, password: owner.password }));

    await burst(DEVICE_FAILURE_BUDGET * 3, knownBrowser);

    expect(counted("device")).toBe(DEVICE_FAILURE_BUDGET * 3);
    expect(
      (await login({ email: owner.email, password: owner.password }, knownBrowser)).status,
    ).toBe(429);
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
