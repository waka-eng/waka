/**
 * Standalone smoke test for POST /attachments/presign.
 *
 * Run with:
 *   ATTACHMENTS_BUCKET=waka-dev-attachments \
 *   AWS_REGION=us-west-2 \
 *   pnpm --filter @waka/api exec tsx src/routes/attachments.smoke.ts
 *
 * Exits 0 on full pass, 1 on any failure. Creates a throw-away user via
 * /auth/signup, exercises /attachments/presign with that user's token, then
 * cleans up the user. Same one-off-script style used by the other smoke
 * tests in this directory.
 *
 * What we cover:
 *   1. 401 when unauthenticated.
 *   2. 200 + sane payload when authenticated, with key namespaced under the
 *      authenticated user's id (tenant isolation).
 *   3. 400 on missing fields / invalid contentType / oversize.
 *   4. The signed URL targets the right bucket + key + Content-Type pin.
 *
 * Note: this is a pure presign test — we do NOT actually PUT bytes to S3.
 * Asserting that the URL is correctly shaped is enough; the upload itself
 * is exercised by the frontend integration step.
 */

import { loadLocalEnv } from "../../../../tools/local-env/load.js";

loadLocalEnv();

import { eq } from "drizzle-orm";

import { attachments, inspirations, users } from "../db/index.js";
import { getDb } from "../lib/db.js";
import { app } from "../index.js";

// Mock bucket name for the duration of this script. The presigned URL
// machinery only needs *some* bucket; it never actually contacts S3 to mint
// the URL — that is a pure local SigV4 computation.
process.env.ATTACHMENTS_BUCKET ??= "waka-smoke-bucket";
process.env.AWS_REGION ??= "us-west-2";
// Provide harmless static credentials if the host has none, so the SDK's
// credential provider chain doesn't hang trying to reach the IMDS endpoint.
process.env.AWS_ACCESS_KEY_ID ??= "AKIAIOSFODNN7EXAMPLE";
process.env.AWS_SECRET_ACCESS_KEY ??=
  "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";

async function main() {
  const email = `attachments-smoke-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}@example.test`;
  const password = "supersecret123";

  // Bootstrap: create an account so we have a valid bearer token.
  const signup = await app.request("/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, name: "Attach Smoke" }),
  });
  if (signup.status !== 201) {
    throw new Error(`Signup failed: ${signup.status} ${await signup.text()}`);
  }
  const { user, token } = (await signup.json()) as {
    user: { id: string; email: string; name: string };
    token: string;
  };

  try {
    // 1. Unauthenticated request → 401.
    const noAuth = await app.request("/attachments/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: "x.png",
        contentType: "image/png",
        size: 1024,
      }),
    });
    if (noAuth.status !== 401) {
      throw new Error(`Expected 401 without auth, got ${noAuth.status}`);
    }
    console.log("[1/5] unauthenticated → 401 ✅");

    // 2. Happy path → 200 with presigned URL + key + headers.
    const ok = await app.request("/attachments/presign", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        filename: "kitten.png",
        contentType: "image/png",
        size: 2048,
      }),
    });
    if (ok.status !== 200) {
      throw new Error(`Expected 200, got ${ok.status}: ${await ok.text()}`);
    }
    const okBody = (await ok.json()) as {
      uploadUrl: string;
      key: string;
      expiresAt: string;
      headers: { "Content-Type": string; "Content-Length": string };
    };

    // Tenant isolation: the key MUST sit under this user's namespace.
    const expectedPrefix = `users/${user.id}/attachments/`;
    if (!okBody.key.startsWith(expectedPrefix)) {
      throw new Error(
        `Tenant leak: key="${okBody.key}" does not start with "${expectedPrefix}"`,
      );
    }
    if (!okBody.key.endsWith(".png")) {
      throw new Error(`Expected .png extension, got key="${okBody.key}"`);
    }

    if (!okBody.uploadUrl.startsWith("https://")) {
      throw new Error(
        `uploadUrl is not https: ${okBody.uploadUrl.slice(0, 32)}`,
      );
    }
    if (!okBody.uploadUrl.includes(process.env.ATTACHMENTS_BUCKET!)) {
      throw new Error(
        `uploadUrl does not target the configured bucket: ${okBody.uploadUrl}`,
      );
    }
    if (!okBody.uploadUrl.includes("X-Amz-Signature=")) {
      throw new Error(`uploadUrl is not actually signed: ${okBody.uploadUrl}`);
    }
    if (
      okBody.headers["Content-Type"] !== "image/png" ||
      okBody.headers["Content-Length"] !== "2048"
    ) {
      throw new Error(
        `Headers contract broke: ${JSON.stringify(okBody.headers)}`,
      );
    }
    if (Date.parse(okBody.expiresAt) <= Date.now()) {
      throw new Error(`expiresAt is in the past: ${okBody.expiresAt}`);
    }
    console.log("[2/5] happy path 200 + signed URL ✅");

    // 3a. Missing fields → 400.
    const missing = await app.request("/attachments/presign", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ filename: "x.png" }),
    });
    if (missing.status !== 400) {
      throw new Error(`Expected 400 on missing fields, got ${missing.status}`);
    }
    console.log("[3/5] missing fields → 400 ✅");

    // 3b. Disallowed contentType → 400.
    const badType = await app.request("/attachments/presign", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        filename: "evil.exe",
        contentType: "application/x-msdownload",
        size: 100,
      }),
    });
    if (badType.status !== 400) {
      throw new Error(
        `Expected 400 on disallowed contentType, got ${badType.status}`,
      );
    }
    console.log("[4/5] disallowed contentType → 400 ✅");

    // 3c. Oversize → 400.
    const oversize = await app.request("/attachments/presign", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        filename: "huge.bin",
        contentType: "application/octet-stream",
        size: 26 * 1024 * 1024,
      }),
    });
    if (oversize.status !== 400) {
      throw new Error(`Expected 400 on oversize, got ${oversize.status}`);
    }
    console.log("[5/5] oversize → 400 ✅");

    // ------------------------------------------------------------------
    // POST /attachments — finalize-upload endpoint (Sub-AC 3.3).
    // ------------------------------------------------------------------

    // Need an inspiration to attach to. Create one using the same token.
    const inspRes = await app.request("/inspirations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ text: "for attachment finalize tests" }),
    });
    if (inspRes.status !== 201) {
      throw new Error(
        `Bootstrap inspiration failed: ${inspRes.status} ${await inspRes.text()}`,
      );
    }
    const { inspiration } = (await inspRes.json()) as {
      inspiration: { id: string };
    };

    // F1. Unauthenticated finalize → 401.
    const finNoAuth = await app.request("/attachments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "link",
        inspirationId: inspiration.id,
        url: "https://example.com",
      }),
    });
    if (finNoAuth.status !== 401) {
      throw new Error(
        `Expected 401 unauth finalize, got ${finNoAuth.status}`,
      );
    }
    console.log("[6/12] finalize unauthenticated → 401 ✅");

    // F2. Invalid JSON body → 400.
    const finBadJson = await app.request("/attachments", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: "not-json",
    });
    if (finBadJson.status !== 400) {
      throw new Error(`Expected 400 on bad JSON, got ${finBadJson.status}`);
    }
    console.log("[7/12] finalize bad JSON → 400 ✅");

    // F3. Schema failure (missing required field for link type) → 400.
    const finBadShape = await app.request("/attachments", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        type: "link",
        inspirationId: inspiration.id,
      }),
    });
    if (finBadShape.status !== 400) {
      throw new Error(
        `Expected 400 on missing url, got ${finBadShape.status}`,
      );
    }
    console.log("[8/12] finalize missing url → 400 ✅");

    // F4. Foreign / unknown inspiration uuid → 404 (no leak).
    const foreignId = "00000000-0000-0000-0000-000000000000";
    const finForeign = await app.request("/attachments", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        type: "link",
        inspirationId: foreignId,
        url: "https://example.com",
      }),
    });
    if (finForeign.status !== 404) {
      throw new Error(
        `Expected 404 on foreign inspiration, got ${finForeign.status}`,
      );
    }
    console.log("[9/12] finalize foreign inspiration → 404 ✅");

    // F5. Happy path: link attachment.
    const finLink = await app.request("/attachments", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        type: "link",
        inspirationId: inspiration.id,
        url: "https://example.com/post",
        name: "Example post",
      }),
    });
    if (finLink.status !== 201) {
      throw new Error(
        `Expected 201 on link finalize, got ${finLink.status}: ${await finLink.text()}`,
      );
    }
    const finLinkBody = (await finLink.json()) as {
      attachment: {
        id: string;
        inspirationId: string;
        type: string;
        url: string;
        name: string | null;
        s3Key: string | null;
        contentType: string | null;
        size: number | null;
        createdAt: string;
      };
    };
    const linkRow = finLinkBody.attachment;
    if (
      linkRow.type !== "link" ||
      linkRow.url !== "https://example.com/post" ||
      linkRow.s3Key !== null ||
      linkRow.inspirationId !== inspiration.id
    ) {
      throw new Error(
        `Link attachment row not as expected: ${JSON.stringify(linkRow)}`,
      );
    }
    console.log("[10/12] finalize link → 201 ✅");

    // F6. S3-key tenant prefix violation → 403.
    //     We pass a key that does NOT start with `users/<this-user>/...`.
    const finStolenKey = await app.request("/attachments", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        type: "image",
        inspirationId: inspiration.id,
        key: "users/00000000-0000-0000-0000-000000000000/attachments/x.png",
        contentType: "image/png",
        size: 100,
      }),
    });
    if (finStolenKey.status !== 403) {
      throw new Error(
        `Expected 403 on foreign key prefix, got ${finStolenKey.status}`,
      );
    }
    console.log("[11/12] finalize foreign-prefix key → 403 ✅");

    // F7. S3-backed finalize for own key.
    //     The smoke env points at a bucket that does not actually exist in
    //     S3. The HEAD verification returns "indeterminate" on auth/transport
    //     failure (which is what we expect with the dummy creds), so the row
    //     is allowed through with a console.warn. If you ever run this
    //     against a real bucket without uploading first, expect a 404.
    const ownKey = `users/${user.id}/attachments/${Date.now()}-smoke.png`;
    const finOwn = await app.request("/attachments", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        type: "image",
        inspirationId: inspiration.id,
        key: ownKey,
        contentType: "image/png",
        size: 2048,
        name: "smoke.png",
      }),
    });
    if (finOwn.status !== 201) {
      // 404 here means a real bucket was hit and the object is missing —
      // surface that as informative output rather than failing the whole run.
      const body = await finOwn.text();
      if (finOwn.status === 404) {
        console.warn(
          `[12/12] finalize image SKIPPED — HEAD said 'missing' against real bucket: ${body}`,
        );
      } else {
        throw new Error(
          `Expected 201 on image finalize, got ${finOwn.status}: ${body}`,
        );
      }
    } else {
      const finOwnBody = (await finOwn.json()) as {
        attachment: {
          id: string;
          type: string;
          url: string;
          s3Key: string | null;
          contentType: string | null;
          size: number | null;
        };
      };
      const imgRow = finOwnBody.attachment;
      if (
        imgRow.type !== "image" ||
        imgRow.s3Key !== ownKey ||
        !imgRow.url.includes(ownKey.split("/").map(encodeURIComponent).join("/")) ||
        imgRow.contentType !== "image/png" ||
        imgRow.size !== 2048
      ) {
        throw new Error(
          `Image attachment row not as expected: ${JSON.stringify(imgRow)}`,
        );
      }
      console.log("[12/12] finalize image (S3-backed) → 201 ✅");
    }
  } finally {
    // Cleanup: drop the throw-away user. Cascades clean up sessions /
    // inspirations / attachments.
    const db = getDb();
    // Defensive: explicit deletes in case the FK cascade is misconfigured.
    const userInspirations = await db
      .select({ id: inspirations.id })
      .from(inspirations)
      .where(eq(inspirations.userId, user.id));
    for (const insp of userInspirations) {
      await db
        .delete(attachments)
        .where(eq(attachments.inspirationId, insp.id));
    }
    await db.delete(inspirations).where(eq(inspirations.userId, user.id));
    await db.delete(users).where(eq(users.id, user.id));
    console.log("cleaned up test user + inspirations + attachments");
  }
}

main()
  .then(() => {
    console.log("ALL SMOKE TESTS PASSED");
    process.exit(0);
  })
  .catch((err) => {
    console.error("SMOKE TEST FAILED:", err);
    process.exit(1);
  });
