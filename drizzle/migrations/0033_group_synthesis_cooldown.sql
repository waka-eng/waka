-- Records when synthesis last *ran* for a group, whether or not it produced
-- anything. Without it an empty board re-runs a full synthesis pass on every
-- read, and a group that legitimately yields no notes (a solo group can never
-- produce one, since a group note must span two members) re-runs it forever.
--
-- Guarded like its neighbours so a partially-applied migration can be retried.
ALTER TABLE "groups" ADD COLUMN IF NOT EXISTS "last_synthesis_at" timestamp with time zone;
