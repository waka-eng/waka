CREATE TABLE "conversation_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"profile_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_messages_position_unique" UNIQUE("profile_id","conversation_id","position"),
	CONSTRAINT "conversation_messages_bounds" CHECK ("conversation_messages"."position" BETWEEN 1 AND 200 AND "conversation_messages"."role" IN ('user','assistant') AND length(trim("conversation_messages"."content")) > 0 AND length("conversation_messages"."content") <= 4000)
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"profile_id" uuid NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "conversations_owner_identity" UNIQUE("profile_id","id"),
	CONSTRAINT "conversations_revision_bounds" CHECK ("conversations"."revision" BETWEEN 0 AND 200)
);
--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_conversation_fk" FOREIGN KEY ("profile_id","conversation_id") REFERENCES "public"."conversations"("profile_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversations_owner_updated_idx" ON "conversations" USING btree ("profile_id","updated_at");