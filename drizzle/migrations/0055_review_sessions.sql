CREATE TABLE "review_items" (
	"profile_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"inspiration_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"source_revision" bigint NOT NULL,
	"reason" text NOT NULL,
	"choice" text,
	"decided_at" timestamp with time zone,
	CONSTRAINT "review_items_profile_id_session_id_inspiration_id_pk" PRIMARY KEY("profile_id","session_id","inspiration_id"),
	CONSTRAINT "review_items_position_unique" UNIQUE("profile_id","session_id","position"),
	CONSTRAINT "review_items_bounds" CHECK ("review_items"."position" BETWEEN 0 AND 4 AND "review_items"."source_revision" > 0),
	CONSTRAINT "review_items_reason_check" CHECK ("review_items"."reason" IN ('unreviewed','revisit','chosen')),
	CONSTRAINT "review_items_choice_check" CHECK (("review_items"."choice" IS NULL AND "review_items"."decided_at" IS NULL) OR ("review_items"."choice" IS NOT NULL AND "review_items"."choice" IN ('keep','skip') AND "review_items"."decided_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "review_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"profile_id" uuid NOT NULL,
	"input_hash" text NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"cursor" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "review_sessions_owner_identity" UNIQUE("profile_id","id"),
	CONSTRAINT "review_sessions_bounds" CHECK ("review_sessions"."revision" >= 0 AND "review_sessions"."cursor" BETWEEN 0 AND 5)
);
--> statement-breakpoint
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_session_fk" FOREIGN KEY ("profile_id","session_id") REFERENCES "public"."review_sessions"("profile_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_source_fk" FOREIGN KEY ("profile_id","inspiration_id") REFERENCES "public"."inspirations"("profile_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_sessions" ADD CONSTRAINT "review_sessions_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "review_items_source_idx" ON "review_items" USING btree ("profile_id","inspiration_id");--> statement-breakpoint
CREATE UNIQUE INDEX "review_sessions_one_open" ON "review_sessions" USING btree ("profile_id") WHERE "review_sessions"."completed_at" IS NULL;
