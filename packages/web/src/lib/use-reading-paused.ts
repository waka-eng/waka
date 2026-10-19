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
 * It asks once when enabled and again whenever the tab regains focus, which
 * is when a person who walked away would come back to check. It does not
 * poll: a paused reading stays paused until somebody (or the server's own
 * recovery) restarts it, and asking every few seconds would only spend
 * requests to learn the same thing. It makes its own GET each time; there is
 * no status shared with other readers.
 *
 * A FAILED CHECK IS NOT A PAUSE. If the status itself cannot be read the
 * notice stays down — the page has its own failure state for a dead server,
 * and "reading is paused" is a claim about the reading, not the network.
 *
 * RETRY. One POST per press, never aborted by the client. The button is
 * disabled while it is out (at least `RETRY_MIN_MS`), and after 20 seconds
 * with no answer it says "Still trying…" — the request is still allowed to
 * answer, and when it does the real result shows. A retry the server took
 * hides the notice at once and checks again with one fresh GET a few seconds
 * later (and on focus), which is what decides whether it comes back. There is
 * no merging of answers: the latest GET is the state.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchPrincipleStatus, retryPausedReading, type ApiPrincipleStatus } from './api';
import { settleAtLeast } from './settle-at-least';

/** After a retry the server took, how long before asking again. */
const RECHECK_AFTER_RETRY_MS = 5_000;
/** How long a retry may go unanswered before the button says so. */
const STILL_TRYING_AFTER_MS = 20_000;

export function useReadingPaused(enabled: boolean) {
  const [status, setStatus] = useState<ApiPrincipleStatus | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [stillTrying, setStillTrying] = useState(false);
  const [retryFailed, setRetryFailed] = useState<null | 'failed'>(null);
  /* A retry the server took hides the notice until the next check says. */
  const [restarted, setRestarted] = useState(false);
  const alive = useRef(true);
  /* Only the latest check may set the state. */
  const checkSeq = useRef(0);
  useEffect(() => () => { alive.current = false; }, []);

  const check = useCallback(() => {
    const seq = ++checkSeq.current;
    fetchPrincipleStatus()
      .then((next) => { if (alive.current && seq === checkSeq.current) { setStatus(next); setRestarted(false); } })
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

  const retry = useCallback(() => {
    setRetrying(true); setRetryFailed(null); setStillTrying(false);
    const slow = window.setTimeout(() => { if (alive.current) setStillTrying(true); }, STILL_TRYING_AFTER_MS);
    settleAtLeast(retryPausedReading())
      .then(() => {
        if (!alive.current) return;
        setRestarted(true);
        window.setTimeout(() => { if (alive.current) check(); }, RECHECK_AFTER_RETRY_MS);
      })
      .catch(() => { if (alive.current) setRetryFailed('failed'); })
      .finally(() => { window.clearTimeout(slow); if (alive.current) { setRetrying(false); setStillTrying(false); } });
  }, [check]);

  return {
    paused: enabled && !restarted && status?.readingPaused === true,
    /** The principles line (`PrincipleRead`) is already showing a failure
        with its own Try again — which restarts the reading too — so a page
        that shows both says it once. */
    principlesFailed: status?.phase === 'failed',
    retrying, stillTrying, retryFailed, retry,
  };
}
