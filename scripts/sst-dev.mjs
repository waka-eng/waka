import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { applyDevServerNetwork } from "./web-dev-network.mjs";
import { loadWorkspaceEnv } from "./workspace-env.mjs";

const DEFAULT_NODE_ENV = "development";

function readTrimmedString(value) {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmedValue = value.trim();

  return trimmedValue.length > 0 ? trimmedValue : undefined;
}

function resolvePackageManagerExecutable(env) {
  return (
    readTrimmedString(env.PNPM_EXECUTABLE) ??
    (process.platform === "win32" ? "pnpm.cmd" : "pnpm")
  );
}

export function resolveInstalledSstBin(workspaceRoot) {
  const requireFromRoot = createRequire(join(workspaceRoot, "package.json"));
  const candidateResolvers = [
    () => {
      const packageJsonPath = requireFromRoot.resolve("sst/package.json");
      const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
      const relativeBin =
        typeof packageJson.bin === "string" ? packageJson.bin : packageJson.bin?.sst;

      if (typeof relativeBin !== "string" || relativeBin.trim().length === 0) {
        throw new Error("The installed sst package does not expose an executable bin");
      }

      return resolve(dirname(packageJsonPath), relativeBin);
    },
    () => requireFromRoot.resolve("sst/bin/sst"),
    () => requireFromRoot.resolve("sst/bin/sst.mjs"),
    () => requireFromRoot.resolve("sst/bin/sst.js"),
  ];
  let lastError;

  for (const resolveCandidate of candidateResolvers) {
    try {
      const sstBin = resolveCandidate();

      if (existsSync(sstBin)) {
        return sstBin;
      }
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error("Unable to resolve the installed sst executable");
}

export function resolveSstDevCommand({
  workspaceRoot,
  env = process.env,
  resolveLocalBin = resolveInstalledSstBin,
} = {}) {
  try {
    const sstBin = resolveLocalBin(workspaceRoot);

    return {
      command: process.execPath,
      args: [sstBin, "dev"],
      mode: "local-bin",
    };
  } catch {
    return {
      command: resolvePackageManagerExecutable(env),
      args: ["exec", "sst", "dev"],
      mode: "pnpm-exec",
    };
  }
}

export function resolveSstDevEnvironment({
  workspaceRoot,
  appRoot,
  env = process.env,
} = {}) {
  const loadedRuntimeEnv = loadWorkspaceEnv({
    workspaceRoot,
    appRoot,
    env,
  });
  const runtimeEnv = applyDevServerNetwork(loadedRuntimeEnv);

  return {
    ...runtimeEnv,
    NODE_ENV: readTrimmedString(runtimeEnv.NODE_ENV) ?? DEFAULT_NODE_ENV,
  };
}

export function resolveSstDevSpawnOptions({
  workspaceRoot,
  appRoot,
  env = process.env,
  args = [],
  resolveLocalBin,
} = {}) {
  const launcher = resolveSstDevCommand({
    workspaceRoot,
    env,
    resolveLocalBin,
  });

  return {
    command: launcher.command,
    args: [...launcher.args, ...args],
    cwd: workspaceRoot,
    env: resolveSstDevEnvironment({
      workspaceRoot,
      appRoot,
      env,
    }),
    mode: launcher.mode,
  };
}

export function spawnSstDev(options = {}) {
  const spawnOptions = resolveSstDevSpawnOptions(options);

  return spawn(spawnOptions.command, spawnOptions.args, {
    cwd: spawnOptions.cwd,
    env: spawnOptions.env,
    stdio: "inherit",
  });
}

function isMainModule(metaUrl) {
  const executedPath = process.argv[1];

  if (typeof executedPath !== "string" || executedPath.length === 0) {
    return false;
  }

  return metaUrl === pathToFileURL(executedPath).href;
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(scriptDir, "..");
const appRoot = join(workspaceRoot, "apps", "web");

if (isMainModule(import.meta.url)) {
  const child = spawnSstDev({
    workspaceRoot,
    appRoot,
    args: process.argv.slice(2),
  });

  child.on("exit", (code, signal) => {
    if (signal !== null) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code ?? 0);
  });
}
