-- OPERATIONAL NOTE, added on review (2026-08-24).
--
-- Three statements below rewrite or re-scan `signal_evidence`, the largest
-- table in the system: `SET NOT NULL` scans it, re-adding the composite
-- foreign key validates every row, and the new index builds under a lock that
-- blocks writes. On an empty or young table that is milliseconds. On a large
-- one it is minutes of ACCESS EXCLUSIVE, and the danger is not the wait
-- itself — it is the QUEUE. A lock request waits behind whatever is running,
-- and every reader and writer that arrives afterwards waits behind the lock
-- request. One slow query at the wrong moment turns a fast migration into a
-- full stop on the table.
--
-- `lock_timeout` is the fix that fits here. drizzle runs an entire migration
-- set inside ONE transaction, so splitting this into `NOT VALID` + `VALIDATE`
-- would buy nothing: the locks are held until the commit either way. What a
-- timeout does buy is a clean, immediate failure instead of a pileup — the
-- transaction rolls back, nothing is half-applied, and the deploy is retried
-- in a quieter minute. A plain `SET` is the right form: PostgreSQL rolls it
-- back with the transaction if this fails, and the `RESET` at the foot
-- returns the pooled connection to normal when it succeeds.
--
-- IF THIS EVER TIMES OUT ON A LARGE TABLE, the escape hatch is to do the work
-- outside the migrator, where a transaction is not being held for you:
-- add the column, backfill in batches, add the FK `NOT VALID` and then
-- `VALIDATE CONSTRAINT` it, `CREATE INDEX CONCURRENTLY` (which cannot run in
-- a transaction at all, and so can never be in this file), and finally insert
-- this migration's row into `drizzle.__drizzle_migrations` by hand so the
-- migrator skips it. The migrator compares only `created_at` against the
-- journal, never the hash, so a hand-applied migration is indistinguishable
-- from a replayed one.
SET lock_timeout = '5s';--> statement-breakpoint
-- The room's mind, and the ground it borrows.
--
-- Founder rulings, 2026-08-24, all four in one sitting:
--   - sharing stays ONE SWITCH: a public memory stands on every one of its
--     owner's rooms' grounds (visibility stays global and two-valued);
--   - a room creates signals from that pooled ground — x memories from one
--     person, y from another, z from a third, distilled together;
--   - a room's signal APPEARS only once memories from at least two different
--     members stand under it (a one-member pattern is that person's own,
--     already on their own wall, and must not wear the room's name);
--   - those signals feed the room's top of mind through the same synthesis
--     pipeline, and "say out loud" retires as the way statements reach a room.
--
-- Two structural facts make that possible, both here:
--
-- 1. THE ROOM'S MIND IS A PROFILE. `profile_type` gained 'group' in 0024;
--    this file lets such a profile belong to a ROOM instead of an account:
--    `account_id` becomes nullable, `group_id` arrives, and a CHECK pins the
--    shape — a group mind has a group and no account, everything else has an
--    account and no group. Deleting the room cascades through `group_id` and
--    takes the mind, its signals, their evidence and their embeddings with
--    it; erasing a member's ACCOUNT never touches it, because it was never
--    the member's. Every account-scoped query in the system filters on
--    `account_id = $x`, which a NULL can never satisfy, so a room's mind is
--    invisible to all of them by construction rather than by remembering to
--    exclude it.
--
-- 2. EVIDENCE LEARNS WHOSE MEMORY IT CITES. `signal_evidence` carried one
--    profile for both ends — the signal's owner and the memory's — enforced
--    by two composite foreign keys, which is exactly right for a personal
--    signal and physically unstorable for a room's (a room signal cites a
--    MEMBER's memory). `owner_profile_id` splits the second claim out: the
--    row still belongs to the signal's profile, and the inspiration key now
--    runs through the owner. For every existing row the two are the same
--    profile, which is what the backfill writes. The tenancy net does not
--    loosen: an evidence row still cannot name an inspiration its stated
--    owner does not hold, and it still cannot name a signal outside its own
--    profile — the room case adds a lawful pairing, not a hole.
ALTER TABLE "signal_evidence" ADD COLUMN "owner_profile_id" uuid;--> statement-breakpoint
UPDATE "signal_evidence" SET "owner_profile_id" = "profile_id";--> statement-breakpoint
ALTER TABLE "signal_evidence" ALTER COLUMN "owner_profile_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "signal_evidence" DROP CONSTRAINT "signal_evidence_inspiration_fk";--> statement-breakpoint
ALTER TABLE "signal_evidence" ADD CONSTRAINT "signal_evidence_inspiration_fk" FOREIGN KEY ("owner_profile_id","inspiration_id") REFERENCES "public"."inspirations"("profile_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- The two-voices gate is a COUNT(DISTINCT owner_profile_id) per signal, read
-- on every wall serve and every synthesis; this is its index.
CREATE INDEX "signal_evidence_signal_owner_idx" ON "signal_evidence" USING btree ("signal_id","owner_profile_id");--> statement-breakpoint
ALTER TABLE "profiles" ALTER COLUMN "account_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "group_id" uuid;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- One mind per room.
CREATE UNIQUE INDEX "profiles_group_mind_unique_idx" ON "profiles" USING btree ("group_id") WHERE "group_id" IS NOT NULL;--> statement-breakpoint
-- COMPARED AS TEXT, and that is not a style choice. On a database that
-- already exists, 0024 adds 'group' to a type that was committed long ago,
-- and PostgreSQL refuses to USE a value added earlier in the same
-- uncommitted transaction — which is what drizzle gives us, since it applies
-- every pending migration in one. `"type" = 'group'` is such a use and
-- aborted the whole migration. `"type"::text = 'group'` is a text
-- comparison: it never resolves an enum value, so it is safe here and means
-- exactly the same thing. Verified against a server, both ways round.
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_mind_shape_check" CHECK (("type"::text = 'group' AND "account_id" IS NULL AND "group_id" IS NOT NULL) OR ("type"::text <> 'group' AND "account_id" IS NOT NULL AND "group_id" IS NULL));--> statement-breakpoint
-- THE BACKFILL IS NOT HERE, AND CANNOT BE.
--
-- Every room that already exists needs a mind, so that no code path has to
-- ask "does this room have one yet". That INSERT used to live here, and it
-- is the reason this migration could not be applied to any database that
-- already existed: writing a row whose `type` is 'group' RESOLVES the enum
-- value, and the value was added by 0024 in this same uncommitted
-- transaction. Every form of it fails — a literal, a cast, a lookup through
-- `pg_enum` — because they all end up in the enum's input function, which is
-- where the refusal lives. Only the CHECK above could be rewritten to avoid
-- resolving anything; a row cannot.
--
-- So the backfill moved to where a separate transaction is available:
-- `ensureGroupMinds()` in `routes/groups-membership.ts`, run by the API at
-- startup. It is the same idempotent statement, it is safe to run any number
-- of times, and it needs no operator to remember it.
--> statement-breakpoint
RESET lock_timeout;
