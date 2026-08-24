CREATE TYPE "public"."contradiction_resolution" AS ENUM('lock', 'verdict', 'dismissal');--> statement-breakpoint
CREATE TABLE "signal_contradictions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"a_signal_id" uuid NOT NULL,
	"b_signal_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"yielded_signal_id" uuid,
	"resolved_by" "contradiction_resolution"
);
--> statement-breakpoint
ALTER TABLE "signal_contradictions" ADD CONSTRAINT "signal_contradictions_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_contradictions" ADD CONSTRAINT "signal_contradictions_a_fk" FOREIGN KEY ("profile_id","a_signal_id") REFERENCES "public"."signals"("profile_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_contradictions" ADD CONSTRAINT "signal_contradictions_b_fk" FOREIGN KEY ("profile_id","b_signal_id") REFERENCES "public"."signals"("profile_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "signal_contradictions_pair_unique_idx" ON "signal_contradictions" USING btree ("a_signal_id","b_signal_id");--> statement-breakpoint
CREATE INDEX "signal_contradictions_a_idx" ON "signal_contradictions" USING btree ("a_signal_id");--> statement-breakpoint
CREATE INDEX "signal_contradictions_b_idx" ON "signal_contradictions" USING btree ("b_signal_id");