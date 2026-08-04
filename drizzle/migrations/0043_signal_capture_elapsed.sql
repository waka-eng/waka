-- How long the composer was open before a save.
--
-- The pulse idea rests on a distinction the data could not make: a save that
-- happened before the reasons arrived is a reaction, and one written over
-- several minutes is a composition. `CombinationPulseProfile` has been shipping
-- with every save counted "unknown" because nothing recorded the duration.
--
-- Nullable forever. Saves made before this column existed genuinely do not know,
-- and a zero would be a lie about them — "unknown" is a real third answer here,
-- not a missing value to be filled in.

ALTER TABLE "signals"
	ADD COLUMN IF NOT EXISTS "capture_elapsed_ms" integer;
