-- A key for the keeper.
--
-- Founder ask, 2026-08-29, completing that day's ruling: with agents unable
-- to capture into the human profile, the person gets a standing credential
-- of their own — keep and recall over MCP without the browser consent
-- dance, revocable from the account. The mirror of agent_keys with the
-- binding reversed (a HUMAN profile only, enforced in code at issue and
-- lookup) and the power inverted: the session it resolves to is scoped to
-- read + capture on its own profile, decided in resolveProfileAccess.
--
-- Same secret posture as agent_keys and sessions: only the SHA-256 lands;
-- the prefix column exists so a list can tell keys apart without being
-- worth stealing. Revocation is a timestamp, never a delete.
--
-- No enum is touched, so the batch-transaction rule that broke 0024/0025 on
-- existing databases does not arise.
SET lock_timeout = '5s';--> statement-breakpoint
CREATE TABLE "keeper_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"prefix" text NOT NULL,
	"label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);--> statement-breakpoint
ALTER TABLE "keeper_keys" ADD CONSTRAINT "keeper_keys_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "keeper_keys_token_hash_unique_idx" ON "keeper_keys" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "keeper_keys_profile_idx" ON "keeper_keys" USING btree ("profile_id");
