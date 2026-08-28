CREATE TYPE "public"."consultation_surface" AS ENUM('signals', 'top_of_mind', 'principles');--> statement-breakpoint
ALTER TYPE "public"."inspiration_kind" ADD VALUE 'decision';--> statement-breakpoint
CREATE TABLE "consultations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"session_id" uuid,
	"reader_profile_id" uuid,
	"surface" "consultation_surface" NOT NULL,
	"artifact_version" integer,
	"rendered_on" date,
	"served_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "decision_principle_citations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"inspiration_id" uuid NOT NULL,
	"principle_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "consultations" ADD CONSTRAINT "consultations_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultations" ADD CONSTRAINT "consultations_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultations" ADD CONSTRAINT "consultations_reader_profile_id_profiles_id_fk" FOREIGN KEY ("reader_profile_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_principle_citations" ADD CONSTRAINT "decision_citations_inspiration_fk" FOREIGN KEY ("profile_id","inspiration_id") REFERENCES "public"."inspirations"("profile_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_principle_citations" ADD CONSTRAINT "decision_citations_principle_fk" FOREIGN KEY ("profile_id","principle_id") REFERENCES "public"."principles"("profile_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "consultations_profile_served_idx" ON "consultations" USING btree ("profile_id","served_at");--> statement-breakpoint
CREATE UNIQUE INDEX "decision_citations_unique_idx" ON "decision_principle_citations" USING btree ("inspiration_id","principle_id");