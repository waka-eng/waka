-- 'group' is here, in the CREATE, rather than only in 0024's ALTER (2026-08-24).
--
-- A room's mind is a profile of a third kind, and 0024 adds that value to the
-- enum for databases that already exist. That is correct for THEM and fatal
-- for a FRESH one: drizzle runs every pending migration inside a single
-- transaction, and PostgreSQL refuses to use an enum value that was ADDED
-- earlier in the same uncommitted transaction — so 0025's shape CHECK, which
-- names 'group', aborted the entire first-time migration. Every new
-- environment, every CI database and every developer's first `pnpm db:migrate`
-- hit it; the dev database only survived because it was migrated by hand.
--
-- The restriction is specifically about values ADDED to a pre-existing type.
-- A value belonging to a type CREATED in the same transaction is usable
-- immediately, so naming it here fixes the fresh path completely, and 0024's
-- `ADD VALUE IF NOT EXISTS` becomes a verified no-op rather than a hazard.
-- Databases that already ran 0000 are untouched: the migrator decides what to
-- replay by timestamp alone and never re-reads this file.
CREATE TYPE "public"."profile_type" AS ENUM('human', 'agent', 'group');--> statement-breakpoint
CREATE TYPE "public"."inspiration_kind" AS ENUM('note', 'link', 'image', 'mixed');--> statement-breakpoint
CREATE TYPE "public"."inspiration_source" AS ENUM('app', 'agent');--> statement-breakpoint
CREATE TYPE "public"."attachment_enrichment_kind" AS ENUM('page_body', 'image_description');--> statement-breakpoint
CREATE TYPE "public"."attachment_enrichment_status" AS ENUM('pending', 'ready', 'failed', 'unavailable');--> statement-breakpoint
CREATE TYPE "public"."attachment_type" AS ENUM('link', 'image', 'file');--> statement-breakpoint
CREATE TYPE "public"."signal_status" AS ENUM('emerging', 'active', 'retired');--> statement-breakpoint
CREATE TYPE "public"."top_of_mind_entry_type" AS ENUM('pattern', 'tension', 'question', 'hypothesis', 'action');--> statement-breakpoint
CREATE TYPE "public"."top_of_mind_revision_reason" AS ENUM('initial', 'regenerated', 'no_change', 'member_proposal', 'human_edit');--> statement-breakpoint
CREATE TYPE "public"."top_of_mind_status" AS ENUM('live', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."group_member_role" AS ENUM('owner', 'member');--> statement-breakpoint
CREATE TYPE "public"."group_proposal_kind" AS ENUM('edit_entry', 'add_entry', 'remove_entry');--> statement-breakpoint
CREATE TYPE "public"."group_proposal_status" AS ENUM('open', 'accepted', 'declined');--> statement-breakpoint
CREATE TYPE "public"."background_job_status" AS ENUM('pending', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."background_job_type" AS ENUM('enrich_attachment', 'derive_signals', 'refresh_top_of_mind', 'refresh_group_top_of_mind');--> statement-breakpoint
CREATE TYPE "public"."feedback_target_type" AS ENUM('signal', 'top_of_mind_entry');--> statement-breakpoint
CREATE TYPE "public"."feedback_value" AS ENUM('true', 'partly', 'not_true');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text,
	"google_sub" text,
	"onboarding_completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"type" "profile_type" NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"avatar_url" text,
	"preferred_locale" text DEFAULT 'en-US' NOT NULL,
	"public_handle" text,
	"public_profile_enabled" boolean DEFAULT false NOT NULL,
	"public_top_of_mind_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"device_label" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cli_login_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"device_label" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inspirations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"text" text NOT NULL,
	"kind" "inspiration_kind",
	"source" "inspiration_source" DEFAULT 'app' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inspirations_profile_id_id_unique" UNIQUE("profile_id","id")
);
--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"inspiration_id" uuid NOT NULL,
	"type" "attachment_type" NOT NULL,
	"url" text NOT NULL,
	"name" text,
	"s3_key" text,
	"content_type" text,
	"size" bigint,
	"enrichment_status" "attachment_enrichment_status",
	"enrichment_kind" "attachment_enrichment_kind",
	"enrichment_text" text,
	"enrichment_error_reason" text,
	"enrichment_updated_at" timestamp with time zone,
	"final_url" text,
	"hostname" text,
	"title" text,
	"description" text,
	"site_name" text,
	"preview_image_url" text,
	"image_width" integer,
	"image_height" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reflections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"inspiration_id" uuid NOT NULL,
	"question" text NOT NULL,
	"answer" text,
	"skipped" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inspiration_embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"inspiration_id" uuid NOT NULL,
	"model" text NOT NULL,
	"dimensions" integer NOT NULL,
	"input_hash" text NOT NULL,
	"embedding" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signal_embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"signal_id" uuid NOT NULL,
	"model" text NOT NULL,
	"dimensions" integer NOT NULL,
	"input_hash" text NOT NULL,
	"embedding" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signal_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"signal_id" uuid NOT NULL,
	"inspiration_id" uuid NOT NULL,
	"reason" text,
	"quote" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signal_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"signal_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"statement" text NOT NULL,
	"status" "signal_status" DEFAULT 'emerging' NOT NULL,
	"confidence" integer DEFAULT 0 NOT NULL,
	"locked_at" timestamp with time zone,
	"unsupported_at" timestamp with time zone,
	"last_evidence_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signals_profile_id_id_unique" UNIQUE("profile_id","id")
);
--> statement-breakpoint
CREATE TABLE "top_of_mind_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"top_of_mind_id" uuid NOT NULL,
	"type" "top_of_mind_entry_type" NOT NULL,
	"body" text NOT NULL,
	"belief" text,
	"prompt" text,
	"locked_at" timestamp with time zone,
	"pinned_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "top_of_mind_entry_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"signal_id" uuid NOT NULL,
	"owner_profile_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "top_of_minds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid,
	"group_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"status" "top_of_mind_status" DEFAULT 'live' NOT NULL,
	"reason" "top_of_mind_revision_reason" DEFAULT 'initial' NOT NULL,
	"replaced_by_id" uuid,
	"replaced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "top_of_minds_owner_exclusive" CHECK (("top_of_minds"."profile_id" IS NOT NULL AND "top_of_minds"."group_id" IS NULL) OR ("top_of_minds"."profile_id" IS NULL AND "top_of_minds"."group_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "group_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"role" "group_member_role" DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"join_code" text NOT NULL,
	"created_by_profile_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "group_top_of_mind_affirmations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposal_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "group_top_of_mind_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"entry_id" uuid,
	"proposed_by_profile_id" uuid NOT NULL,
	"kind" "group_proposal_kind" NOT NULL,
	"status" "group_proposal_status" DEFAULT 'open' NOT NULL,
	"body" text,
	"rationale" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "background_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"type" "background_job_type" NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "background_job_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"last_error" text,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"target_type" "feedback_target_type" NOT NULL,
	"target_id" uuid NOT NULL,
	"value" "feedback_value" NOT NULL,
	"correction_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cli_login_codes" ADD CONSTRAINT "cli_login_codes_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspirations" ADD CONSTRAINT "inspirations_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_inspiration_fk" FOREIGN KEY ("profile_id","inspiration_id") REFERENCES "public"."inspirations"("profile_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reflections" ADD CONSTRAINT "reflections_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reflections" ADD CONSTRAINT "reflections_inspiration_fk" FOREIGN KEY ("profile_id","inspiration_id") REFERENCES "public"."inspirations"("profile_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspiration_embeddings" ADD CONSTRAINT "inspiration_embeddings_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspiration_embeddings" ADD CONSTRAINT "inspiration_embeddings_inspiration_fk" FOREIGN KEY ("profile_id","inspiration_id") REFERENCES "public"."inspirations"("profile_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_embeddings" ADD CONSTRAINT "signal_embeddings_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_embeddings" ADD CONSTRAINT "signal_embeddings_signal_fk" FOREIGN KEY ("profile_id","signal_id") REFERENCES "public"."signals"("profile_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_evidence" ADD CONSTRAINT "signal_evidence_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_evidence" ADD CONSTRAINT "signal_evidence_signal_fk" FOREIGN KEY ("profile_id","signal_id") REFERENCES "public"."signals"("profile_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_evidence" ADD CONSTRAINT "signal_evidence_inspiration_fk" FOREIGN KEY ("profile_id","inspiration_id") REFERENCES "public"."inspirations"("profile_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_shares" ADD CONSTRAINT "signal_shares_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_shares" ADD CONSTRAINT "signal_shares_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_shares" ADD CONSTRAINT "signal_shares_signal_fk" FOREIGN KEY ("profile_id","signal_id") REFERENCES "public"."signals"("profile_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signals" ADD CONSTRAINT "signals_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "top_of_mind_entries" ADD CONSTRAINT "top_of_mind_entries_top_of_mind_id_top_of_minds_id_fk" FOREIGN KEY ("top_of_mind_id") REFERENCES "public"."top_of_minds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "top_of_mind_entry_signals" ADD CONSTRAINT "top_of_mind_entry_signals_entry_id_top_of_mind_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."top_of_mind_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "top_of_mind_entry_signals" ADD CONSTRAINT "top_of_mind_entry_signals_signal_id_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "top_of_mind_entry_signals" ADD CONSTRAINT "top_of_mind_entry_signals_owner_profile_id_profiles_id_fk" FOREIGN KEY ("owner_profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "top_of_minds" ADD CONSTRAINT "top_of_minds_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "top_of_minds" ADD CONSTRAINT "top_of_minds_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_created_by_profile_id_profiles_id_fk" FOREIGN KEY ("created_by_profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_top_of_mind_affirmations" ADD CONSTRAINT "group_top_of_mind_affirmations_proposal_id_group_top_of_mind_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."group_top_of_mind_proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_top_of_mind_affirmations" ADD CONSTRAINT "group_top_of_mind_affirmations_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_top_of_mind_proposals" ADD CONSTRAINT "group_top_of_mind_proposals_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_top_of_mind_proposals" ADD CONSTRAINT "group_top_of_mind_proposals_entry_id_top_of_mind_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."top_of_mind_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_top_of_mind_proposals" ADD CONSTRAINT "group_top_of_mind_proposals_proposed_by_profile_id_profiles_id_fk" FOREIGN KEY ("proposed_by_profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "background_jobs" ADD CONSTRAINT "background_jobs_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_email_unique_idx" ON "accounts" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_google_sub_unique_idx" ON "accounts" USING btree ("google_sub");--> statement-breakpoint
CREATE INDEX "profiles_account_idx" ON "profiles" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_public_handle_unique_idx" ON "profiles" USING btree ("public_handle");--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_one_human_per_account_idx" ON "profiles" USING btree ("account_id") WHERE "profiles"."type" = 'human';--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_unique_idx" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_profile_idx" ON "sessions" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "cli_login_codes_code_hash_unique_idx" ON "cli_login_codes" USING btree ("code_hash");--> statement-breakpoint
CREATE INDEX "cli_login_codes_expires_at_idx" ON "cli_login_codes" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "inspirations_profile_created_idx" ON "inspirations" USING btree ("profile_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "inspirations_text_search_idx" ON "inspirations" USING gin (to_tsvector('simple', "text"));--> statement-breakpoint
CREATE INDEX "attachments_inspiration_idx" ON "attachments" USING btree ("inspiration_id");--> statement-breakpoint
CREATE INDEX "attachments_profile_idx" ON "attachments" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "reflections_inspiration_idx" ON "reflections" USING btree ("inspiration_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inspiration_embeddings_inspiration_model_idx" ON "inspiration_embeddings" USING btree ("inspiration_id","model");--> statement-breakpoint
CREATE INDEX "inspiration_embeddings_profile_idx" ON "inspiration_embeddings" USING btree ("profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "signal_embeddings_signal_model_idx" ON "signal_embeddings" USING btree ("signal_id","model");--> statement-breakpoint
CREATE INDEX "signal_embeddings_profile_idx" ON "signal_embeddings" USING btree ("profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "signal_evidence_signal_inspiration_unique_idx" ON "signal_evidence" USING btree ("signal_id","inspiration_id");--> statement-breakpoint
CREATE INDEX "signal_evidence_signal_idx" ON "signal_evidence" USING btree ("signal_id");--> statement-breakpoint
CREATE INDEX "signal_evidence_inspiration_idx" ON "signal_evidence" USING btree ("inspiration_id");--> statement-breakpoint
CREATE UNIQUE INDEX "signal_shares_signal_group_unique_idx" ON "signal_shares" USING btree ("signal_id","group_id");--> statement-breakpoint
CREATE INDEX "signal_shares_group_idx" ON "signal_shares" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "signals_profile_status_idx" ON "signals" USING btree ("profile_id","status");--> statement-breakpoint
CREATE INDEX "signals_profile_recency_idx" ON "signals" USING btree ("profile_id","last_evidence_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "top_of_mind_entries_top_of_mind_idx" ON "top_of_mind_entries" USING btree ("top_of_mind_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "top_of_mind_entry_signals_unique_idx" ON "top_of_mind_entry_signals" USING btree ("entry_id","signal_id");--> statement-breakpoint
CREATE INDEX "top_of_mind_entry_signals_entry_idx" ON "top_of_mind_entry_signals" USING btree ("entry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "top_of_minds_one_live_per_profile_idx" ON "top_of_minds" USING btree ("profile_id") WHERE "top_of_minds"."status" = 'live' AND "top_of_minds"."profile_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "top_of_minds_one_live_per_group_idx" ON "top_of_minds" USING btree ("group_id") WHERE "top_of_minds"."status" = 'live' AND "top_of_minds"."group_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "top_of_minds_profile_version_idx" ON "top_of_minds" USING btree ("profile_id","version" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "group_members_group_profile_unique_idx" ON "group_members" USING btree ("group_id","profile_id");--> statement-breakpoint
CREATE INDEX "group_members_profile_idx" ON "group_members" USING btree ("profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "groups_join_code_unique_idx" ON "groups" USING btree ("join_code");--> statement-breakpoint
CREATE UNIQUE INDEX "group_top_of_mind_affirmations_unique_idx" ON "group_top_of_mind_affirmations" USING btree ("proposal_id","profile_id");--> statement-breakpoint
CREATE INDEX "group_top_of_mind_proposals_group_status_idx" ON "group_top_of_mind_proposals" USING btree ("group_id","status");--> statement-breakpoint
CREATE INDEX "background_jobs_runnable_idx" ON "background_jobs" USING btree ("run_after","created_at") WHERE "background_jobs"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "background_jobs_profile_status_idx" ON "background_jobs" USING btree ("profile_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "background_jobs_idempotency_key_unique_idx" ON "background_jobs" USING btree ("idempotency_key") WHERE "background_jobs"."idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "background_jobs_active_top_of_mind_idx" ON "background_jobs" USING btree ("profile_id","type") WHERE "background_jobs"."type" = 'refresh_top_of_mind'::background_job_type AND "background_jobs"."status" IN ('pending'::background_job_status, 'running'::background_job_status);--> statement-breakpoint
CREATE INDEX "feedback_profile_target_idx" ON "feedback" USING btree ("profile_id","target_type","target_id");--> statement-breakpoint
CREATE INDEX "feedback_profile_created_idx" ON "feedback" USING btree ("profile_id","created_at" DESC NULLS LAST);