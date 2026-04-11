DO $$
BEGIN
  IF to_regclass('public."Inspiration"') IS NOT NULL THEN
    ALTER TABLE "Inspiration"
      ADD COLUMN IF NOT EXISTS "audioTranscriptionStatus" TEXT;

    UPDATE "Inspiration"
    SET
      "transcript" = COALESCE(
        NULLIF(BTRIM("transcript"), ''),
        NULLIF(BTRIM("rawContent"), '')
      ),
      "originalTranscript" = COALESCE(
        NULLIF(BTRIM("originalTranscript"), ''),
        NULLIF(BTRIM("transcript"), ''),
        NULLIF(BTRIM("rawContent"), '')
      ),
      "audioTranscriptionStatus" = COALESCE(
        NULLIF(BTRIM("audioTranscriptionStatus"), ''),
        CASE
          WHEN COALESCE(
            NULLIF(BTRIM("transcript"), ''),
            NULLIF(BTRIM("rawContent"), '')
          ) IS NOT NULL
            THEN 'COMPLETED'
          WHEN COALESCE("audioStorageUrl", "mediaUrl") IS NOT NULL
            THEN 'PENDING'
          ELSE NULL
        END
      )
    WHERE "sourceType" = 'VOICE_NOTE';
  END IF;
END
$$;
