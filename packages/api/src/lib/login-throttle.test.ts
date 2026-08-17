/**
 * THE LIMIT MUST NOT BE AIMABLE.
 *
 * Login had no limit at all, so anyone could guess a password forever. The
 * obvious repair — lock an address after N failures — hands the attacker a
 * different weapon: fail logins on someone's behalf and they cannot get into
 * their own account. Every case below exists to pin one half of that: the
 * budget really does refuse, AND it refuses the flood rather than the person
 * whose address the flood is aimed at.
 *
 * The case that matters most is "a recognised browser is not refused by the
 * address's spent budget". If that one ever goes green by accident, this file
 * is testing a lockout.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

process.env.JWT_SECRET ??= "test-login-throttle-secret";

import {
  loginFailureDb,
  type LoginFailureRow,
  type LoginFailureStore,
} from "../../test/helpers/login-failure-store.js";
import {
  DEVICE_FAILURE_BUDGET,
  IDENTIFIER_FAILURE_BUDGET,
  judgeLoginThrottle,
  LOGIN_FAILURE_WINDOW_MS,
  type LoginThrottleReading,
  mintLoginDeviceCredential,
  readLoginDeviceCredential,
  readLoginThrottle,
  recordLoginFailure,
  resolveLoginSource,
  SOURCE_FAILURE_BUDGET,
} from "./login-throttle.js";

const NOW = new Date("2026-08-17T12:00:00.000Z");

type Bucket = LoginThrottleReading["buckets"][number];

function bucket(overrides: Partial<Bucket> & Pick<Bucket, "scope">): Bucket {
  const budgets = {
    identifier: IDENTIFIER_FAILURE_BUDGET,
    source: SOURCE_FAILURE_BUDGET,
    device: DEVICE_FAILURE_BUDGET,
  } as const;
  return {
    keyHash: `key-${overrides.scope}`,
    budget: budgets[overrides.scope],
    failures: 0,
    windowStartedAt: NOW,
    ...overrides,
  };
}

function reading(input: {
  buckets: Bucket[];
  recognisedDevice?: boolean;
  now?: Date;
}): LoginThrottleReading {
  return {
    now: input.now ?? NOW,
    buckets: input.buckets,
    recognisedDevice: input.recognisedDevice ?? false,
  };
}

describe("judgeLoginThrottle", () => {
  it("lets an attempt through while every budget it answers to has room", () => {
    const verdict = judgeLoginThrottle(
      reading({
        buckets: [
          bucket({ scope: "identifier", failures: IDENTIFIER_FAILURE_BUDGET - 1 }),
          bucket({ scope: "source", failures: SOURCE_FAILURE_BUDGET - 1 }),
        ],
      }),
    );

    expect(verdict.refused).toBe(false);
    expect(verdict.retryAfterSeconds).toBe(0);
  });

  /** THE REGRESSION. Before this existed, guess number ten thousand was served. */
  it("refuses once the address has spent its budget", () => {
    const verdict = judgeLoginThrottle(
      reading({
        buckets: [bucket({ scope: "identifier", failures: IDENTIFIER_FAILURE_BUDGET })],
      }),
    );

    expect(verdict.refused).toBe(true);
  });

  it("refuses once one source has spent its budget, whatever address it is trying", () => {
    const verdict = judgeLoginThrottle(
      reading({
        buckets: [
          bucket({ scope: "identifier", failures: 0 }),
          bucket({ scope: "source", failures: SOURCE_FAILURE_BUDGET }),
        ],
      }),
    );

    expect(verdict.refused).toBe(true);
  });

  /**
   * THE PROPERTY THIS WHOLE DESIGN EXISTS FOR.
   *
   * An attacker has burned the address's budget and the source's from wherever
   * they are. The account holder arrives on the browser they always use,
   * carrying the credential their last successful login minted. If this ever
   * returns refused, we have shipped a way to lock someone out of their own
   * account by typing their email address at us.
   */
  it("does not refuse a recognised browser because someone else spent the address's budget", () => {
    const verdict = judgeLoginThrottle(
      reading({
        recognisedDevice: true,
        buckets: [
          bucket({ scope: "identifier", failures: IDENTIFIER_FAILURE_BUDGET * 100 }),
          bucket({ scope: "source", failures: SOURCE_FAILURE_BUDGET * 100 }),
          bucket({ scope: "device", failures: 0 }),
        ],
      }),
    );

    expect(verdict.refused).toBe(false);
  });

  it("still refuses a recognised browser that has spent its own budget", () => {
    const verdict = judgeLoginThrottle(
      reading({
        recognisedDevice: true,
        buckets: [
          bucket({ scope: "identifier", failures: 0 }),
          bucket({ scope: "device", failures: DEVICE_FAILURE_BUDGET }),
        ],
      }),
    );

    expect(verdict.refused).toBe(true);
  });

  it("says how long is left of the window that refused, not of a fresh one", () => {
    const openedAt = new Date(NOW.getTime() - 10 * 60 * 1000);
    const verdict = judgeLoginThrottle(
      reading({
        buckets: [
          bucket({
            scope: "identifier",
            failures: IDENTIFIER_FAILURE_BUDGET,
            windowStartedAt: openedAt,
          }),
        ],
      }),
    );

    expect(verdict.retryAfterSeconds).toBe(5 * 60);
  });
});

describe("readLoginThrottle", () => {
  function stubDb(rows: Array<{ keyHash: string; failures: number; windowStartedAt: Date }>) {
    return {
      select: () => ({
        from: () => ({
          where: async () => rows,
        }),
      }),
    } as never;
  }

  it("counts a bucket nobody has touched as empty", async () => {
    const result = await readLoginThrottle(
      stubDb([]),
      { identifier: "someone@example.com", source: null, deviceId: null },
      { now: NOW },
    );

    expect(result.buckets).toHaveLength(1);
    expect(result.buckets[0]!.failures).toBe(0);
    expect(result.recognisedDevice).toBe(false);
  });

  it("discards a window that has already closed rather than inheriting its count", async () => {
    const keyed = await readLoginThrottle(
      stubDb([]),
      { identifier: "someone@example.com", source: null, deviceId: null },
      { now: NOW },
    );
    const keyHash = keyed.buckets[0]!.keyHash;

    const result = await readLoginThrottle(
      stubDb([
        {
          keyHash,
          failures: 500,
          windowStartedAt: new Date(NOW.getTime() - LOGIN_FAILURE_WINDOW_MS - 1),
        },
      ]),
      { identifier: "someone@example.com", source: null, deviceId: null },
      { now: NOW },
    );

    expect(result.buckets[0]!.failures).toBe(0);
    expect(result.buckets[0]!.windowStartedAt).toEqual(NOW);
  });

  it("opens a source bucket only when a source was resolved", async () => {
    const withoutSource = await readLoginThrottle(
      stubDb([]),
      { identifier: "someone@example.com", source: null, deviceId: null },
      { now: NOW },
    );
    const withSource = await readLoginThrottle(
      stubDb([]),
      { identifier: "someone@example.com", source: "203.0.113.7", deviceId: null },
      { now: NOW },
    );

    expect(withoutSource.buckets.map((b) => b.scope)).toEqual(["identifier"]);
    expect(withSource.buckets.map((b) => b.scope)).toEqual(["identifier", "source"]);
  });

  it("keys two addresses to different buckets", async () => {
    const one = await readLoginThrottle(
      stubDb([]),
      { identifier: "one@example.com", source: null, deviceId: null },
      { now: NOW },
    );
    const other = await readLoginThrottle(
      stubDb([]),
      { identifier: "other@example.com", source: null, deviceId: null },
      { now: NOW },
    );

    expect(one.buckets[0]!.keyHash).not.toBe(other.buckets[0]!.keyHash);
    /* And the address itself is nowhere in the stored key. */
    expect(one.buckets[0]!.keyHash).not.toContain("one@example.com");
  });
});

/**
 * WHERE THE COUNT IS WORKED OUT.
 *
 * These are about one property: the number that lands in the row is decided by
 * the store at the moment of the write, not by the caller from something it
 * read earlier. Everything above can be green while this is broken, because
 * arithmetic done in JavaScript is perfectly correct as long as exactly one
 * request is in flight — and a suite that awaits each attempt before firing the
 * next never has more than one.
 *
 * The store these use evaluates the SQL the code actually generates rather than
 * assuming what it meant, so "the count goes up" and "a closed window starts
 * again" are separately falsifiable. See test/helpers/login-failure-store.ts.
 */
describe("recordLoginFailure", () => {
  const ATTEMPT = { identifier: "target@example.com", source: null, deviceId: null };

  function only(store: LoginFailureStore): LoginFailureRow {
    const rows = [...store.values()];
    expect(rows).toHaveLength(1);
    return rows[0]!;
  }

  /**
   * THE REGRESSION.
   *
   * A brute-force is not a queue. Every request in a burst reads the bucket
   * before any of them has finished its password compare, so if the new count
   * is `whatILastRead + 1` they all write the same number and the burst costs
   * one increment. Twenty-five guesses have to cost twenty-five.
   */
  it("charges every attempt that read before any of them had written", async () => {
    const store: LoginFailureStore = new Map();
    const db = loginFailureDb(store) as never;
    const burst = 25;

    /* Each read happens before any write — the gap the bcrypt compare opens,
       with nothing in between to serialise them. */
    const readings = await Promise.all(
      Array.from({ length: burst }, () => readLoginThrottle(db, ATTEMPT, { now: NOW })),
    );
    readings.forEach((reading) => expect(reading.buckets[0]!.failures).toBe(0));

    await Promise.all(readings.map((reading) => recordLoginFailure(db, reading)));

    expect(only(store).failures).toBe(burst);
  });

  it("adds to a window that is still open, and leaves the window where it was", async () => {
    const store: LoginFailureStore = new Map();
    const db = loginFailureDb(store) as never;

    await recordLoginFailure(db, await readLoginThrottle(db, ATTEMPT, { now: NOW }));
    const later = new Date(NOW.getTime() + 60 * 1000);
    await recordLoginFailure(db, await readLoginThrottle(db, ATTEMPT, { now: later }));

    expect(only(store).failures).toBe(2);
    expect(only(store).windowStartedAt).toEqual(NOW);
  });

  /**
   * THE OTHER HALF OF MOVING THE SUM INTO SQL, AND THE EASIER ONE TO LOSE.
   *
   * Once the write no longer takes its value from what JavaScript read, the
   * window reset in `readLoginThrottle` stops governing it. A plain
   * `failures + 1` would then be atomic and permanent: the count would climb
   * past the budget and never come down, and a throttle whose bucket never
   * empties is an account nobody can reach from a new browser again. If this
   * case ever goes red the fix for brute force has become a lockout.
   */
  it("starts a window that has closed again at one instead of adding to it", async () => {
    const store: LoginFailureStore = new Map();
    const db = loginFailureDb(store) as never;

    for (let attempt = 0; attempt < IDENTIFIER_FAILURE_BUDGET; attempt += 1) {
      await recordLoginFailure(db, await readLoginThrottle(db, ATTEMPT, { now: NOW }));
    }
    expect(only(store).failures).toBe(IDENTIFIER_FAILURE_BUDGET);

    const afterTheWindow = new Date(NOW.getTime() + LOGIN_FAILURE_WINDOW_MS + 1000);
    await recordLoginFailure(
      db,
      await readLoginThrottle(db, ATTEMPT, { now: afterTheWindow }),
    );

    expect(only(store).failures).toBe(1);
    expect(only(store).windowStartedAt).toEqual(afterTheWindow);
    /* And the bucket is spendable again, which is the point of the reset. */
    expect(
      judgeLoginThrottle(await readLoginThrottle(db, ATTEMPT, { now: afterTheWindow })).refused,
    ).toBe(false);
  });

  it("charges each scope its own attempt rather than sharing one count", async () => {
    const store: LoginFailureStore = new Map();
    const db = loginFailureDb(store) as never;

    await recordLoginFailure(
      db,
      await readLoginThrottle(
        db,
        { identifier: "target@example.com", source: "203.0.113.7", deviceId: null },
        { now: NOW },
      ),
    );

    const scopes = [...store.values()].map((row) => ({ scope: row.scope, failures: row.failures }));
    expect(scopes).toEqual([
      { scope: "identifier", failures: 1 },
      { scope: "source", failures: 1 },
    ]);
  });
});

describe("the device credential", () => {
  it("reads back the browser it was minted for", () => {
    const minted = mintLoginDeviceCredential("owner@example.com", { now: NOW });

    expect(readLoginDeviceCredential(minted, "owner@example.com", { now: NOW })).toBeTruthy();
  });

  /** Otherwise anyone with any account here could mint their own exemption. */
  it("is worthless against a different address", () => {
    const minted = mintLoginDeviceCredential("owner@example.com", { now: NOW });

    expect(readLoginDeviceCredential(minted, "victim@example.com", { now: NOW })).toBeNull();
  });

  it("refuses a forged signature", () => {
    const minted = mintLoginDeviceCredential("owner@example.com", { now: NOW });
    const [deviceId, expiresAt] = minted.split(".");
    const forged = `${deviceId}.${expiresAt}.${"0".repeat(64)}`;

    expect(readLoginDeviceCredential(forged, "owner@example.com", { now: NOW })).toBeNull();
  });

  it("refuses a credential whose stated expiry has passed", () => {
    const minted = mintLoginDeviceCredential("owner@example.com", { now: NOW });
    const later = new Date(NOW.getTime() + 400 * 24 * 60 * 60 * 1000);

    expect(readLoginDeviceCredential(minted, "owner@example.com", { now: later })).toBeNull();
  });

  it("refuses a caller who moved the expiry out, since the signature covers it", () => {
    const minted = mintLoginDeviceCredential("owner@example.com", { now: NOW });
    const [deviceId, , signature] = minted.split(".");
    const stretched = `${deviceId}.${NOW.getTime() + 10 ** 12}.${signature}`;

    expect(readLoginDeviceCredential(stretched, "owner@example.com", { now: NOW })).toBeNull();
  });

  it("treats nonsense and absence the same way", () => {
    expect(readLoginDeviceCredential(undefined, "owner@example.com", { now: NOW })).toBeNull();
    expect(readLoginDeviceCredential("", "owner@example.com", { now: NOW })).toBeNull();
    expect(readLoginDeviceCredential("not-a-credential", "owner@example.com", { now: NOW })).toBeNull();
  });
});

describe("resolveLoginSource", () => {
  const original = process.env.WAKA_TRUSTED_PROXY_HOPS;

  beforeEach(() => {
    delete process.env.WAKA_TRUSTED_PROXY_HOPS;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.WAKA_TRUSTED_PROXY_HOPS;
    else process.env.WAKA_TRUSTED_PROXY_HOPS = original;
  });

  /**
   * The deployed API sits behind a CloudFront Router, so the address the
   * platform attests is the edge's — shared by everybody. Counting failures
   * against it would throttle the product rather than an attacker, so an
   * undeclared topology must produce no source at all.
   */
  it("declines to guess when nobody has declared the topology", () => {
    expect(
      resolveLoginSource({ attestedAddress: "198.51.100.10", forwardedFor: null }),
    ).toBeNull();
  });

  /** And it must not fall back to a header the caller can write. */
  it("ignores X-Forwarded-For entirely while the topology is undeclared", () => {
    expect(
      resolveLoginSource({
        attestedAddress: null,
        forwardedFor: "203.0.113.9",
      }),
    ).toBeNull();
  });

  it("uses the attested address when the deployment says it is the front door", () => {
    process.env.WAKA_TRUSTED_PROXY_HOPS = "0";

    expect(
      resolveLoginSource({
        attestedAddress: "198.51.100.10",
        forwardedFor: "1.1.1.1",
      }),
    ).toBe("198.51.100.10");
  });

  it("takes the entry the nearest trusted proxy appended, not the one a caller sent", () => {
    process.env.WAKA_TRUSTED_PROXY_HOPS = "1";

    expect(
      resolveLoginSource({
        attestedAddress: "198.51.100.10",
        forwardedFor: "9.9.9.9, 203.0.113.9",
      }),
    ).toBe("203.0.113.9");
  });

  it("declines when the chain is shorter than the hops we claim to have", () => {
    process.env.WAKA_TRUSTED_PROXY_HOPS = "2";

    expect(
      resolveLoginSource({ attestedAddress: "198.51.100.10", forwardedFor: "203.0.113.9" }),
    ).toBeNull();
  });

  /* A typo must not quietly become "trust the edge address", which would put
     every caller of the product in one bucket. */
  it("treats an unreadable setting as undeclared rather than as zero", () => {
    process.env.WAKA_TRUSTED_PROXY_HOPS = "yes please";

    expect(
      resolveLoginSource({ attestedAddress: "198.51.100.10", forwardedFor: null }),
    ).toBeNull();
  });
});
