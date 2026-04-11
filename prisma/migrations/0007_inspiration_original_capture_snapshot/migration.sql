DO $$
BEGIN
  IF to_regclass('public."Inspiration"') IS NOT NULL THEN
    ALTER TABLE "Inspiration"
      ADD COLUMN IF NOT EXISTS "originalTitle" TEXT;

    ALTER TABLE "Inspiration"
      ADD COLUMN IF NOT EXISTS "originalRawContent" TEXT;

    ALTER TABLE "Inspiration"
      ADD COLUMN IF NOT EXISTS "originalSourceUrl" TEXT;

    ALTER TABLE "Inspiration"
      ADD COLUMN IF NOT EXISTS "originalSourceMeta" JSONB;

    ALTER TABLE "Inspiration"
      ADD COLUMN IF NOT EXISTS "originalMediaUrl" TEXT;

    ALTER TABLE "Inspiration"
      ADD COLUMN IF NOT EXISTS "originalTranscript" TEXT;

    UPDATE "Inspiration"
    SET
      "originalTitle" = COALESCE("originalTitle", "title"),
      "originalRawContent" = COALESCE("originalRawContent", "rawContent"),
      "originalSourceUrl" = COALESCE("originalSourceUrl", "sourceUrl"),
      "originalSourceMeta" = COALESCE("originalSourceMeta", "sourceMeta"),
      "originalMediaUrl" = COALESCE("originalMediaUrl", "mediaUrl"),
      "originalTranscript" = COALESCE("originalTranscript", "transcript")
    WHERE
      "originalTitle" IS NULL
      OR "originalRawContent" IS NULL
      OR "originalSourceUrl" IS NULL
      OR "originalSourceMeta" IS NULL
      OR "originalMediaUrl" IS NULL
      OR "originalTranscript" IS NULL;

    ALTER TABLE "Inspiration"
      ALTER COLUMN "originalRawContent" SET NOT NULL;
  END IF;
END
$$;
