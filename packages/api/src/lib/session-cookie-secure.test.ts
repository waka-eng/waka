/**
 * THE SESSION COOKIE FAILS CLOSED.
 *
 * This was `NODE_ENV === "production"`, which reads as safe and is not. AWS
 * Lambda's Node runtime does not set NODE_ENV, and sst.config.ts never put it
 * in the function's environment — so the deployed API sent its session cookie
 * WITHOUT Secure. Served over HTTPS, so not yet intercepted, but one downgrade
 * or one mixed-content request from handing a session to a network observer.
 *
 * The defect was the DIRECTION of the default. A security attribute gated on a
 * variable that must be PRESENT fails open the moment it is absent: a typo, a
 * new stage, a runtime that populates its environment differently. So the
 * cases below fix the direction rather than the variable — an unrecognised
 * environment must produce a MORE secure cookie, not a less secure one.
 */
import { afterEach, describe, expect, it } from "vitest";

import { buildSessionCookie } from "./auth.js";

const original = process.env.NODE_ENV;
const originalEscape = process.env.WAKA_INSECURE_COOKIES;

afterEach(() => {
  if (original === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = original;
  if (originalEscape === undefined) delete process.env.WAKA_INSECURE_COOKIES;
  else process.env.WAKA_INSECURE_COOKIES = originalEscape;
});

describe("buildSessionCookie", () => {
  /** THE REGRESSION. Before the fix this returned a cookie with no Secure. */
  it("is Secure when NODE_ENV is unset, which is what Lambda actually gives us", () => {
    delete process.env.NODE_ENV;
    delete process.env.WAKA_INSECURE_COOKIES;

    expect(buildSessionCookie("token")).toContain("Secure");
  });

  it("is Secure under an environment nobody anticipated", () => {
    process.env.NODE_ENV = "staging";
    delete process.env.WAKA_INSECURE_COOKIES;

    expect(buildSessionCookie("token")).toContain("Secure");
  });

  it("is Secure in production", () => {
    process.env.NODE_ENV = "production";

    expect(buildSessionCookie("token")).toContain("Secure");
  });

  /* The two environments that serve localhost over plain http, named one at a
     time so adding a third is a deliberate act rather than a widening. */
  it("drops Secure for the local http flows, and only those", () => {
    process.env.NODE_ENV = "development";
    expect(buildSessionCookie("token")).not.toContain("Secure");
    process.env.NODE_ENV = "test";
    expect(buildSessionCookie("token")).not.toContain("Secure");
  });

  it("drops Secure when a dev server says so out loud", () => {
    process.env.NODE_ENV = "production";
    process.env.WAKA_INSECURE_COOKIES = "1";

    expect(buildSessionCookie("token")).not.toContain("Secure");
  });

  it("keeps the attributes that were already right", () => {
    delete process.env.NODE_ENV;
    const cookie = buildSessionCookie("token");

    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
  });
});
