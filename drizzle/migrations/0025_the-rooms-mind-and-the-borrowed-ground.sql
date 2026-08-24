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
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_mind_shape_check" CHECK (("type" = 'group' AND "account_id" IS NULL AND "group_id" IS NOT NULL) OR ("type" <> 'group' AND "account_id" IS NOT NULL AND "group_id" IS NULL));--> statement-breakpoint
-- Every room that already exists grows its mind now, so no code path ever
-- has to ask "does this room have one yet": creation writes it for new rooms
-- (same transaction as the group row), and this backfill settles the past.
INSERT INTO "profiles" ("account_id", "type", "name", "group_id")
SELECT NULL, 'group', g."name", g."id"
FROM "groups" g
WHERE NOT EXISTS (SELECT 1 FROM "profiles" p WHERE p."group_id" = g."id");
