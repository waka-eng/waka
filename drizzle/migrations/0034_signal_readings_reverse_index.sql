-- Reverse lookup for the readings surface: "which group notes cited this
-- signal?" The table's existing indexes both lead on the note id, so the
-- per-signal lookup GET /api/inspirations/:id/readings performs would
-- otherwise scan. Solo notes already have the mirror-image index
-- (top_of_mind_note_signals_signal_idx); this brings the group side level.
--
-- Guarded like its neighbours so a partially-applied migration can be retried.
CREATE INDEX IF NOT EXISTS "group_top_of_mind_note_signals_signal_idx" ON "group_top_of_mind_note_signals" ("signal_id");
