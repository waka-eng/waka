CREATE TYPE "public"."principle_origin" AS ENUM('minted', 'declared');--> statement-breakpoint
CREATE TYPE "public"."principle_state" AS ENUM('held', 'aspirational', 'contested');--> statement-breakpoint
CREATE TYPE "public"."principle_type" AS ENUM('value', 'maxim', 'stance');--> statement-breakpoint
ALTER TYPE "public"."feedback_target_type" ADD VALUE 'principle';--> statement-breakpoint
CREATE TABLE "principle_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"principle_id" uuid NOT NULL,
	"signal_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "principles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"statement" text NOT NULL,
	"type" "principle_type" DEFAULT 'maxim' NOT NULL,
	"state" "principle_state" DEFAULT 'held' NOT NULL,
	"origin" "principle_origin" DEFAULT 'minted' NOT NULL,
	"rank" integer NOT NULL,
	"owner_ranked_at" timestamp with time zone,
	"locked_at" timestamp with time zone,
	"held_since" timestamp with time zone,
	"conflicts_with_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "principles_profile_id_id_unique" UNIQUE("profile_id","id")
);
--> statement-breakpoint
ALTER TABLE "principle_signals" ADD CONSTRAINT "principle_signals_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "principle_signals" ADD CONSTRAINT "principle_signals_principle_fk" FOREIGN KEY ("profile_id","principle_id") REFERENCES "public"."principles"("profile_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "principle_signals" ADD CONSTRAINT "principle_signals_signal_fk" FOREIGN KEY ("profile_id","signal_id") REFERENCES "public"."signals"("profile_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "principles" ADD CONSTRAINT "principles_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "principle_signals_principle_signal_unique_idx" ON "principle_signals" USING btree ("principle_id","signal_id");--> statement-breakpoint
CREATE INDEX "principle_signals_principle_idx" ON "principle_signals" USING btree ("principle_id");--> statement-breakpoint
CREATE INDEX "principle_signals_signal_idx" ON "principle_signals" USING btree ("signal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "principles_profile_rank_unique_idx" ON "principles" USING btree ("profile_id","rank");--> statement-breakpoint
CREATE INDEX "principles_profile_state_idx" ON "principles" USING btree ("profile_id","state");