import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadDotenv } from "dotenv";

export interface LocalEnvLoadResult {
  path: string | null;
  filename: ".env" | ".env.development" | null;
}

const AWS_APP_ENV_ALIASES: Array<[standardName: string, appName: string]> = [
  ["AWS_REGION", "AWS_REGION_APP"],
  ["AWS_ACCESS_KEY_ID", "AWS_ACCESS_KEY_ID_APP"],
  ["AWS_SECRET_ACCESS_KEY", "AWS_SECRET_ACCESS_KEY_APP"],
];

function applyLocalEnvAliases(): void {
  for (const [standardName, appName] of AWS_APP_ENV_ALIASES) {
    if (!process.env[standardName] && process.env[appName]) {
      process.env[standardName] = process.env[appName];
    }
  }
}

function findRepoRoot(start: string): string {
  let cursor = start;

  for (let i = 0; i < 12; i++) {
    if (existsSync(resolve(cursor, "package.json"))) {
      if (existsSync(resolve(cursor, "pnpm-workspace.yaml"))) {
        return cursor;
      }
    }

    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }

  throw new Error("Could not locate the WAKA repo root from local-env loader.");
}

export function getRepoRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return findRepoRoot(here);
}

/**
 * Load local development env with WAKA's precedence:
 *
 *   1. repo-root .env
 *   2. repo-root .env.development, only when .env is absent
 *
 * dotenv parsing is intentionally used instead of shell sourcing because values
 * such as Postgres URLs commonly contain shell metacharacters like `&`.
 */
export function loadLocalEnv(): LocalEnvLoadResult {
  const root = getRepoRoot();
  const candidates = [".env", ".env.development"] as const;

  for (const filename of candidates) {
    const path = resolve(root, filename);
    if (!existsSync(path)) continue;

    const result = loadDotenv({ path, override: false });
    if (result.error) throw result.error;

    applyLocalEnvAliases();
    return { path, filename };
  }

  applyLocalEnvAliases();
  return { path: null, filename: null };
}
