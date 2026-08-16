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
CREATE TYPE "inspiration_visibility" AS ENUM ('private', 'public');

ALTER TABLE "inspirations"
  ADD COLUMN "visibility" "inspiration_visibility" NOT NULL DEFAULT 'private';

-- The room field's read: every public capture by a set of profiles, newest
-- first. Partial on 'public' because the private rows are the overwhelming
-- majority and never take this path.
CREATE INDEX "inspirations_public_profile_created_idx"
  ON "inspirations" ("profile_id", "created_at" DESC)
  WHERE "visibility" = 'public';
