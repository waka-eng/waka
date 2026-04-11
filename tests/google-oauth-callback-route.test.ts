import assert from "node:assert/strict";
import test from "node:test";
import {
  GOOGLE_CALLBACK_MISSING_CODE_DESCRIPTION,
  GOOGLE_CALLBACK_MISSING_CODE_ERROR,
  GOOGLE_SIGN_IN_COMPLETION_PATH,
  getGoogleAuthorizationFailurePath,
  getGoogleCallbackRedirectPath,
  readGoogleAuthorizationCallbackParams,
} from "../apps/web/src/auth/google-callback.ts";

test("Google callback helper forwards successful authorization to sign-in completion", () => {
  assert.equal(
    getGoogleCallbackRedirectPath(
      new URLSearchParams(
        "code=oauth-code&state=oauth-state&scope=openid+email+profile",
      ),
    ),
    `${GOOGLE_SIGN_IN_COMPLETION_PATH}?code=oauth-code&state=oauth-state&scope=openid+email+profile`,
  );
});

test("Google callback helper redirects authorization errors back to signin", () => {
  assert.equal(
    getGoogleCallbackRedirectPath(
      new URLSearchParams(
        "error=access_denied&error_description=User+canceled",
      ),
    ),
    "/auth/signin?error=access_denied&error_description=User+canceled",
  );
});

test("Google callback helper reports missing authorization code failures", () => {
  assert.equal(
    getGoogleCallbackRedirectPath(new URLSearchParams("state=oauth-state")),
    "/auth/signin?error=missing_code&error_description=Google+authorization+callback+did+not+include+an+authorization+code.",
  );
});

test("Google callback helper preserves provider callback parameters for completion", () => {
  assert.equal(
    getGoogleCallbackRedirectPath(
      new URLSearchParams(
        "code=oauth-code&state=oauth-state&scope=openid+email+profile&authuser=0&prompt=consent",
      ),
    ),
    "/api/auth/callback/google?code=oauth-code&state=oauth-state&scope=openid+email+profile&authuser=0&prompt=consent",
  );
});

test("Google callback parameter reader normalizes blank callback values", () => {
  assert.deepEqual(
    readGoogleAuthorizationCallbackParams(
      new URLSearchParams("code=++&error=+&error_description=++"),
    ),
    {
      code: null,
      error: null,
      errorDescription: null,
    },
  );
});

test("Google callback failure helper prefers provider error details when present", () => {
  assert.equal(
    getGoogleAuthorizationFailurePath({
      code: null,
      error: "temporarily_unavailable",
      errorDescription: "Try again later",
    }),
    "/auth/signin?error=temporarily_unavailable&error_description=Try+again+later",
  );

  assert.equal(
    getGoogleAuthorizationFailurePath({
      code: null,
      error: null,
      errorDescription: null,
    }),
    `/auth/signin?error=${GOOGLE_CALLBACK_MISSING_CODE_ERROR}&error_description=${encodeURIComponent(
      GOOGLE_CALLBACK_MISSING_CODE_DESCRIPTION,
    ).replace(/%20/g, "+")}`,
  );
});
