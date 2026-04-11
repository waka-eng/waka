DO $$
BEGIN
  IF to_regclass('public."Inspiration"') IS NOT NULL THEN
    ALTER TABLE "Inspiration"
      ADD COLUMN IF NOT EXISTS "enrichmentMaxAttemptCount" INTEGER NOT NULL DEFAULT 3;

    ALTER TABLE "Inspiration"
      ADD COLUMN IF NOT EXISTS "enrichmentLastFailureReason" TEXT;

    ALTER TABLE "Inspiration"
      ADD COLUMN IF NOT EXISTS "enrichmentLastFailureRetryability" TEXT;
  END IF;
END
$$;
