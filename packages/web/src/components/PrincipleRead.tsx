import { useEffect, useRef, useState } from "react";
import { fetchPrincipleRead, requestPrincipleRead, type ApiPrinciple, type ApiPrincipleStatus } from "../lib/api/principles";
import { ApiError } from "../lib/api/http";
import { t, type SupportedLocale } from "../lib/i18n";

/**
 * Your own principles: the sky's lead line and one status sentence. Only the
 * active view polls. (Rooms' principles left with rooms, 2026-10-12.)
 */
/** Ten-second reads while a reading is in progress: five minutes, then stop. */
const MAX_WAITING_READS = 30;
/** Failed reads in a row before the poll stops and waits for Try again. */
const MAX_FAILED_READS = 6;

export function PrincipleRead({ active, locale, onRead }: {
  active: boolean; locale: SupportedLocale;
  onRead?: (rows: ApiPrinciple[]) => void;
}) {
  const [rows, setRows] = useState<ApiPrinciple[]>([]);
  const [status, setStatus] = useState<ApiPrincipleStatus | null>(null);
  const [failed, setFailed] = useState(false);
  /**
   * THE POLL HAS AN END NOW. It re-read every ten seconds for as long as the
   * status said "processing" and every ten after three failures — forever,
   * on a wall a person might leave open all afternoon. A reading stuck in a
   * job that died would say "Reading…" until the tab closed. After
   * `MAX_WAITING_READS` in a row it stops, says the reading is taking longer
   * than it should, and offers the same Try again a failure does. Coming
   * back to the tab still reads once, because that is the person asking.
   */
  const [stalled, setStalled] = useState(false);
  const [attempt, setAttempt] = useState(0);
  /* A retry inside the server's reading cooldown is a 429: it was tried
     moments ago. That is its own sentence, not the generic failure. */
  const [throttled, setThrottled] = useState(false);
  const onReadRef = useRef(onRead);
  const retriedAttempt = useRef(0);
  /* Try again pressed on a STALLED read: the job is stuck, not failed, so
     the next read must ask the server to re-enqueue it (retry=1) rather
     than only restarting the poll that already watched it stall. */
  const retryStalled = useRef(false);
  onReadRef.current = onRead;
  useEffect(() => {
    if (!active) return;
    let disposed = false;
    let running = false;
    let ensured = false;
    let consecutiveFailures = 0;
    let waitingReads = 0;
    let stopped = false;
    setStalled(false);
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
        const waiting = result.status.phase === "processing" || result.status.phase === "pending";
        delay = waiting ? 10_000 : 60_000;
        waitingReads = waiting ? waitingReads + 1 : 0;
        stopped = waitingReads >= MAX_WAITING_READS;
        setStalled(stopped);
        const asked = attempt > retriedAttempt.current;
        const stuck = retryStalled.current && (waiting || result.status.phase === 'failed');
        if (!waiting && result.status.phase !== 'failed') setThrottled(false);
        if (!ensured && ((result.status.eligible && !result.status.supportPending && result.status.phase === 'pending') ||
          ((result.status.eligible || result.status.supportPending) && result.status.phase === 'failed' && asked) ||
          (asked && stuck))) {
          retriedAttempt.current = attempt;
          retryStalled.current = false;
          ensured = true;
          try {
            await requestPrincipleRead(asked);
          } catch (error) {
            if (!(error instanceof ApiError && error.status === 429)) throw error;
            if (!disposed) setThrottled(true);
            return;
          }
          if (!disposed) { setThrottled(false); setStatus({ ...result.status, phase: result.status.supportPending ? 'pending' : 'processing' }); }
        }
        retryStalled.current = false;
      } catch {
        consecutiveFailures += 1;
        delay = consecutiveFailures < 3 ? consecutiveFailures * 1_000 : 10_000;
        stopped = consecutiveFailures >= MAX_FAILED_READS;
        if (!disposed && consecutiveFailures >= 3) setFailed(true);
      } finally {
        running = false;
        if (!disposed && !stopped) timer = window.setTimeout(() => void read(), delay);
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
  const error = failed || stalled || throttled || status?.phase === "failed";
  const visibleRows = rows;
  const message = throttled && !failed ? "worldPrinciplesRetryTooSoon"
    : stalled && !failed ? "worldPrinciplesStalled"
    : error ? status?.supportPending ? 'worldSupportCheckFailed' : "worldPrinciplesError"
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
        {error ? <> <button type="button" onClick={() => { retryStalled.current = stalled; setAttempt((value) => value + 1); }}>
          {t(locale, "worldPrinciplesRetry")}
        </button></> : null}
      </p> : null}
  </>;
}
