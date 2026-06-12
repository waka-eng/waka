#!/usr/bin/env tsx
/**
 * Vault reindex CLI.
 *
 * Scans vault YAML files and rebuilds the `documents` index projection. This
 * deliberately reads the vault, not the content tables, so it is the recovery
 * path for the file-as-SSOT architecture.
 */

import { config as loadDotenv } from "dotenv";

loadDotenv();

import { parse } from "yaml";

import { documents, type DocumentType } from "../packages/api/src/db/index";
import { getDb } from "../packages/api/src/lib/db";
import { FsVault } from "../packages/api/src/vault/fs-vault";
import { upsertDocumentIndex } from "../packages/api/src/vault/materialize";
import { createS3Vault } from "../packages/api/src/vault/s3-vault";
import { contentHash, type VaultStore } from "../packages/api/src/vault/vault";
import { eq } from "drizzle-orm";

interface Args {
  userId?: string;
  all: boolean;
  root?: string;
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
      case "--root":
        args.root = next();
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
  if (!args.userId && !args.all) throw new Error("Specify --user <userId> or --all");
  if (args.userId && args.all) throw new Error("--user and --all are mutually exclusive");
  if (!args.root === !args.bucket) {
    throw new Error("Specify exactly one source: --root <dir> or --bucket <name>");
  }
  return args;
}

function createVault(args: Args): VaultStore {
  if (args.root) return new FsVault(args.root);
  return createS3Vault({ bucket: args.bucket!, prefix: args.bucketPrefix });
}

function docTypeForSchema(schema: unknown): DocumentType | null {
  switch (schema) {
    case "waka/signal@v1":
      return "signal";
    case "waka/top-of-mind-note@v1":
      return "top_of_mind_note";
    case "waka/context-node@v1":
      return "context_node";
    case "waka/context-edge@v1":
      return "context_edge";
    default:
      return null;
  }
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function parseDate(value: unknown): Date | null {
  const text = asString(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function searchTextFor(docType: DocumentType, doc: Record<string, unknown>): string | null {
  const parts: string[] = [];
  if (docType === "signal") {
    if (asString(doc.text)) parts.push(asString(doc.text)!);
    const sparks = Array.isArray(doc.sparks) ? doc.sparks : [];
    for (const spark of sparks) {
      if (spark && typeof spark === "object" && asString((spark as { text?: unknown }).text)) {
        parts.push((spark as { text: string }).text);
      }
    }
    const packet = doc.signal_packet;
    if (packet && typeof packet === "object") {
      const p = packet as Record<string, unknown>;
      for (const key of ["spark_text", "artifact_excerpt", "packet_text"]) {
        if (asString(p[key])) parts.push(asString(p[key])!);
      }
    }
  } else if (docType === "top_of_mind_note") {
    for (const key of ["title", "why", "belief_statement", "reflection_question"]) {
      if (asString(doc[key])) parts.push(asString(doc[key])!);
    }
  } else if (docType === "context_node") {
    for (const key of ["type", "label", "description", "status"]) {
      if (asString(doc[key])) parts.push(asString(doc[key])!);
    }
    const evidence = Array.isArray(doc.evidence) ? doc.evidence : [];
    for (const item of evidence) {
      if (item && typeof item === "object" && asString((item as { reason?: unknown }).reason)) {
        parts.push((item as { reason: string }).reason);
      }
    }
  } else if (docType === "context_edge") {
    if (asString(doc.kind)) parts.push(asString(doc.kind)!);
  }
  return parts.length > 0 ? parts.join("\n\n") : null;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const vault = createVault(args);
  const db = getDb();
  const prefix = args.userId ? `${args.userId}/` : "";
  const docs: Array<{
    path: string;
    userId: string;
    id: string;
    docType: DocumentType;
    content: string;
    parsed: Record<string, unknown>;
  }> = [];

  for await (const path of vault.list(prefix)) {
    if (!path.endsWith(".yaml")) continue;
    const content = await vault.get(path);
    if (!content) continue;
    const parsed = parse(content) as Record<string, unknown>;
    const docType = docTypeForSchema(parsed.schema);
    const id = asString(parsed.id);
    const userId = path.split("/")[0];
    if (!docType || !id || !userId) continue;
    docs.push({ path, userId, id, docType, content, parsed });
  }

  const userIds = [...new Set(docs.map((doc) => doc.userId))];
  if (args.all) {
    await db.delete(documents);
  } else if (args.userId) {
    await db.delete(documents).where(eq(documents.userId, args.userId));
  }

  const counts = new Map<DocumentType, number>();
  for (const doc of docs) {
    await upsertDocumentIndex(db, {
      id: doc.id,
      userId: doc.userId,
      docType: doc.docType,
      path: doc.path,
      contentHash: contentHash(doc.content),
      rev: typeof doc.parsed.rev === "number" ? doc.parsed.rev : 1,
      searchText: searchTextFor(doc.docType, doc.parsed),
      createdAt: parseDate(doc.parsed.created_at),
    });
    counts.set(doc.docType, (counts.get(doc.docType) ?? 0) + 1);
  }

  console.log(
    `reindexed ${docs.length} document(s) for ${userIds.length} user(s): ${JSON.stringify(Object.fromEntries(counts))}`,
  );
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
