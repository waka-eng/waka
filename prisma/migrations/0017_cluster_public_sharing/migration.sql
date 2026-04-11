ALTER TABLE "Cluster"
ADD COLUMN "isPublic" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "shareSlug" TEXT;

CREATE UNIQUE INDEX "Cluster_shareSlug_key" ON "Cluster"("shareSlug");
CREATE INDEX "Cluster_userId_isPublic_updatedAt_idx"
ON "Cluster"("userId", "isPublic", "updatedAt" DESC);
