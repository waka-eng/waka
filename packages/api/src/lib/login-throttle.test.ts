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
  DEVICE_FAILURE_BUDGET,
  IDENTIFIER_FAILURE_BUDGET,
  judgeLoginThrottle,
  LOGIN_FAILURE_WINDOW_MS,
  type LoginThrottleReading,
  mintLoginDeviceCredential,
  readLoginDeviceCredential,
  readLoginThrottle,
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
