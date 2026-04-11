import assert from "node:assert/strict";
import test from "node:test";

import {
  applyResolvedUserIdToAuthSession,
  applyResolvedUserIdToAuthToken,
  applyResolvedUserIdToAuthUser,
  carryResolvedUserIdThroughAuthFlow,
} from "../apps/web/src/auth/auth-context.ts";

test("resolved Neon user ids replace provisional provider ids across auth contexts", () => {
  const result = carryResolvedUserIdThroughAuthFlow({
    resolvedUserId: "user-42",
    session: {
      expires: "2026-04-10T00:00:00.000Z",
      user: {
        email: "founder@waka.app",
        id: "google-subject-123",
        image: "https://example.com/avatar.png",
        name: "Waka Founder",
      },
    },
    token: {
      email: "founder@waka.app",
      sub: "google-subject-123",
    },
    user: {
      email: "founder@waka.app",
      googleSubject: "google-subject-123",
      id: "google-subject-123",
      image: "https://example.com/avatar.png",
      name: "Waka Founder",
    },
  });

  assert.equal(result.resolvedUserId, "user-42");
  assert.equal(result.user?.id, "user-42");
  assert.equal(result.user?.googleSubject, "google-subject-123");
  assert.equal(result.token?.sub, "user-42");
  assert.equal(result.token?.userId, "user-42");
  assert.equal(result.session?.user.id, "user-42");
  assert.equal(result.session?.userId, "user-42");
  assert.equal(result.session?.user.email, "founder@waka.app");
});

test("auth session normalization creates a stable user shell when the session has no user object", () => {
  assert.deepEqual(
    applyResolvedUserIdToAuthSession(
      {
        expires: "2026-04-10T00:00:00.000Z",
      },
      "user-99",
    ),
    {
      expires: "2026-04-10T00:00:00.000Z",
      user: {
        id: "user-99",
      },
      userId: "user-99",
    },
  );
});

test("auth token normalization persists the resolved Neon user id on both token identifiers", () => {
  assert.deepEqual(
    applyResolvedUserIdToAuthToken(
      {
        email: "founder@waka.app",
        sub: "google-subject-123",
      },
      "user-7",
    ),
    {
      email: "founder@waka.app",
      sub: "user-7",
      userId: "user-7",
    },
  );
});

test("auth user normalization rejects blank resolved user ids", () => {
  assert.throws(
    () =>
      applyResolvedUserIdToAuthUser(
        {
          id: "google-subject-123",
        },
        "   ",
      ),
    /Resolved auth user id must be a non-empty string/,
  );
});
