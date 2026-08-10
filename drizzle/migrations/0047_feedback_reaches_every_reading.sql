-- Correction reaches every reading surface (metabolism-game Step E): group
-- wall notes and combination readings become feedback targets, so "this
-- reading is wrong" is recordable wherever model output appears. Ownership
-- for both is group membership, checked at the route.
ALTER TYPE "feedback_target" ADD VALUE IF NOT EXISTS 'group_top_of_mind_note';
ALTER TYPE "feedback_target" ADD VALUE IF NOT EXISTS 'combination_reading';
