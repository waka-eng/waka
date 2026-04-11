DO $$
BEGIN
  IF to_regclass('public."ApiKey"') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM "ApiKey"
    ) THEN
      RAISE EXCEPTION 'Cannot auto-migrate existing ApiKey rows to workspace-scoped records. Recreate existing keys after assigning them to a workspace.';
    END IF;

    ALTER TABLE "ApiKey"
      ADD COLUMN IF NOT EXISTS "tenantId" TEXT NOT NULL;

    ALTER TABLE "ApiKey"
      ADD COLUMN IF NOT EXISTS "workspaceId" TEXT NOT NULL;

    ALTER TABLE "ApiKey"
      ADD COLUMN IF NOT EXISTS "description" TEXT;

    ALTER TABLE "ApiKey"
      ADD COLUMN IF NOT EXISTS "keyPrefix" TEXT NOT NULL;

    ALTER TABLE "ApiKey"
      ADD COLUMN IF NOT EXISTS "metadata" JSONB;

    ALTER TABLE "ApiKey"
      ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "ApiKey_tenantId_workspaceId_idx" ON "ApiKey"("tenantId", "workspaceId");

CREATE INDEX IF NOT EXISTS "ApiKey_workspaceId_createdAt_idx" ON "ApiKey"("workspaceId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "ApiKey_userId_workspaceId_revokedAt_createdAt_idx" ON "ApiKey"("userId", "workspaceId", "revokedAt", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "ApiKey_userId_workspaceId_lastUsedAt_idx" ON "ApiKey"("userId", "workspaceId", "lastUsedAt" DESC);

ALTER TABLE "ApiKey"
ADD CONSTRAINT "ApiKey_tenantId_workspaceId_fkey"
FOREIGN KEY ("tenantId", "workspaceId") REFERENCES "Workspace"("tenantId", "id")
ON DELETE CASCADE
ON UPDATE CASCADE;
