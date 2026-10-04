CREATE TABLE "inspiration_conversation_origins" (
	"inspiration_id" uuid PRIMARY KEY NOT NULL,
	"profile_id" uuid NOT NULL,
	"conversation_id" uuid,
	"message_id" uuid,
	"authorship" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_origins_authorship_check" CHECK ("inspiration_conversation_origins"."authorship" IN ('user','adopted')),
	CONSTRAINT "conversation_origins_source_check" CHECK (("inspiration_conversation_origins"."conversation_id" IS NULL) = ("inspiration_conversation_origins"."message_id" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "inspiration_conversation_origins" ADD CONSTRAINT "conversation_origins_inspiration_fk" FOREIGN KEY ("profile_id","inspiration_id") REFERENCES "public"."inspirations"("profile_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspiration_conversation_origins" ADD CONSTRAINT "conversation_origins_message_fk" FOREIGN KEY ("profile_id","conversation_id","message_id") REFERENCES "public"."conversation_messages"("profile_id","conversation_id","id") ON DELETE SET NULL("conversation_id","message_id") ON UPDATE no action;
