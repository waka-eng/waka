/**
 * Drizzle schema barrel.
 *
 * Re-exports every table, enum, type, and relations object across the
 * schema modules so that callers (Hono handlers, queue worker, drizzle-kit
 * migration generator, vitest suite) can do:
 *
 *   import { users, inspirations, attachments, reflections } from "./db";
 *
 * The split into sibling modules (schema.ts, schema-attachments.ts,
 * schema-reflections.ts) keeps each AC's diff small and reviewable, while
 * this barrel preserves a single canonical import path for everything.
 *
 * drizzle-kit's `schema` config option also accepts a glob, but pointing it
 * at this file is equivalent and explicit.
 */

export * from "./schema";
export * from "./schema-attachments";
export * from "./schema-reflections";
export * from "./schema-sessions";
export * from "./schema-wow-moments";
export * from "./schema-embeddings";
export * from "./schema-background-jobs";
export * from "./schema-revisits";
export * from "./schema-feedback";
export * from "./schema-documents";
