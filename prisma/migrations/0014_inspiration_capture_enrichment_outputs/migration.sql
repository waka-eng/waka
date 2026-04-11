DO $$
BEGIN
  IF to_regclass('public."Inspiration"') IS NOT NULL THEN
    ALTER TABLE "Inspiration"
      ADD COLUMN IF NOT EXISTS "ocr_text" TEXT;

    ALTER TABLE "Inspiration"
      ADD COLUMN IF NOT EXISTS "generated_description" TEXT;

    ALTER TABLE "Inspiration"
      ADD COLUMN IF NOT EXISTS "processing_state" JSONB;

    UPDATE "Inspiration"
    SET
      "ocr_text" = COALESCE(
        "ocr_text",
        NULLIF(BTRIM("sourceMeta"->>'ocrText'), ''),
        NULLIF(BTRIM("transcript"), '')
      ),
      "generated_description" = COALESCE(
        "generated_description",
        NULLIF(BTRIM("sourceMeta"->>'description'), ''),
        NULLIF(BTRIM("transcript"), '')
      ),
      "processing_state" = COALESCE(
        "processing_state",
        CASE
          WHEN NULLIF(
            BTRIM(
              COALESCE(
                "sourceMeta"->>'description',
                "sourceMeta"->>'ocrText',
                "transcript"
              )
            ),
            ''
          ) IS NOT NULL
            THEN jsonb_build_object(
              'status',
              'COMPLETED',
              'fields',
              jsonb_build_object(
                'generatedDescription',
                jsonb_build_object('status', 'COMPLETED'),
                'ocrText',
                jsonb_build_object('status', 'COMPLETED')
              )
            )
          WHEN "enrichmentStatus" IS NOT NULL OR "enrichmentFields" IS NOT NULL
            THEN jsonb_strip_nulls(
              jsonb_build_object(
                'status',
                "enrichmentStatus",
                'fields',
                "enrichmentFields"
              )
            )
          ELSE NULL
        END
      )
    WHERE
      "ocr_text" IS NULL
      OR "generated_description" IS NULL
      OR "processing_state" IS NULL;
  END IF;
END
$$;
