ALTER TABLE "wow_moments" ADD COLUMN IF NOT EXISTS "idempotency_key" text;--> statement-breakpoint
WITH keyed AS (
  SELECT
    wm."id",
    concat_ws(
      ':',
      'wow-moment-v1',
      wm."user_id"::text,
      (
        SELECT wmi."inspiration_id"::text
        FROM "wow_moment_inspirations" wmi
        WHERE wmi."wow_moment_id" = wm."id"
          AND wmi."role" = 'trigger'
        ORDER BY wmi."sort_order" ASC, wmi."created_at" ASC
        LIMIT 1
      ),
      wm."kind"::text,
      lower(regexp_replace(btrim(wm."title"), '\s+', ' ', 'g'))
    ) AS base_key
  FROM "wow_moments" wm
  WHERE wm."idempotency_key" IS NULL
    AND EXISTS (
      SELECT 1
      FROM "wow_moment_inspirations" wmi
      WHERE wmi."wow_moment_id" = wm."id"
        AND wmi."role" = 'trigger'
    )
), deduped AS (
  SELECT
    "id",
    CASE
      WHEN row_number() OVER (PARTITION BY base_key ORDER BY "id") = 1
        THEN base_key
      ELSE concat(base_key, ':legacy-dupe:', "id"::text)
    END AS idempotency_key
  FROM keyed
)
UPDATE "wow_moments" wm
SET "idempotency_key" = deduped.idempotency_key
FROM deduped
WHERE wm."id" = deduped."id";--> statement-breakpoint
WITH keyed AS (
  SELECT
    wm."id",
    concat_ws(
      ':',
      'wow-moment-v1',
      wm."user_id"::text,
      '',
      wm."kind"::text,
      lower(regexp_replace(btrim(wm."title"), '\s+', ' ', 'g'))
    ) AS base_key
  FROM "wow_moments" wm
  WHERE wm."idempotency_key" IS NULL
), deduped AS (
  SELECT
    "id",
    CASE
      WHEN row_number() OVER (PARTITION BY base_key ORDER BY "id") = 1
        THEN base_key
      ELSE concat(base_key, ':legacy-dupe:', "id"::text)
    END AS idempotency_key
  FROM keyed
)
UPDATE "wow_moments" wm
SET "idempotency_key" = deduped.idempotency_key
FROM deduped
WHERE wm."id" = deduped."id";--> statement-breakpoint
ALTER TABLE "wow_moments" ALTER COLUMN "idempotency_key" SET NOT NULL;--> statement-breakpoint
WITH duplicate_links AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "wow_moment_id", "inspiration_id"
      ORDER BY "sort_order" ASC, "created_at" ASC, "id" ASC
    ) AS duplicate_rank
  FROM "wow_moment_inspirations"
)
DELETE FROM "wow_moment_inspirations" wmi
USING duplicate_links
WHERE wmi."id" = duplicate_links."id"
  AND duplicate_links.duplicate_rank > 1;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "wow_moments_idempotency_key_unique_idx" ON "wow_moments" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "wow_moment_inspirations_moment_inspiration_unique_idx" ON "wow_moment_inspirations" USING btree ("wow_moment_id", "inspiration_id");