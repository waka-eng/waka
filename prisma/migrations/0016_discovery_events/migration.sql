DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'DiscoveryEventType'
  ) THEN
    CREATE TYPE "DiscoveryEventType" AS ENUM (
      'CLUSTER_REASSIGNED'
    );
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "DiscoveryEvent" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "inspirationId" TEXT NOT NULL,
  "eventType" "DiscoveryEventType" NOT NULL,
  "previousClusterId" TEXT NOT NULL,
  "newClusterId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "DiscoveryEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "DiscoveryEvent_userId_createdAt_idx"
  ON "DiscoveryEvent"("userId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "DiscoveryEvent_userId_eventType_createdAt_idx"
  ON "DiscoveryEvent"("userId", "eventType", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "DiscoveryEvent_userId_inspirationId_createdAt_idx"
  ON "DiscoveryEvent"("userId", "inspirationId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "DiscoveryEvent_userId_previousClusterId_createdAt_idx"
  ON "DiscoveryEvent"("userId", "previousClusterId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "DiscoveryEvent_userId_newClusterId_createdAt_idx"
  ON "DiscoveryEvent"("userId", "newClusterId", "createdAt" DESC);

DO $$
BEGIN
  IF to_regclass('public."DiscoveryEvent"') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'DiscoveryEvent_userId_fkey'
    ) THEN
      ALTER TABLE "DiscoveryEvent"
        ADD CONSTRAINT "DiscoveryEvent_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id")
        ON DELETE CASCADE
        ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'DiscoveryEvent_userId_inspirationId_fkey'
    ) THEN
      ALTER TABLE "DiscoveryEvent"
        ADD CONSTRAINT "DiscoveryEvent_userId_inspirationId_fkey"
        FOREIGN KEY ("userId", "inspirationId") REFERENCES "Inspiration"("userId", "id")
        ON DELETE CASCADE
        ON UPDATE CASCADE;
    END IF;
  END IF;
END
$$;
