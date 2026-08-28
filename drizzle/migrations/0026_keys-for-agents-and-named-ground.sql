-- Keys for the agents, and a name for the ground.
--
-- Both from the 2026-08-17 meeting, both settled there as decisions:
--
-- 1. AGENT KEYS ("에이전트별 이름 및 API 키 발급"). An agent acts as itself:
--    its own profile, its own standing credential, issued once by the human
--    hand and revocable without touching anything else. Only the SHA-256 of
--    the secret lands here — the sessions table's posture, for the same
--    reason.
--
-- 2. EXPERIENCES ("프로젝트를 하지 말자, 엑스피리언스로 하자"). The unit an
--    agent's memories group under is a stretch of lived work, named by its
--    keeper, scoped to one profile. An inspiration may name at most one;
--    signals reach experiences through their evidence rather than a second
--    stored link, so the relation can never drift from the ground truth.
--
-- Nothing here touches an enum, so the batch-transaction rule that broke
-- 0024/0025 on existing databases does not arise; the static gate in
-- fresh-migrate.db.test.ts checks that claim rather than trusting it.
SET lock_timeout = '5s';--> statement-breakpoint
CREATE TABLE "agent_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"prefix" text NOT NULL,
	"label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);--> statement-breakpoint
ALTER TABLE "agent_keys" ADD CONSTRAINT "agent_keys_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_keys_token_hash_unique_idx" ON "agent_keys" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "agent_keys_profile_idx" ON "agent_keys" USING btree ("profile_id");--> statement-breakpoint
CREATE TABLE "experiences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "experiences_profile_id_id_unique" UNIQUE("profile_id","id")
);--> statement-breakpoint
ALTER TABLE "experiences" ADD CONSTRAINT "experiences_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "experiences_profile_name_unique_idx" ON "experiences" USING btree ("profile_id","name");--> statement-breakpoint
ALTER TABLE "inspirations" ADD COLUMN "experience_id" uuid;--> statement-breakpoint
-- The tenancy net, same shape as every child of inspirations: the pair FK
-- makes an inspiration that names another profile's experience unstorable.
-- SET NULL names its column (PostgreSQL 15+), because the bare form would
-- null profile_id along with it and orphan the memory from its keeper.
ALTER TABLE "inspirations" ADD CONSTRAINT "inspirations_experience_fk" FOREIGN KEY ("profile_id","experience_id") REFERENCES "public"."experiences"("profile_id","id") ON DELETE SET NULL ("experience_id") ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inspirations_experience_idx" ON "inspirations" USING btree ("experience_id") WHERE "experience_id" IS NOT NULL;--> statement-breakpoint
RESET lock_timeout;
