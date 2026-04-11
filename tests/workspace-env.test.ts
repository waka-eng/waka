import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { tmpdir } from "node:os";

import {
  getEnvFileOrder,
  loadWorkspaceEnv,
  parseDotEnvFileContents,
} from "../scripts/workspace-env.mjs";

test("workspace env loader preserves Next.js-style precedence and process overrides", () => {
  const tempRoot = mkdtempSync(path.join(tmpdir(), "waka-workspace-env-"));
  const appRoot = path.join(tempRoot, "apps", "web");

  mkdirSync(appRoot, { recursive: true });
  writeFileSync(
    path.join(tempRoot, ".env"),
    "APP_URL=http://root-env.example\nGOOGLE_CLIENT_ID=root-client-id\n",
  );
  writeFileSync(
    path.join(tempRoot, ".env.local"),
    "APP_URL=http://root-local.example\nNEXTAUTH_URL=http://root-local.example\n",
  );
  writeFileSync(
    path.join(appRoot, ".env.development"),
    "APP_URL=http://app-dev.example\nGOOGLE_CLIENT_ID=app-dev-client-id\n",
  );
  writeFileSync(
    path.join(appRoot, ".env.development.local"),
    "APP_URL=http://app-dev-local.example\nGOOGLE_CLIENT_SECRET=app-dev-local-secret\n",
  );

  try {
    const env = loadWorkspaceEnv({
      workspaceRoot: tempRoot,
      appRoot,
      env: {
        GOOGLE_CLIENT_ID: "process-client-id",
      },
      nodeEnv: "development",
    });

    assert.equal(env.APP_URL, "http://app-dev-local.example");
    assert.equal(env.NEXTAUTH_URL, "http://root-local.example");
    assert.equal(env.GOOGLE_CLIENT_ID, "process-client-id");
    assert.equal(env.GOOGLE_CLIENT_SECRET, "app-dev-local-secret");
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("dotenv parser skips comments and supports quoted values", () => {
  assert.deepEqual(
    parseDotEnvFileContents(`
# Comment
APP_URL=http://waka.app
NEXTAUTH_SECRET="line-one\\nline-two"
export GOOGLE_CLIENT_ID='waka-client-id'
INVALID LINE
`),
    {
      APP_URL: "http://waka.app",
      NEXTAUTH_SECRET: "line-one\nline-two",
      GOOGLE_CLIENT_ID: "waka-client-id",
    },
  );
});

test("workspace env file order starts with base files and ends with env-specific locals", () => {
  assert.deepEqual(getEnvFileOrder("development"), [
    ".env",
    ".env.development",
    ".env.local",
    ".env.development.local",
  ]);
});

test("checked-in development env captures the non-secret SST dev defaults", () => {
  const env = parseDotEnvFileContents(readFileSync(".env.development", "utf8"));

  assert.equal(env.AWS_REGION, "us-east-1");
  assert.equal(env.APP_URL, "http://localhost:3000");
  assert.equal(env.NEXTAUTH_URL, "http://localhost:3000");
  assert.equal(env.LLM_PROVIDER, "openai");
  assert.equal(env.HOST, "0.0.0.0");
  assert.equal(env.PORT, "3000");
});

test(".env.example points developers at the checked-in non-secret defaults", () => {
  const envExample = parseDotEnvFileContents(readFileSync(".env.example", "utf8"));

  assert.equal(
    envExample.DATABASE_URL,
    "postgresql://user:password@project.neon.tech/waka?sslmode=require",
  );
  assert.equal(
    envExample.NEXTAUTH_SECRET,
    "replace-with-a-long-random-string",
  );
  assert.equal(envExample.NEXTAUTH_URL, "http://localhost:3000");
  assert.equal(
    envExample.GOOGLE_CLIENT_ID,
    "replace-with-google-oauth-client-id",
  );
  assert.equal(
    envExample.GOOGLE_CLIENT_SECRET,
    "replace-with-google-oauth-client-secret",
  );
  assert.equal(envExample.LLM_PROVIDER, "openai");
  assert.equal(
    envExample.OPENAI_API_KEY,
    "replace-with-openai-api-key",
  );
  assert.equal(
    envExample.GEMINI_API_KEY,
    "replace-with-gemini-api-key-if-llm-provider-is-gemini",
  );
  assert.equal(envExample.AWS_REGION, "us-east-1");
  assert.equal(envExample.APP_URL, "http://localhost:3000");
  assert.equal(envExample.HOST, "0.0.0.0");
  assert.equal(envExample.PORT, "3000");
  assert.equal(
    envExample.WAKA_API_KEY,
    "replace-with-generated-api-key",
  );
});
