import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  DASHBOARD_SIGN_IN_PATH,
  getDashboardRedirectPath,
  hasAuthSessionCookie,
} from "../apps/web/src/auth/dashboard-redirect.ts";

const AUTH_MIDDLEWARE_PATH = path.join(
  process.cwd(),
  "apps/web/middleware.ts",
);

test("dashboard requests without an auth session cookie redirect to signin", () => {
  assert.equal(getDashboardRedirectPath([]), DASHBOARD_SIGN_IN_PATH);
});

test("dashboard requests with an Auth.js session cookie do not redirect", () => {
  assert.equal(
    getDashboardRedirectPath(["authjs.session-token"]),
    null,
  );

  assert.equal(
    getDashboardRedirectPath(["__Secure-authjs.session-token"]),
    null,
  );
});

test("legacy NextAuth session cookies are also treated as authenticated", () => {
  assert.equal(hasAuthSessionCookie(["next-auth.session-token"]), true);
  assert.equal(
    hasAuthSessionCookie(["__Secure-next-auth.session-token"]),
    true,
  );
});

test("auth middleware protects every authenticated shell route", () => {
  const middlewareSource = readFileSync(AUTH_MIDDLEWARE_PATH, "utf8");

  assert.match(
    middlewareSource,
    /matcher:\s*\["\/dashboard\/:path\*",\s*"\/settings\/:path\*"\]/u,
  );
});
