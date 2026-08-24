/**
 * Drizzle schema barrel.
 *
 * Re-exports every table, enum, type, and relations object so callers (Hono
 * handlers, the background worker, drizzle-kit, vitest) have one import path:
 *
 *   import { accounts, profiles, inspirations, signals } from "./db";
 *
 * **One name per concept, and no aliases.** Never re-export a table under a
 * second identifier, however convenient it looks during a rename: a table
 * with two names is a bug waiting for someone to write code against the
 * wrong one, and the reader who finds both has no way to tell which is
 * authoritative.
 *
 * The three layers, in order:
 *   inspirations (raw capture) → signals (evidence-backed patterns)
 *   → top_of_minds + top_of_mind_entries (one artifact per profile/group)
 */

export * from "./schema-accounts";
export * from "./schema-profiles";
export * from "./schema-principles";
export * from "./schema-login-failures";
export * from "./schema-sessions";
export * from "./schema-consultations";
export * from "./schema-statement-chains";
export * from "./schema-cli-login-codes";
export * from "./schema-inspirations";
export * from "./schema-attachments";
export * from "./schema-reflections";
export * from "./schema-embeddings";
export * from "./schema-signals";
export * from "./schema-top-of-mind";
export * from "./schema-groups";
export * from "./schema-group-coedit";
export * from "./schema-background-jobs";
export * from "./schema-feedback";
