-- A wrong password has never cost anything.
--
-- POST /api/auth/login had no rate limit, no cooldown, and no record that an
-- attempt had ever failed. One request per guess, forever. And /signup answers
-- 409 for an address that already exists, so an attacker could first confirm
-- that a target is registered here and then guess its password at whatever
-- rate the network allowed.
--
-- This table is the memory that makes the next guess cost something. One row
-- per bucket — the address being guessed at, the place the guesses come from,
-- the browser that has signed in here before — holding a counter and the
-- moment its window opened. Not one row per attempt: an audit log of failed
-- logins is a table an unauthenticated stranger can grow without limit.
--
-- The key is HMAC-SHA-256 of "<scope>:<value>" under the app secret, never the
-- value. Both inputs are low-entropy (an email address, an IPv4 address), so a
-- plain digest would be reversible by enumeration and this table would be a
-- readable log of who tried to sign in to what, from where — including for
-- addresses that have no account here at all.
--
-- No foreign key to accounts, deliberately. Most rows are for addresses that
-- do not exist as accounts, and that is the point: a bucket that only appeared
-- for real accounts would answer "is this address registered?" by existing.
CREATE TABLE IF NOT EXISTS login_failures (
  key_hash text PRIMARY KEY,
  scope text NOT NULL,
  failures integer NOT NULL DEFAULT 0,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- A row is dead the moment its window closes, and the sweep that reaps them
-- runs at most once per window per process. Without this index that sweep is a
-- full scan of a table whose size an attacker gets a say in.
CREATE INDEX IF NOT EXISTS login_failures_window_started_at_idx
  ON login_failures (window_started_at);
