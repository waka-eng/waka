DO $$
BEGIN
  IF to_regclass('public."Inspiration"') IS NOT NULL THEN
    ALTER TABLE "Inspiration"
      ADD COLUMN IF NOT EXISTS "enrichmentStatus" TEXT NOT NULL DEFAULT 'PENDING';

    ALTER TABLE "Inspiration"
      ADD COLUMN IF NOT EXISTS "enrichmentEnqueuedAt" TIMESTAMP(3);

    ALTER TABLE "Inspiration"
      ADD COLUMN IF NOT EXISTS "enrichmentStartedAt" TIMESTAMP(3);

    ALTER TABLE "Inspiration"
      ADD COLUMN IF NOT EXISTS "enrichmentCompletedAt" TIMESTAMP(3);

    ALTER TABLE "Inspiration"
      ADD COLUMN IF NOT EXISTS "enrichmentFailedAt" TIMESTAMP(3);

    ALTER TABLE "Inspiration"
      ADD COLUMN IF NOT EXISTS "enrichmentAttemptCount" INTEGER NOT NULL DEFAULT 0;

    ALTER TABLE "Inspiration"
      ADD COLUMN IF NOT EXISTS "enrichmentLastError" JSONB;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "Inspiration_userId_enrichmentStatus_enrichmentEnqueuedAt_idx" ON "Inspiration"("userId", "enrichmentStatus", "enrichmentEnqueuedAt" DESC);

CREATE INDEX IF NOT EXISTS "Inspiration_enrichmentStatus_enrichmentEnqueuedAt_idx" ON "Inspiration"("enrichmentStatus", "enrichmentEnqueuedAt" DESC);
