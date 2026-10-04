ALTER TABLE "conversations" ADD COLUMN "initial_principle_id" uuid;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_initial_principle_fk" FOREIGN KEY ("profile_id","initial_principle_id") REFERENCES "public"."principles"("profile_id","id") ON DELETE SET NULL("initial_principle_id") ON UPDATE no action;
