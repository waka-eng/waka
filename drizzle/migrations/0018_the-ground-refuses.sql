CREATE TABLE "suppressions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"anchor_signal_id" uuid,
	"anchor_statement" text NOT NULL,
	"inspiration_id" uuid,
	"candidate_statement" text NOT NULL,
	"similarity" double precision NOT NULL,
	"suppressed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "dismissed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "suppressions" ADD CONSTRAINT "suppressions_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppressions" ADD CONSTRAINT "suppressions_anchor_signal_id_signals_id_fk" FOREIGN KEY ("anchor_signal_id") REFERENCES "public"."signals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppressions" ADD CONSTRAINT "suppressions_inspiration_id_inspirations_id_fk" FOREIGN KEY ("inspiration_id") REFERENCES "public"."inspirations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "suppressions_profile_suppressed_idx" ON "suppressions" USING btree ("profile_id","suppressed_at");--> statement-breakpoint
CREATE INDEX "suppressions_anchor_idx" ON "suppressions" USING btree ("anchor_signal_id");