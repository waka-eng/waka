DO $$
BEGIN
  IF to_regclass('public."Inspiration"') IS NOT NULL THEN
    ALTER TABLE "Inspiration"
      ADD COLUMN IF NOT EXISTS "photoStorageKey" TEXT;

    ALTER TABLE "Inspiration"
      ADD COLUMN IF NOT EXISTS "photoStorageUrl" TEXT;

    ALTER TABLE "Inspiration"
      ADD COLUMN IF NOT EXISTS "photoFileName" TEXT;

    ALTER TABLE "Inspiration"
      ADD COLUMN IF NOT EXISTS "photoMimeType" TEXT;

    ALTER TABLE "Inspiration"
      ADD COLUMN IF NOT EXISTS "photoSizeBytes" INTEGER;

    ALTER TABLE "Inspiration"
      ADD COLUMN IF NOT EXISTS "photoUploadStatus" TEXT;

    UPDATE "Inspiration"
    SET
      "photoStorageUrl" = COALESCE("photoStorageUrl", "mediaUrl"),
      "photoFileName" = COALESCE(
        "photoFileName",
        NULLIF(BTRIM("sourceMeta"->>'fileName'), '')
      ),
      "photoMimeType" = COALESCE(
        "photoMimeType",
        NULLIF(BTRIM("sourceMeta"->>'mimeType'), '')
      ),
      "photoSizeBytes" = COALESCE(
        "photoSizeBytes",
        CASE
          WHEN jsonb_typeof("sourceMeta"->'sizeBytes') = 'number'
            THEN ("sourceMeta"->>'sizeBytes')::INTEGER
          ELSE NULL
        END
      ),
      "photoUploadStatus" = COALESCE(
        NULLIF(BTRIM("photoUploadStatus"), ''),
        CASE
          WHEN COALESCE("photoStorageUrl", "mediaUrl") IS NOT NULL
            THEN 'UPLOADED'
          ELSE 'PENDING_UPLOAD'
        END
      )
    WHERE "sourceType" = 'PHOTO';
  END IF;
END
$$;
