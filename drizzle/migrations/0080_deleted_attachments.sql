ALTER TABLE "deleted_inspirations" ADD COLUMN "attachments" jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint
CREATE INDEX "deleted_inspirations_attachments_idx" ON "deleted_inspirations" USING gin ("attachments" jsonb_path_ops);
