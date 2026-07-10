ALTER TABLE "top_of_mind_notes" ADD COLUMN "semantic_key" text;--> statement-breakpoint
ALTER TABLE "top_of_mind_notes" ADD COLUMN "evidence_fingerprint" text;--> statement-breakpoint
ALTER TABLE "top_of_mind_notes" ADD COLUMN "lifecycle_status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "top_of_mind_notes" ADD COLUMN "replaced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "top_of_mind_notes" ADD COLUMN "replaced_by_id" uuid;--> statement-breakpoint
UPDATE "top_of_mind_notes" SET "wow_score" = greatest(0, least(100, "wow_score"));--> statement-breakpoint
WITH "legacy_identity" AS (
	SELECT
		"note"."id",
		"note"."user_id",
		CASE
			WHEN "note"."idempotency_key" LIKE 'top_of_mind_context_node:v2:%'
				THEN 'context_node:' || split_part("note"."idempotency_key", ':', 4)
			ELSE 'wow_judgment:' || array_to_string((array_agg("link"."signal_id"::text ORDER BY "signal"."created_at", "signal"."id"))[1:2], E'\n')
		END AS "semantic_key",
		md5(string_agg("link"."signal_id"::text, E'\n' ORDER BY "link"."signal_id"::text)) AS "evidence_fingerprint",
		row_number() OVER (
			PARTITION BY "note"."user_id",
				CASE
					WHEN "note"."idempotency_key" LIKE 'top_of_mind_context_node:v2:%'
						THEN 'context_node:' || split_part("note"."idempotency_key", ':', 4)
					ELSE 'wow_judgment:' || array_to_string((array_agg("link"."signal_id"::text ORDER BY "signal"."created_at", "signal"."id"))[1:2], E'\n')
				END,
				md5(string_agg("link"."signal_id"::text, E'\n' ORDER BY "link"."signal_id"::text))
			ORDER BY "note"."created_at" DESC, "note"."id" DESC
		) AS "identity_rank"
	FROM "top_of_mind_notes" AS "note"
	JOIN "top_of_mind_note_signals" AS "link"
		ON "link"."top_of_mind_note_id" = "note"."id" AND "link"."user_id" = "note"."user_id"
	JOIN "signals" AS "signal"
		ON "signal"."id" = "link"."signal_id" AND "signal"."user_id" = "link"."user_id"
	GROUP BY "note"."id", "note"."user_id", "note"."idempotency_key", "note"."created_at"
)
UPDATE "top_of_mind_notes" AS "note"
SET "semantic_key" = "legacy_identity"."semantic_key",
	"evidence_fingerprint" = "legacy_identity"."evidence_fingerprint"
FROM "legacy_identity"
WHERE "note"."id" = "legacy_identity"."id" AND "legacy_identity"."identity_rank" = 1;--> statement-breakpoint
WITH "active_family" AS (
	SELECT
		"id",
		first_value("id") OVER (
			PARTITION BY "user_id", "semantic_key"
			ORDER BY "created_at" DESC, "id" DESC
		) AS "winner_id",
		row_number() OVER (
			PARTITION BY "user_id", "semantic_key"
			ORDER BY "created_at" DESC, "id" DESC
		) AS "family_rank"
	FROM "top_of_mind_notes"
	WHERE "semantic_key" IS NOT NULL AND "lifecycle_status" = 'active'
)
UPDATE "top_of_mind_notes" AS "note"
SET "lifecycle_status" = 'replaced',
	"replaced_at" = now(),
	"replaced_by_id" = "active_family"."winner_id"
FROM "active_family"
WHERE "note"."id" = "active_family"."id" AND "active_family"."family_rank" > 1;--> statement-breakpoint
ALTER TABLE "top_of_mind_notes" ADD CONSTRAINT "top_of_mind_notes_replaced_by_fk" FOREIGN KEY ("user_id","replaced_by_id") REFERENCES "public"."top_of_mind_notes"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "top_of_mind_notes_generation_identity_unique_idx" ON "top_of_mind_notes" USING btree ("user_id","semantic_key","evidence_fingerprint") WHERE "top_of_mind_notes"."semantic_key" is not null and "top_of_mind_notes"."evidence_fingerprint" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "top_of_mind_notes_active_semantic_unique_idx" ON "top_of_mind_notes" USING btree ("user_id","semantic_key") WHERE "top_of_mind_notes"."lifecycle_status" = 'active' and "top_of_mind_notes"."semantic_key" is not null;--> statement-breakpoint
ALTER TABLE "top_of_mind_notes" ADD CONSTRAINT "top_of_mind_notes_wow_score_range_check" CHECK ("top_of_mind_notes"."wow_score" between 0 and 100);--> statement-breakpoint
ALTER TABLE "top_of_mind_notes" ADD CONSTRAINT "top_of_mind_notes_lifecycle_check" CHECK (("top_of_mind_notes"."lifecycle_status" = 'active' and "top_of_mind_notes"."replaced_at" is null and "top_of_mind_notes"."replaced_by_id" is null) or ("top_of_mind_notes"."lifecycle_status" = 'replaced' and "top_of_mind_notes"."replaced_at" is not null and ("top_of_mind_notes"."replaced_by_id" is null or "top_of_mind_notes"."replaced_by_id" <> "top_of_mind_notes"."id")));--> statement-breakpoint
ALTER TABLE "top_of_mind_notes" ADD CONSTRAINT "top_of_mind_notes_identity_pair_check" CHECK (("top_of_mind_notes"."semantic_key" is null) = ("top_of_mind_notes"."evidence_fingerprint" is null));