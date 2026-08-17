-- The guard asserted the wrong invariant, and it bricked derivation.
--
-- 0003 forbade a signal from BEING 'active' with fewer than three evidence
-- rows. The product's rule, in docs/generation.md, is narrower: three pieces
-- of evidence are what it takes to be PROMOTED. Residence is not the same
-- claim, and the difference is deliberate — `settleStrandedSignals` keeps a
-- locked signal standing when its footnotes are deleted, marking it
-- `unsupported_at` instead of retiring it, because deleting a person's own
-- sentence for want of citations would be WAKA editing them.
--
-- So an active signal with two evidence rows is a state the product creates
-- ON PURPOSE. 0003 made it a state the database would not tolerate, and the
-- collision is not theoretical:
--
--   deriveSignal writes `status` on EVERY pass —
--     status: promote ? "active" : current.status
--   — and Postgres fires `UPDATE OF status` whenever the column appears in
--   the SET list, whether or not the value changed. So the next derivation
--   touching an active-but-under-supported signal re-wrote 'active' over
--   'active', the trigger counted two, and the whole transaction aborted.
--   One deleted inspiration was enough to stop derivation for that signal
--   permanently.
--
-- The guard now fires only on the TRANSITION into active — an INSERT that
-- arrives active, or an UPDATE that moves a signal there from something
-- else. That is exactly the promotion 0003 meant to police, and it leaves
-- the supported-residence question where it belongs: with the code that
-- knows whose words the signal is.
CREATE OR REPLACE FUNCTION assert_signal_has_evidence() RETURNS trigger AS $$
DECLARE
  n integer;
BEGIN
  IF NEW.status = 'active'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'active') THEN
    SELECT count(*) INTO n FROM signal_evidence WHERE signal_id = NEW.id;
    IF n < 3 THEN
      RAISE EXCEPTION
        'signal % cannot be promoted to active with % evidence (needs 3) — see docs/generation.md',
        NEW.id, n;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
