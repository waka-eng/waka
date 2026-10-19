/**
 * IS THE READING PAUSED — the one question three pages now ask.
 *
 * When the model provider stops answering (out of credit is a 402), the jobs
 * that write a person's reading fail after their retries and every page went
 * on as if nothing had happened: home kept the last reading, principles said
 * nothing, and a save sat unread with no sign anything was wrong or that
 * anything could be done. `GET /principles/status` now carries
 * `readingPaused`, and this hook is how home, principles and claims read it.
 *
 * ONE RULE: THE LATEST GET IS THE STATE. It asks once when enabled, on focus,
 * and — only while the reading is paused — every 30 seconds. A failed GET
 * changes nothing (a notice that was showing stays). Retry is one POST; when
 * it succeeds, one fresh GET decides what shows. Every Retry bumps a counter,
 * and a GET that started before the latest Retry is ignored when it lands, so
 * an answer from before the restart can never overwrite one from after it.
 *
 * A FAILED CHECK IS NOT A PAUSE. If the status cannot be read the notice does
 * not appear because of it — "reading is paused" is a claim about the
 * reading, not the network.
 *
 * The POST is never aborted by the client: the button is disabled while it is
 * out (at least `RETRY_MIN_MS`), says "Still trying…" after 20 seconds, and
 * shows the real result when the answer comes.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchPrincipleStatus, retryPausedReading, type ApiPrincipleStatus } from './api';
import { settleAtLeast } from './settle-at-least';

/** While paused, how often to ask again. */
const PAUSED_RECHECK_MS = 30_000;
/** How long a retry may go unanswered before the button says so. */
const STILL_TRYING_AFTER_MS = 20_000;

export function useReadingPaused(enabled: boolean) {
  const [status, setStatus] = useState<ApiPrincipleStatus | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [stillTrying, setStillTrying] = useState(false);
  const [retryFailed, setRetryFailed] = useState<null | 'failed'>(null);
  const alive = useRef(true);
  /* Bumped by every Retry: a GET that started under an older value is stale. */
  const retries = useRef(0);
  useEffect(() => () => { alive.current = false; }, []);

  const check = useCallback(() => {
    const startedAt = retries.current;
    fetchPrincipleStatus()
      .then((next) => { if (alive.current && startedAt === retries.current) setStatus(next); })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    alive.current = true;
    check();
    const again = () => { if (!document.hidden) check(); };
    window.addEventListener('focus', again);
    return () => { window.removeEventListener('focus', again); };
  }, [enabled, check]);

  const paused = enabled && status?.readingPaused === true;
  useEffect(() => {
    if (!paused) return;
    const timer = window.setInterval(check, PAUSED_RECHECK_MS);
    return () => window.clearInterval(timer);
  }, [paused, check]);

  const retry = useCallback(() => {
    retries.current += 1;
    setRetrying(true); setRetryFailed(null); setStillTrying(false);
    const slow = window.setTimeout(() => { if (alive.current) setStillTrying(true); }, STILL_TRYING_AFTER_MS);
    settleAtLeast(retryPausedReading())
      .then(() => { if (alive.current) check(); })
      .catch(() => { if (alive.current) setRetryFailed('failed'); })
      .finally(() => { window.clearTimeout(slow); if (alive.current) { setRetrying(false); setStillTrying(false); } });
  }, [check]);

  return {
    paused,
    /** The principles line (`PrincipleRead`) is already showing a failure
        with its own Try again — which restarts the reading too — so a page
        that shows both says it once. */
    principlesFailed: status?.phase === 'failed',
    retrying, stillTrying, retryFailed, retry,
  };
}
