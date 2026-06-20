-- Add a nullable marker for accounts that have completed the lightweight
-- nickname/language onboarding step. Existing users are backfilled so demo and
-- pre-existing accounts are not forced through onboarding after deploy.
ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamp with time zone;
UPDATE users SET onboarding_completed_at = NOW() WHERE onboarding_completed_at IS NULL;
