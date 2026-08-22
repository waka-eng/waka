CREATE TYPE "public"."evidence_quote_source" AS ENUM('own', 'enrichment');--> statement-breakpoint
ALTER TABLE "signal_evidence" ADD COLUMN "quote_source" "evidence_quote_source";