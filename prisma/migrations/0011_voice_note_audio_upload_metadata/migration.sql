DO $$
BEGIN
  IF to_regclass('public."Inspiration"') IS NOT NULL THEN
    ALTER TABLE "Inspiration"
      ADD COLUMN IF NOT EXISTS "audioStorageKey" TEXT;

    ALTER TABLE "Inspiration"
      ADD COLUMN IF NOT EXISTS "audioStorageUrl" TEXT;

    ALTER TABLE "Inspiration"
      ADD COLUMN IF NOT EXISTS "audioMimeType" TEXT;

    ALTER TABLE "Inspiration"
      ADD COLUMN IF NOT EXISTS "audioSizeBytes" INTEGER;

    ALTER TABLE "Inspiration"
      ADD COLUMN IF NOT EXISTS "audioDurationSeconds" DOUBLE PRECISION;

    UPDATE "Inspiration"
    SET
      "audioStorageUrl" = COALESCE("audioStorageUrl", "mediaUrl"),
      "audioMimeType" = COALESCE(
        "audioMimeType",
        NULLIF(BTRIM("sourceMeta"->>'mimeType'), '')
      ),
      "audioSizeBytes" = COALESCE(
        "audioSizeBytes",
        CASE
          WHEN jsonb_typeof("sourceMeta"->'sizeBytes') = 'number'
            THEN ("sourceMeta"->>'sizeBytes')::INTEGER
          ELSE NULL
        END
      ),
      "audioDurationSeconds" = COALESCE(
        "audioDurationSeconds",
        CASE
          WHEN jsonb_typeof("sourceMeta"->'durationSeconds') = 'number'
            THEN ("sourceMeta"->>'durationSeconds')::DOUBLE PRECISION
          ELSE NULL
        END
      )
    WHERE "sourceType" = 'VOICE_NOTE';
  END IF;
END
$$;
