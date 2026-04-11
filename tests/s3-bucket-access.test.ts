import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import test from "node:test";

import {
  DEFAULT_S3_SMOKE_TEST_PREFIX,
  MEDIA_BUCKET_NAME_ENV,
  assertMediaBucketExposedFromSstConfig,
  assertMediaBucketLinkedToWebStack,
  assertMediaBucketProvisioned,
  buildAwsCliArgs,
  resolveLinkedMediaBucketName,
  verifyMediaBucketRoundTrip,
  type AwsCliRunner,
} from "../scripts/verify-s3-bucket.ts";

test("storage stack provisions a versioned media bucket and links it into the web app", () => {
  assert.doesNotThrow(() => {
    assertMediaBucketProvisioned();
    assertMediaBucketLinkedToWebStack();
    assertMediaBucketExposedFromSstConfig();
  });
});

test("linked bucket name is resolved from the SST resource binding", () => {
  assert.equal(
    resolveLinkedMediaBucketName({
      [MEDIA_BUCKET_NAME_ENV]: "waka-dev-media-bucket",
    }),
    "waka-dev-media-bucket",
  );

  assert.throws(
    () => resolveLinkedMediaBucketName({}),
    new RegExp(MEDIA_BUCKET_NAME_ENV),
  );
});

test("AWS CLI args include the configured region when present", () => {
  assert.deepEqual(
    buildAwsCliArgs(["s3api", "put-object"], { AWS_REGION: "us-east-1" }),
    ["--region", "us-east-1", "s3api", "put-object"],
  );

  assert.deepEqual(
    buildAwsCliArgs(["s3api", "put-object"], {}),
    ["s3api", "put-object"],
  );
});

test("media bucket verifier performs put, get, and delete against the linked bucket", () => {
  const recordedCalls: string[][] = [];

  const runner: AwsCliRunner = (args) => {
    recordedCalls.push(args);

    const [, , service, operation] =
      args[0] === "--region" ? args : [undefined, undefined, ...args];

    if (service !== "s3api") {
      throw new Error(`Unexpected AWS service call: ${args.join(" ")}`);
    }

    if (operation === "put-object") {
      return {
        status: 0,
      };
    }

    if (operation === "get-object") {
      const putArgs = recordedCalls[0];
      const sourcePath = putArgs[putArgs.indexOf("--body") + 1];
      const downloadPath = args.at(-1);

      writeFileSync(downloadPath!, readFileSync(sourcePath, "utf8"), "utf8");

      return {
        status: 0,
      };
    }

    if (operation === "delete-object") {
      return {
        status: 0,
      };
    }

    throw new Error(`Unexpected AWS operation: ${args.join(" ")}`);
  };

  const result = verifyMediaBucketRoundTrip({
    body: "test payload",
    bucketName: "waka-dev-media-bucket",
    env: {
      AWS_REGION: "ap-northeast-2",
    },
    now: 1234567890,
    runner,
  });

  assert.equal(result.bucketName, "waka-dev-media-bucket");
  assert.equal(result.body, "test payload");
  assert.equal(result.key, `${DEFAULT_S3_SMOKE_TEST_PREFIX}/1234567890.txt`);
  assert.equal(recordedCalls.length, 3);
  assert.deepEqual(recordedCalls[0], [
    "--region",
    "ap-northeast-2",
    "s3api",
    "put-object",
    "--bucket",
    "waka-dev-media-bucket",
    "--key",
    result.key,
    "--body",
    recordedCalls[0][9],
  ]);
  assert.deepEqual(recordedCalls[1].slice(0, 8), [
    "--region",
    "ap-northeast-2",
    "s3api",
    "get-object",
    "--bucket",
    "waka-dev-media-bucket",
    "--key",
    result.key,
  ]);
  assert.equal(recordedCalls[2][3], "delete-object");
});
