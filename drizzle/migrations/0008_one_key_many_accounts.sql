-- One account could spend the whole model budget, and nothing said otherwise.
--
-- Every background job ends in a call against a single shared Gemini key, and
-- the queue drained strictly oldest-first with no notion of whose work it was.
-- Ten thousand saves from one signup became thirty thousand jobs at the head
-- of the queue, and generation stopped working for everybody else until they
-- finished.
--
-- The fix meters starts per account over a rolling hour (see
-- packages/api/src/lib/model-budget.ts). Metering needs a fact the table did
-- not record: when a job actually began. `locked_at` cannot answer, because it
-- is cleared the moment the job settles — exactly when the spend it stands for
-- becomes the history the budget wants to count.
--
-- Null for every existing row, which is the truthful answer: nothing recorded
-- when those jobs ran, so they count as spend from before the window and the
-- first hour after deploy is simply generous.
ALTER TABLE background_jobs ADD COLUMN IF NOT EXISTS started_at timestamptz;

-- The budget query runs ahead of every claim, so it must not be a scan.
CREATE INDEX IF NOT EXISTS background_jobs_profile_started_at_idx
  ON background_jobs (profile_id, started_at);
