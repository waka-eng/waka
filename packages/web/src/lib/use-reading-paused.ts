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
import { fetchPrincipleStatus, retryPausedReading } from './api';

export function useReadingPaused(enabled: boolean) {
  const [paused, setPaused] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retryFailed, setRetryFailed] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const check = useCallback(() => {
    const controller = new AbortController();
    fetchPrincipleStatus(controller.signal)
      .then((status) => { if (alive.current && !controller.signal.aborted) setPaused(status.readingPaused === true); })
      .catch(() => undefined);
    return controller;
  }, []);

  useEffect(() => {
    if (!enabled) return;
    alive.current = true;
    let controller = check();
    const again = () => { if (document.hidden) return; controller.abort(); controller = check(); };
    window.addEventListener('focus', again);
    return () => { controller.abort(); window.removeEventListener('focus', again); };
  }, [enabled, check]);

  const retry = useCallback(() => {
    setRetrying(true); setRetryFailed(false);
    retryPausedReading()
      .then((status) => { if (alive.current) setPaused(status.readingPaused === true); })
      .catch(() => { if (alive.current) setRetryFailed(true); })
      .finally(() => { if (alive.current) setRetrying(false); });
  }, []);

  return { paused, retrying, retryFailed, retry };
}
