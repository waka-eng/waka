import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { tmpdir } from "node:os";

import {
  resolveInstalledSstBin,
  resolveSstDevCommand,
  resolveSstDevEnvironment,
  resolveSstDevSpawnOptions,
} from "../scripts/sst-dev.mjs";

test("sst dev bootstrap loads workspace env defaults and pins local dev runtime values", () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), "waka-sst-dev-"));
  const appRoot = path.join(workspaceRoot, "apps", "web");

  mkdirSync(appRoot, { recursive: true });
  writeFileSync(path.join(workspaceRoot, "package.json"), "{\"name\":\"waka\"}\n");
  writeFileSync(
    path.join(workspaceRoot, ".env.development"),
    [
      "AWS_REGION=us-east-1",
      "APP_URL=http://localhost:3000",
      "LLM_PROVIDER=openai",
      "HOST=0.0.0.0",
      "PORT=3000",
      "",
    ].join("\n"),
  );
  writeFileSync(
    path.join(workspaceRoot, ".env.local"),
    [
      "NEXTAUTH_URL=http://localhost:3000",
      "",
    ].join("\n"),
  );

  try {
    const env = resolveSstDevEnvironment({
      workspaceRoot,
      appRoot,
      env: {
        OPENAI_API_KEY: "test-openai-key",
      },
    });

    assert.equal(env.AWS_REGION, "us-east-1");
    assert.equal(env.APP_URL, "http://localhost:3000");
    assert.equal(env.NEXTAUTH_URL, "http://localhost:3000");
    assert.equal(env.LLM_PROVIDER, "openai");
    assert.equal(env.HOST, "0.0.0.0");
    assert.equal(env.HOSTNAME, "0.0.0.0");
    assert.equal(env.PORT, "3000");
    assert.equal(env.NODE_ENV, "development");
    assert.equal(env.SST_STAGE, undefined);
    assert.equal(env.OPENAI_API_KEY, "test-openai-key");
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test("sst dev bootstrap prefers the installed local SST bin when available", () => {
  const launcher = resolveSstDevCommand({
    workspaceRoot: "/tmp/waka",
    resolveLocalBin: () => "/tmp/waka/node_modules/sst/bin/sst.mjs",
  });

  assert.equal(launcher.command, process.execPath);
  assert.deepEqual(launcher.args, ["/tmp/waka/node_modules/sst/bin/sst.mjs", "dev"]);
  assert.equal(launcher.mode, "local-bin");
});

test("sst dev bootstrap falls back to pnpm exec when the local SST bin is unavailable", () => {
  const launcher = resolveSstDevCommand({
    workspaceRoot: "/tmp/waka",
    env: {},
    resolveLocalBin: () => {
      throw new Error("sst is not installed");
    },
  });

  assert.equal(launcher.command, process.platform === "win32" ? "pnpm.cmd" : "pnpm");
  assert.deepEqual(launcher.args, ["exec", "sst", "dev"]);
  assert.equal(launcher.mode, "pnpm-exec");
});

test("sst dev bootstrap forwards extra CLI arguments to sst dev", () => {
  const spawnOptions = resolveSstDevSpawnOptions({
    workspaceRoot: "/tmp/waka",
    appRoot: "/tmp/waka/apps/web",
    env: {
      APP_URL: "http://localhost:3000",
    },
    args: ["--stage", "preview"],
    resolveLocalBin: () => "/tmp/waka/node_modules/sst/bin/sst.mjs",
  });

  assert.equal(spawnOptions.cwd, "/tmp/waka");
  assert.deepEqual(spawnOptions.args, [
    "/tmp/waka/node_modules/sst/bin/sst.mjs",
    "dev",
    "--stage",
    "preview",
  ]);
  assert.equal(spawnOptions.mode, "local-bin");
  assert.equal(spawnOptions.env.SST_STAGE, undefined);
});

test("sst dev bootstrap pins auth callbacks to the resolved local dev URL", () => {
  const env = resolveSstDevEnvironment({
    workspaceRoot: "/tmp/waka",
    appRoot: "/tmp/waka/apps/web",
    env: {
      APP_URL: "http://localhost:3000",
      NEXTAUTH_URL: "http://localhost:3000",
      PORT: "4010",
    },
  });

  assert.equal(env.APP_URL, "http://localhost:4010");
  assert.equal(env.NEXTAUTH_URL, "http://localhost:4010");
  assert.equal(env.PORT, "4010");
});

test("installed SST bin resolver reads the package bin entry", () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), "waka-sst-bin-"));
  const sstPackageRoot = path.join(workspaceRoot, "node_modules", "sst");

  mkdirSync(path.join(sstPackageRoot, "dist"), { recursive: true });
  writeFileSync(path.join(workspaceRoot, "package.json"), "{\"name\":\"waka\"}\n");
  writeFileSync(
    path.join(sstPackageRoot, "package.json"),
    JSON.stringify({
      name: "sst",
      bin: {
        sst: "dist/cli.mjs",
      },
    }),
  );
  writeFileSync(path.join(sstPackageRoot, "dist", "cli.mjs"), "export {};\n");

  try {
    assert.equal(
      resolveInstalledSstBin(workspaceRoot),
      realpathSync(path.join(sstPackageRoot, "dist", "cli.mjs")),
    );
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
