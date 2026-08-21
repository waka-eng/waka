-- Per-capture visibility (layer 1).
--
-- A room's field is built from its members' memories, not only from the
-- machine's readings of them — so a capture needs to say whether its author
-- meant it to leave their own wall.
--
-- DEFAULT 'private' and NOT NULL together are the safety property: every row
-- that already exists, and every row written by a client that predates this
-- column, is invisible to other people. Opening a memory up is always an act
-- someone took, never something that happened to them.
--
-- WHY THIS FILE GUARDS EVERY STATEMENT.
--
-- These three objects were applied to the shared Neon database BY HAND, before
-- this migration had a journal entry, so they exist there while
-- drizzle.__drizzle_migrations has no row for them. The generated form of this
-- file — bare CREATE TYPE, bare ADD COLUMN, bare CREATE INDEX — therefore
-- aborted `drizzle-kit migrate` on its first statement with
-- `type "inspiration_visibility" already exists`, and took 0003..0010 down
-- with it: nine migrations unreachable behind one that could not re-run.
--
-- Guarding them is the repo's existing convention, not a new one — 0003 uses
-- CREATE OR REPLACE and DROP TRIGGER IF EXISTS, and 0006/0007/0008 use
-- IF NOT EXISTS throughout. 0002 was the only migration that could not survive
-- meeting its own effects. The guards are also what make this file honest on a
-- FRESH database, where all three objects are still created exactly as before.
DO $$ BEGIN
  CREATE TYPE "public"."inspiration_visibility" AS ENUM('private', 'public');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

ALTER TABLE "inspirations" ADD COLUMN IF NOT EXISTS "visibility" "inspiration_visibility" DEFAULT 'private' NOT NULL;--> statement-breakpoint

-- The room field's read: every public capture by a set of profiles, newest
-- first. Partial on 'public' because the private rows are the overwhelming
-- majority and never take this path.
--
-- Hand-written, and it stays that way until the index is declared in
-- `schema-inspirations.ts`: `drizzle-kit generate` emitted the enum and the
-- column above and nothing else, because it can only generate what the TS
-- schema declares. That asymmetry is exactly how this file came to be orphaned
-- in the first place.
CREATE INDEX IF NOT EXISTS "inspirations_public_profile_created_idx"
  ON "inspirations" ("profile_id", "created_at" DESC)
  WHERE "visibility" = 'public';
