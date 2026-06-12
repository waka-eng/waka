CREATE TYPE "document_type" AS ENUM('signal', 'top_of_mind_note', 'context_node', 'context_edge');--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"doc_type" "document_type" NOT NULL,
	"path" text NOT NULL,
	"content_hash" text NOT NULL,
	"rev" integer DEFAULT 1 NOT NULL,
	"search_text" text,
	"cluster" "cluster",
	"importance_score" integer,
	"wow_score" integer,
	"created_at" timestamp with time zone,
	"indexed_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "documents_user_path_unique_idx" ON "documents" USING btree ("user_id","path");--> statement-breakpoint
CREATE INDEX "documents_user_type_created_idx" ON "documents" USING btree ("user_id","doc_type","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "documents_user_type_score_idx" ON "documents" USING btree ("user_id","doc_type","wow_score" DESC NULLS LAST);
