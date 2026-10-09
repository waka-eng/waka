-- WHAT EACH KEEP IS ABOUT, so the archive can be read by shelf.
--
-- Founder: "for the inspirations that I saved, I want to add tabs. So it's
-- like all and then we create categories based on the inspirations."
--
-- BASED ON THEM, NOT IMPOSED ON THEM. Free text rather than an enum: an enum
-- would be a taxonomy decided once, here, for everybody, and the claim this
-- product makes is that what a person keeps about is particular to them. The
-- vocabulary converges per archive instead — the reading is shown the shelves
-- this profile already uses and told to reuse before it coins.
--
-- NULLABLE AND NULL BY DEFAULT. Every row that exists today is unplaced, and
-- a keep the reading cannot place stays unplaced rather than being filed under
-- a fallback. Unplaced means "in all, and in nothing else".
ALTER TABLE inspirations ADD COLUMN IF NOT EXISTS category text;

-- The archive page asks one question of this column — "which categories does
-- this profile use, and how much is on each" — and asks it per profile. A
-- partial index skips the unplaced rows, which on an archive that has not
-- been re-read yet is all of them.
CREATE INDEX IF NOT EXISTS inspirations_profile_category_idx
  ON inspirations (profile_id, category)
  WHERE category IS NOT NULL;
