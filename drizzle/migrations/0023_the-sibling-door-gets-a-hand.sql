CREATE TABLE "agent_read_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"grantee_profile_id" uuid NOT NULL,
	"target_profile_id" uuid NOT NULL,
	"granted_by_profile_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "agent_read_grants" ADD CONSTRAINT "agent_read_grants_grantee_profile_id_profiles_id_fk" FOREIGN KEY ("grantee_profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_read_grants" ADD CONSTRAINT "agent_read_grants_target_profile_id_profiles_id_fk" FOREIGN KEY ("target_profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_read_grants" ADD CONSTRAINT "agent_read_grants_granted_by_profile_id_profiles_id_fk" FOREIGN KEY ("granted_by_profile_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_read_grants_grantee_target_idx" ON "agent_read_grants" USING btree ("grantee_profile_id","target_profile_id");