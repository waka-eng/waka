import { useEffect, useRef, useState } from "react";
import { fetchPrincipleRead, requestPrincipleRead, type ApiPrinciple, type ApiPrincipleStatus } from "../lib/api/principles";
import { t, type SupportedLocale } from "../lib/i18n";

/**
 * Your own principles: the sky's lead line and one status sentence. Only the
 * active view polls. (Rooms' principles left with rooms, 2026-10-12.)
 *
 * TRY AGAIN ON A FAILED READ IS ONE POST PER PRESS, sent from the press
 * handler and never re-sent by a poll. The button is disabled while it is out
 * and says "Still trying…" after 20 seconds; the POST is never aborted. When
 * it answers, the read restarts and its first GET decides what shows. Any
 * other failure's Try again only re-reads.
 */

/** How long a retry may go unanswered before the button says so. */
const STILL_TRYING_AFTER_MS = 20_000;

export function PrincipleRead({ active, locale, onRead }: {
  active: boolean; locale: SupportedLocale;
  onRead?: (rows: ApiPrinciple[]) => void;
}) {
  const [rows, setRows] = useState<ApiPrinciple[]>([]);
  const [status, setStatus] = useState<ApiPrincipleStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [stillTrying, setStillTrying] = useState(false);
  const onReadRef = useRef(onRead);
  const alive = useRef(true);
  onReadRef.current = onRead;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!active) return;
    let disposed = false;
    let running = false;
    let ensured = false;
    let consecutiveFailures = 0;
    let timer: number | undefined;
    let delay = 60_000;
    const read = async () => {
      if (running || document.hidden) return;
      window.clearTimeout(timer);
      running = true;
      try {
        const result = await fetchPrincipleRead();
        if (disposed) return;
        setRows(result.principles);
        onReadRef.current?.(result.principles);
        setStatus(result.status);
        setFailed(false);
        consecutiveFailures = 0;
        delay = result.status.phase === "processing" || result.status.phase === "pending"
          ? 10_000 : 60_000;
        if (!ensured && result.status.eligible && !result.status.supportPending && result.status.phase === 'pending') {
          await requestPrincipleRead(false);
          ensured = true;
          if (!disposed) setStatus({ ...result.status, phase: result.status.supportPending ? 'pending' : 'processing' });
        }
      } catch {
        consecutiveFailures += 1;
        delay = consecutiveFailures < 3 ? consecutiveFailures * 1_000 : 10_000;
        if (!disposed && consecutiveFailures >= 3) setFailed(true);
      } finally {
        running = false;
        if (!disposed) timer = window.setTimeout(() => void read(), delay);
      }
    };
    void read();
    const onFocus = () => void read();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [active, locale, attempt]);
  const error = failed || status?.phase === "failed";
  const tryAgain = () => {
    if (!(status?.phase === "failed" && (status.eligible || status.supportPending))) { setAttempt((value) => value + 1); return; }
    setRetrying(true); setStillTrying(false);
    const slow = window.setTimeout(() => { if (alive.current) setStillTrying(true); }, STILL_TRYING_AFTER_MS);
    requestPrincipleRead(true).catch(() => undefined).finally(() => {
      window.clearTimeout(slow);
      if (alive.current) { setRetrying(false); setStillTrying(false); setAttempt((value) => value + 1); }
    });
  };
  const visibleRows = rows;
  const message = error ? status?.supportPending ? 'worldSupportCheckFailed' : "worldPrinciplesError"
    : !status ? "worldPrinciplesLoading"
    : status.supportPending ? (status.phase === 'processing' ? 'worldSupportChecking' : status.phase === 'pending' ? 'worldSupportQueued' : 'worldSupportNeedsContext')
    : status.phase === "processing" || status.phase === "pending" ? "worldPrinciplesReading"
    : status.signalCount < 3 ? "worldValuesSubSelf"
    : status.topOfMindCount < 1 ? "worldPrinciplesNeedRead"
    : "worldPrinciplesNoCandidate";
  return <>
    {visibleRows.length === 0 ? <p className="jar-values-lead">{t(locale, "worldValuesLeadSelf")}</p> : null}
    {visibleRows.length === 0 || error || status?.phase === "processing" ?
      <p className="jar-values-sub" role={error ? "alert" : status?.phase === "processing" ? "status" : undefined}>
        {t(locale, message)}
        {error ? <> <button type="button" disabled={retrying} onClick={tryAgain}>
          {t(locale, stillTrying ? "worldStillTrying" : retrying ? "readingPausedRetrying" : "worldPrinciplesRetry")}
        </button></> : null}
      </p> : null}
  </>;
}
