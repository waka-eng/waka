#!/usr/bin/env tsx

import { spawnSync } from "node:child_process";

import { loadLocalEnv } from "./load.js";

const SECRET_PAIRS: Array<[sstSecretName: string, envVarName: string]> = [
  ["GoogleClientId", "AUTH_GOOGLE_ID"],
  ["GoogleClientSecret", "AUTH_GOOGLE_SECRET"],
  ["SessionSecret", "AUTH_SECRET"],
  ["JwtSecret", "JWT_SECRET"],
  ["DbConnectionUrl", "DB_CONNECTION_URL"],
  ["GeminiApiKey", "GEMINI_API_KEY"],
];

function printUsage(): void {
  console.error([
    "Usage:",
    "  pnpm sst:secret:set -- <SstSecretName> <ENV_VAR_NAME>",
    "  pnpm sst:secret:set:all",
    "",
    "Loads repo-root .env first, or .env.development if .env is absent.",
    "Secret values are validated as present but are never printed by this helper.",
  ].join("\n"));
}

function parsePairs(argv: string[]): Array<[string, string]> {
  if (argv.length === 1 && argv[0] === "--all") return SECRET_PAIRS;

  if (argv.length === 2) return [[argv[0]!, argv[1]!]];

  printUsage();
  process.exit(2);
}

const requestedPairs = parsePairs(process.argv.slice(2));
const loaded = loadLocalEnv();

if (loaded.filename) {
  console.error(`[sst-secret] Loaded ${loaded.filename}`);
} else {
  console.error("[sst-secret] No .env or .env.development found at the repo root.");
}

for (const [sstSecretName, envVarName] of requestedPairs) {
  const value = process.env[envVarName];
  if (!value) {
    console.error(`[sst-secret] ${envVarName} is not set; refusing to set ${sstSecretName}.`);
    process.exit(1);
  }
}

for (const [sstSecretName, envVarName] of requestedPairs) {
  const value = process.env[envVarName]!;
  console.error(`[sst-secret] Setting ${sstSecretName} from ${envVarName}`);

  const result = spawnSync("pnpm", ["sst", "secret", "set", sstSecretName, value], {
    stdio: "inherit",
    env: process.env,
    shell: false,
  });

  if (result.error) {
    console.error(`[sst-secret] Failed to start pnpm sst: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
