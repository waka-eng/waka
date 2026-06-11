#!/usr/bin/env tsx
/**
 * Vault export CLI — Phase 1 backfill (docs/vault-architecture.md).
 *
 * Reads existing content from Postgres (read-only) and writes YAML vault
 * documents to a local directory or an S3 prefix.
 *
 * Usage:
 *   pnpm vault:export -- --user <userId> --out ./vault
 *   pnpm vault:export -- --all --out ./vault
 *   pnpm vault:export -- --all --bucket my-bucket [--bucket-prefix vault/]
 *
 * Requires DB_CONNECTION_URL (loaded from .env like the other tools); the
 * S3 target additionally uses the ambient AWS credential chain.
 */

import { config as loadDotenv } from "dotenv";

loadDotenv();

import { getDb } from "../packages/api/src/lib/db";
import {
  createDrizzleVaultExportSource,
  exportUserVault,
} from "../packages/api/src/vault/exporter";
import { FsVault } from "../packages/api/src/vault/fs-vault";
import { createS3Vault } from "../packages/api/src/vault/s3-vault";
import type { VaultStore } from "../packages/api/src/vault/vault";

interface Args {
  userId?: string;
  all: boolean;
  out?: string;
  bucket?: string;
  bucketPrefix?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { all: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--") continue;
    const next = () => {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`Missing value for ${flag}`);
      }
      i += 1;
      return value;
    };
    switch (flag) {
      case "--user":
        args.userId = next();
        break;
      case "--all":
        args.all = true;
        break;
      case "--out":
        args.out = next();
        break;
      case "--bucket":
        args.bucket = next();
        break;
      case "--bucket-prefix":
        args.bucketPrefix = next();
        break;
      default:
        throw new Error(`Unknown flag: ${flag}`);
    }
  }
  if (!args.userId && !args.all) {
    throw new Error("Specify --user <userId> or --all");
  }
  if (args.userId && args.all) {
    throw new Error("--user and --all are mutually exclusive");
  }
  if (!args.out === !args.bucket) {
    throw new Error("Specify exactly one target: --out <dir> or --bucket <name>");
  }
  return args;
}

function createVault(args: Args): VaultStore {
  if (args.out) return new FsVault(args.out);
  return createS3Vault({ bucket: args.bucket!, prefix: args.bucketPrefix });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const vault = createVault(args);
  const source = createDrizzleVaultExportSource(getDb());

  const userIds = args.all ? await source.listUserIds() : [args.userId!];
  let totalInspirations = 0;
  let totalMoments = 0;

  for (const userId of userIds) {
    const summary = await exportUserVault({ source, vault, userId });
    totalInspirations += summary.inspirations.length;
    totalMoments += summary.wowMoments.length;
    console.log(
      `user ${userId}: ${summary.inspirations.length} inspirations, ${summary.wowMoments.length} wow moments`,
    );
  }

  console.log(
    `done: ${userIds.length} user(s), ${totalInspirations} inspirations, ${totalMoments} wow moments → ${
      args.out ?? `s3://${args.bucket}/${args.bucketPrefix ?? "vault/"}`
    }`,
  );
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
