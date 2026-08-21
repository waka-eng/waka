-- A signal may not be 'active' without the evidence that earns it.
--
-- docs/generation.md promotes emerging -> active at three pieces of evidence,
-- and the derivation pass honors that. Nothing else did: ten signals were
-- written straight to 'active' with zero evidence and the database accepted
-- every one. The sky filled with statements no memory had produced, which is
-- the exact failure the three layers exist to make impossible.
--
-- A CHECK constraint cannot count rows in another table, so this is a trigger.
-- It fires on the write that would create the violation rather than auditing
-- afterwards, so the bad state never exists to be found.
--
-- DEFERRABLE is deliberately NOT used: a signal is promoted after its evidence
-- is inserted, never in the same statement, so there is no legitimate ordering
-- this blocks.
CREATE OR REPLACE FUNCTION assert_signal_has_evidence() RETURNS trigger AS $$
DECLARE
  n integer;
BEGIN
  IF NEW.status = 'active' THEN
    SELECT count(*) INTO n FROM signal_evidence WHERE signal_id = NEW.id;
    IF n < 3 THEN
      RAISE EXCEPTION
        'signal % cannot be active with % evidence (needs 3) — see docs/generation.md',
        NEW.id, n;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS signals_require_evidence ON signals;
CREATE TRIGGER signals_require_evidence
  BEFORE INSERT OR UPDATE OF status ON signals
  FOR EACH ROW EXECUTE FUNCTION assert_signal_has_evidence();
