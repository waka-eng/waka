DO $$
BEGIN
  IF to_regclass('public."Inspiration"') IS NOT NULL THEN
    ALTER TABLE "Inspiration"
      ADD COLUMN IF NOT EXISTS "sourceParentId" TEXT;

    WITH RECURSIVE inspiration_lineage AS (
      SELECT
        child."id" AS "childId",
        child."parentId" AS "ancestorId",
        1 AS "depth"
      FROM "Inspiration" child
      WHERE child."parentId" IS NOT NULL

      UNION ALL

      SELECT
        lineage."childId",
        parent."parentId" AS "ancestorId",
        lineage."depth" + 1 AS "depth"
      FROM inspiration_lineage lineage
      INNER JOIN "Inspiration" parent
        ON parent."id" = lineage."ancestorId"
      WHERE parent."parentId" IS NOT NULL
    ),
    root_parent AS (
      SELECT DISTINCT ON ("childId")
        "childId",
        "ancestorId" AS "sourceParentId"
      FROM inspiration_lineage
      ORDER BY "childId", "depth" DESC
    )
    UPDATE "Inspiration" child
    SET "sourceParentId" = root_parent."sourceParentId"
    FROM root_parent
    WHERE child."id" = root_parent."childId"
      AND child."sourceParentId" IS NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "Inspiration_userId_sourceParentId_createdAt_idx" ON "Inspiration"("userId", "sourceParentId", "createdAt" DESC);

ALTER TABLE "Inspiration"
ADD CONSTRAINT "Inspiration_sourceParentId_fkey"
FOREIGN KEY ("sourceParentId") REFERENCES "Inspiration"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;
