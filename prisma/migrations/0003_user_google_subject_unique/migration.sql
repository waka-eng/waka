DO $$
BEGIN
  IF to_regclass('public."User"') IS NOT NULL THEN
    ALTER TABLE "User"
      ADD COLUMN IF NOT EXISTS "google_subject" TEXT;

    IF to_regclass('public."Account"') IS NOT NULL THEN
      UPDATE "User" AS u
      SET "google_subject" = a."providerAccountId"
      FROM "Account" AS a
      WHERE a."userId" = u."id"
        AND a."provider" = 'google'
        AND u."google_subject" IS NULL;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM "User"
      WHERE "google_subject" IS NULL
    ) THEN
      RAISE EXCEPTION 'Cannot enforce User.googleSubject because existing rows are missing a Google subject.';
    END IF;

    ALTER TABLE "User"
      ALTER COLUMN "google_subject" SET NOT NULL;
  END IF;
END
$$;

DO $$
BEGIN
  IF to_regclass('public."User"') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM (
        SELECT "google_subject"
        FROM "User"
        GROUP BY "google_subject"
        HAVING COUNT(*) > 1
      ) AS duplicate_subjects
    ) THEN
      RAISE EXCEPTION 'Cannot enforce unique User.googleSubject because duplicate Google subjects already exist.';
    END IF;

    EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS "User_google_subject_key" ON "User" ("google_subject")';
  END IF;
END
$$;
