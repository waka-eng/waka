ALTER TABLE "feedback" ADD COLUMN "target_revision" bigint;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_target_revision_positive" CHECK ("feedback"."target_revision" > 0);