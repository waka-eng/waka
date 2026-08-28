CREATE TYPE "public"."statement_reason" AS ENUM('derived', 'restated', 'minted', 'declared', 'edited', 'reverted');--> statement-breakpoint
CREATE TABLE "principle_statements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"principle_id" uuid NOT NULL,
	"statement" text NOT NULL,
	"reason" "statement_reason" NOT NULL,
	"superseded_by_id" uuid,
	"superseded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signal_statements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"signal_id" uuid NOT NULL,
	"statement" text NOT NULL,
	"reason" "statement_reason" NOT NULL,
	"superseded_by_id" uuid,
	"superseded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "principle_statements" ADD CONSTRAINT "principle_statements_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "principle_statements" ADD CONSTRAINT "principle_statements_principle_fk" FOREIGN KEY ("profile_id","principle_id") REFERENCES "public"."principles"("profile_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_statements" ADD CONSTRAINT "signal_statements_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_statements" ADD CONSTRAINT "signal_statements_signal_fk" FOREIGN KEY ("profile_id","signal_id") REFERENCES "public"."signals"("profile_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "principle_statements_current_unique_idx" ON "principle_statements" USING btree ("principle_id") WHERE "principle_statements"."superseded_at" is null;--> statement-breakpoint
CREATE INDEX "principle_statements_principle_idx" ON "principle_statements" USING btree ("principle_id");--> statement-breakpoint
CREATE UNIQUE INDEX "signal_statements_current_unique_idx" ON "signal_statements" USING btree ("signal_id") WHERE "signal_statements"."superseded_at" is null;--> statement-breakpoint
CREATE INDEX "signal_statements_signal_idx" ON "signal_statements" USING btree ("signal_id");