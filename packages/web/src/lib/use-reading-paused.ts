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
 * requests to learn the same thing.
 *
 * A FAILED CHECK IS NOT A PAUSE. If the status itself cannot be read the
 * notice stays down — the page has its own failure state for a dead server,
 * and "reading is paused" is a claim about the reading, not the network.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchPrincipleStatus, onPrincipleStatus, principleStatusFor, recentPrincipleStatus, retryPausedReading, type ApiPrincipleStatus } from './api';
import { useOptionalAuth } from './auth-context';
import { settleAtLeast, withPostDeadline } from './settle-at-least';

/** A status this young is the answer; nobody needs to ask again yet. */
const FRESH_MS = 15_000;

export function useReadingPaused(enabled: boolean) {
  /* Whose status this is: a different person drops the shared cache. */
  const who = useOptionalAuth()?.profile?.id ?? null;
  principleStatusFor(who);
  const [status, setStatus] = useState<ApiPrincipleStatus | null>(null);
  const [statusFor, setStatusFor] = useState(who);
  if (statusFor !== who) { setStatusFor(who); setStatus(null); }
  const [retrying, setRetrying] = useState(false);
  const [retryFailed, setRetryFailed] = useState<null | 'failed'>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  /* NO REQUEST OF ITS OWN WHEN ONE WAS JUST MADE. `PrincipleRead` reads the
     same status on the same screen; the shared fetch and the published
     answers in `lib/api/principles.ts` mean this hook mostly listens. */
  const check = useCallback(() => {
    const recent = recentPrincipleStatus(FRESH_MS);
    if (recent) { setStatus(recent); return; }
    fetchPrincipleStatus()
      .then((next) => { if (alive.current) setStatus(next); })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    alive.current = true;
    const unsubscribe = onPrincipleStatus((next) => { if (alive.current) setStatus(next); });
    check();
    const again = () => { if (!document.hidden) check(); };
    window.addEventListener('focus', again);
    return () => { unsubscribe(); window.removeEventListener('focus', again); };
  }, [enabled, check, who]);

  /* Retry disables itself and says "Retrying…" until the request answers,
     and for at least `RETRY_MIN_MS` — the only guard against repeated
     presses, since the server keeps no cooldown. */
  const retry = useCallback(() => {
    setRetrying(true); setRetryFailed(null);
    settleAtLeast(withPostDeadline((signal) => retryPausedReading(signal)))
      .then((next) => { if (alive.current) setStatus(next); })
      .catch(() => { if (alive.current) setRetryFailed('failed'); })
      .finally(() => { if (alive.current) setRetrying(false); });
  }, []);

  return {
    paused: enabled && status?.readingPaused === true,
    /** The principles line (`PrincipleRead`) is already showing a failure
        with its own Try again — which restarts the reading too — so a page
        that shows both says it once. */
    principlesFailed: status?.phase === 'failed',
    retrying, retryFailed, retry,
  };
}
