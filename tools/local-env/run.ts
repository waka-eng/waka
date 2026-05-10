#!/usr/bin/env tsx

import { spawn } from "node:child_process";

import { loadLocalEnv } from "./load.js";

const command = process.argv.slice(2);

if (command.length === 0) {
  console.error("Usage: pnpm tsx tools/local-env/run.ts <command> [...args]");
  process.exit(2);
}

const loaded = loadLocalEnv();
if (loaded.filename) {
  console.error(`[local-env] Loaded ${loaded.filename}`);
} else {
  console.error(
    "[local-env] No .env or .env.development found at the repo root; continuing with process environment only.",
  );
}

const child = spawn(command[0]!, command.slice(1), {
  stdio: "inherit",
  env: process.env,
  shell: false,
});

child.on("error", (error) => {
  console.error(`[local-env] Failed to start ${command[0]}: ${error.message}`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
