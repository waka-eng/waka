/**
 * TLS, OR NO CONNECTION — FOR EVERY DATABASE BUT THE ONE ON THIS MACHINE.
 *
 * The rule under test used to live in a connection string in an SST secret,
 * which means it was not a rule. `requiredTlsMode` is the same rule written
 * where it can be read and where this file can hold it: the driver's default
 * is `ssl: false`, so a `?sslmode=require` lost in an edit took encryption
 * with it, the app kept working, and the only trace was on the wire.
 *
 * The local exemption gets as many cases as the refusals, because it is the
 * half that has to keep working. Every test in this package and every local
 * dev run connects to a certificate-less Postgres on 127.0.0.1; a rule that
 * broke those is a rule that gets deleted rather than narrowed, and then the
 * remote side is unguarded again.
 *
 * WHAT THIS MOCKS, AND WHY: nothing, and no connection is opened. The subject
 * is a pure decision about a string — the whole reason it was pulled out of
 * `getDb` as its own function is that a decision no test can reach is a
 * decision nobody can rely on.
 */
import { describe, expect, it } from "vitest";

import { requiredTlsMode } from "./db.js";

describe("a database on this machine may be reached without TLS", () => {
  it.each([
    "postgres://waka:waka@127.0.0.1:5432/waka",
    "postgres://waka:waka@localhost:5432/waka",
    "postgres://waka:waka@LOCALHOST:5432/waka_test",
    "postgres://waka:waka@[::1]:5432/waka",
    /* No host at all: the driver resolves this to localhost, so this rule
       must agree with the driver rather than guess. */
    "postgres:///waka",
    /* A unix socket never reaches a network interface. */
    "postgres://%2Fvar%2Frun%2Fpostgresql/waka",
  ])("%s", (url) => {
    expect(requiredTlsMode(url)).toBe(false);
  });

  it("stays exempt even when it says it wants no TLS", () => {
    /* The refusal below is about bytes crossing a network. On loopback there
       are none, so `sslmode=disable` there is honest and must not throw — the
       suite's own URL could acquire it tomorrow. */
    expect(requiredTlsMode("postgres://waka:waka@127.0.0.1:5432/waka?sslmode=disable")).toBe(false);
  });
});

describe("every other database is encrypted or is not reached", () => {
  it("demands TLS of a URL that never mentioned it", () => {
    /* The case that was actually one paste away: a remote URL with no ssl
       parameter at all, which the driver would have connected in cleartext. */
    expect(requiredTlsMode("postgres://waka:pw@db.eu-central-1.aws.neon.tech/waka")).toBe("require");
  });

  it.each(["allow", "prefer", "require"])(
    "treats sslmode=%s as the floor it is — require",
    (mode) => {
      /* `allow` and `prefer` both fall back to cleartext when the server does
         not offer TLS, which is the same hole with a reassuring name. */
      expect(requiredTlsMode(`postgres://waka:pw@db.neon.tech/waka?sslmode=${mode}`)).toBe("require");
    },
  );

  it("leaves a stronger mode alone", () => {
    /* Verifying the chain is more than this demands, and tightening is the
       operator's to do without editing code. */
    expect(requiredTlsMode("postgres://waka:pw@db.neon.tech/waka?sslmode=verify-full")).toBe(
      "verify-full",
    );
  });

  it.each(["sslmode=disable", "ssl=false", "sslmode=disable&application_name=waka"])(
    "refuses outright when the URL asks for cleartext (%s)",
    (query) => {
      /* Overruling this silently would leave the next person debugging "I
         turned TLS off and it is still on" with no answer anywhere. */
      expect(() => requiredTlsMode(`postgres://waka:pw@db.neon.tech/waka?${query}`)).toThrow(
        /disables TLS/,
      );
    },
  );

  it("requires TLS of a string it cannot even parse", () => {
    /* An unreadable connection string is not a reason to relax the rule; the
       driver will complain about the rest far more usefully than we could. */
    expect(requiredTlsMode("not a url at all")).toBe("require");
  });
});
