CREATE TABLE "mcp_reads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"key_kind" text NOT NULL,
	"key_id" uuid NOT NULL,
	"tool" text NOT NULL,
	"detail" text,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mcp_reads" ADD CONSTRAINT "mcp_reads_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mcp_reads_profile_read_idx" ON "mcp_reads" USING btree ("profile_id","read_at");