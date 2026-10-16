-- 0073 harvest: a reason in the person's own words. Founder, 2026-10-15:
-- "let user provide their own answers." `other` joins the five reasons and
-- carries `reason_note`, up to 280 characters, kept after the candidate's
-- words are deleted, because it is the person's answer, not the candidate.
ALTER TABLE "harvest_candidates" DROP CONSTRAINT "harvest_candidates_reason_check";--> statement-breakpoint
ALTER TABLE "harvest_candidates" ADD CONSTRAINT "harvest_candidates_reason_check" CHECK ("reason" IS NULL OR "reason" IN ('not_mine','already_kept','private','trivial','miscut','other'));--> statement-breakpoint
ALTER TABLE "harvest_candidates" ADD COLUMN "reason_note" text;--> statement-breakpoint
ALTER TABLE "harvest_candidates" ADD CONSTRAINT "harvest_candidates_reason_note_check" CHECK ("reason_note" IS NULL OR ("reason" = 'other' AND length("reason_note") BETWEEN 1 AND 280));
