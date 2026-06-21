-- Repair production databases where 0024 was recorded before the 0023
-- onboarding migration landed in the journal. Drizzle only applies migrations
-- newer than the latest recorded `created_at`, so it will not go back and run
-- 0023 after 0024 is already recorded.
ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamp with time zone;
UPDATE users SET onboarding_completed_at = NOW() WHERE onboarding_completed_at IS NULL;
