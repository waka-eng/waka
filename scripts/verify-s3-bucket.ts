import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const STORAGE_STACK_PATH = path.join("infra", "storage-stack.ts");
export const WEB_STACK_PATH = path.join("infra", "web-stack.ts");
export const SST_CONFIG_PATH = "sst.config.ts";

export const MEDIA_BUCKET_RESOURCE_NAME = "MediaBucket";
export const MEDIA_BUCKET_NAME_ENV = `SST_RESOURCE_${MEDIA_BUCKET_RESOURCE_NAME}_name`;
export const DEFAULT_S3_SMOKE_TEST_PREFIX = "smoke-tests/media-bucket";
export const DEFAULT_S3_SMOKE_TEST_BODY = "waka-s3-smoke-test";

export type AwsCliResult = {
  error?: Error;
  status: number | null;
  stdout?: string;
  stderr?: string;
};

export type AwsCliRunner = (
  args: string[],
  env: NodeJS.ProcessEnv,
) => AwsCliResult;

function readSource(relativePath: string) {
  return readFileSync(relativePath, "utf8");
}

export function assertMediaBucketProvisioned(
  storageStackSource = readSource(STORAGE_STACK_PATH),
) {
  assert.match(
    storageStackSource,
    /export const MEDIA_BUCKET_RESOURCE_NAME = "MediaBucket";/,
  );
  assert.match(
    storageStackSource,
    /new sst\.aws\.Bucket\(MEDIA_BUCKET_RESOURCE_NAME,\s*\{/,
  );
  assert.match(storageStackSource, /cors:\s*\{/);
  assert.match(storageStackSource, /versioning:\s*true/);
}

export function assertMediaBucketLinkedToWebStack(
  webStackSource = readSource(WEB_STACK_PATH),
) {
  assert.match(webStackSource, /link:\s*\[mediaBucket,\s*jobsQueue\]/s);
}

export function assertMediaBucketExposedFromSstConfig(
  sstConfigSource = readSource(SST_CONFIG_PATH),
) {
  assert.match(sstConfigSource, /mediaBucketName:\s*mediaBucket\.name,/);
}

export function resolveLinkedMediaBucketName(
  env: NodeJS.ProcessEnv = process.env,
) {
  const bucketName = env[MEDIA_BUCKET_NAME_ENV]?.trim();

  assert.ok(
    bucketName,
    `Expected the linked MediaBucket name in ${MEDIA_BUCKET_NAME_ENV}. Run this from an SST-linked runtime or shell.`,
  );

  return bucketName;
}

export function buildAwsCliArgs(
  serviceArgs: string[],
  env: NodeJS.ProcessEnv = process.env,
) {
  const region = env.AWS_REGION?.trim();

  if (!region) {
    return serviceArgs;
  }

  return ["--region", region, ...serviceArgs];
}

export function defaultAwsCliRunner(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): AwsCliResult {
  const result = spawnSync("aws", args, {
    encoding: "utf8",
    env,
  });

  return {
    error: result.error,
    status: result.status,
    stderr: result.stderr,
    stdout: result.stdout,
  };
}

function runAwsCli(
  args: string[],
  env: NodeJS.ProcessEnv,
  runner: AwsCliRunner,
) {
  const result = runner(args, env);

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    const stdout = result.stdout?.trim();
    const details = stderr || stdout || "AWS CLI exited without output";

    throw new Error(
      `aws ${args.join(" ")} failed with exit code ${result.status}: ${details}`,
    );
  }

  return result;
}

export interface VerifyMediaBucketRoundTripOptions {
  body?: string;
  bucketName: string;
  env?: NodeJS.ProcessEnv;
  keyPrefix?: string;
  now?: number;
  runner?: AwsCliRunner;
}

export function verifyMediaBucketRoundTrip({
  body = DEFAULT_S3_SMOKE_TEST_BODY,
  bucketName,
  env = process.env,
  keyPrefix = DEFAULT_S3_SMOKE_TEST_PREFIX,
  now = Date.now(),
  runner = defaultAwsCliRunner,
}: VerifyMediaBucketRoundTripOptions) {
  const tempDirectory = mkdtempSync(path.join(os.tmpdir(), "waka-s3-"));
  const uploadPath = path.join(tempDirectory, "upload.txt");
  const downloadPath = path.join(tempDirectory, "download.txt");
  const key = `${keyPrefix.replace(/\/+$/, "")}/${now}.txt`;

  writeFileSync(uploadPath, body, "utf8");

  let uploaded = false;
  let primaryError: unknown = null;

  try {
    runAwsCli(
      buildAwsCliArgs(
        [
          "s3api",
          "put-object",
          "--bucket",
          bucketName,
          "--key",
          key,
          "--body",
          uploadPath,
        ],
        env,
      ),
      env,
      runner,
    );
    uploaded = true;

    runAwsCli(
      buildAwsCliArgs(
        [
          "s3api",
          "get-object",
          "--bucket",
          bucketName,
          "--key",
          key,
          downloadPath,
        ],
        env,
      ),
      env,
      runner,
    );

    const downloadedBody = readFileSync(downloadPath, "utf8");

    assert.equal(
      downloadedBody,
      body,
      "Expected the downloaded S3 object to match the uploaded test payload",
    );

    return {
      body: downloadedBody,
      bucketName,
      key,
    };
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    if (uploaded) {
      try {
        runAwsCli(
          buildAwsCliArgs(
            [
              "s3api",
              "delete-object",
              "--bucket",
              bucketName,
              "--key",
              key,
            ],
            env,
          ),
          env,
          runner,
        );
      } catch (cleanupError) {
        if (primaryError === null) {
          throw cleanupError;
        }
      }
    }

    rmSync(tempDirectory, { force: true, recursive: true });
  }
}

export function verifyS3BucketAccess(env: NodeJS.ProcessEnv = process.env) {
  assertMediaBucketProvisioned();
  assertMediaBucketLinkedToWebStack();
  assertMediaBucketExposedFromSstConfig();

  return verifyMediaBucketRoundTrip({
    bucketName: resolveLinkedMediaBucketName(env),
    env,
  });
}

const invokedAsScript =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedAsScript) {
  try {
    const result = verifyS3BucketAccess();

    console.log(
      `Verified S3 round-trip for bucket ${result.bucketName} with key ${result.key}.`,
    );
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Unknown S3 verification failure",
    );
    process.exitCode = 1;
  }
}
