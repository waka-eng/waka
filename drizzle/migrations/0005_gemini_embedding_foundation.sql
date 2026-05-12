ALTER TABLE "inspirations" ADD CONSTRAINT "inspirations_user_id_id_unique_idx" UNIQUE("user_id","id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inspiration_embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"inspiration_id" uuid NOT NULL,
	"model" text NOT NULL,
	"dimensions" integer NOT NULL,
	"input_hash" text NOT NULL,
	"embedding" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inspiration_embeddings" ADD CONSTRAINT "inspiration_embeddings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inspiration_embeddings" ADD CONSTRAINT "inspiration_embeddings_inspiration_id_inspirations_id_fk" FOREIGN KEY ("inspiration_id") REFERENCES "public"."inspirations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inspiration_embeddings" ADD CONSTRAINT "inspiration_embeddings_user_inspiration_fk" FOREIGN KEY ("user_id","inspiration_id") REFERENCES "public"."inspirations"("user_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "inspiration_embeddings_inspiration_unique_idx" ON "inspiration_embeddings" USING btree ("inspiration_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inspiration_embeddings_user_inspiration_idx" ON "inspiration_embeddings" USING btree ("user_id","inspiration_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inspiration_embeddings_user_model_idx" ON "inspiration_embeddings" USING btree ("user_id","model");
