-- Combination readings: an open set of facets, instead of three fixed columns.
--
-- `impact` / `people` / `place` asserted that every want has an effect, a who
-- and a where. Many do not — a combination can be after a standard of craft, a
-- pace, a material, an audience, a question nobody is asking — and a reading
-- given only those three boxes stays silent about the dimension it can actually
-- see. That silence then reads as "the evidence is thin" when what was thin was
-- the schema's guess about what wants are made of.
--
-- Each facet now names its own dimension. Zero to three, and empty is normal.

ALTER TABLE "combination_readings"
	ADD COLUMN IF NOT EXISTS "facets" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
-- Carry existing values across rather than dropping readings on the floor.
-- The old column names become the dimension, which is exactly what they were.
UPDATE "combination_readings"
SET "facets" = (
	SELECT COALESCE(jsonb_agg(jsonb_build_object('dimension', d, 'text', t)), '[]'::jsonb)
	FROM (
		VALUES
			('the impact', "impact"),
			('who it is with', "people"),
			('where it happens', "place")
	) AS pairs(d, t)
	WHERE t IS NOT NULL AND length(btrim(t)) > 0
)
WHERE "impact" IS NOT NULL OR "people" IS NOT NULL OR "place" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "combination_readings" DROP COLUMN IF EXISTS "impact";
--> statement-breakpoint
ALTER TABLE "combination_readings" DROP COLUMN IF EXISTS "people";
--> statement-breakpoint
ALTER TABLE "combination_readings" DROP COLUMN IF EXISTS "place";
