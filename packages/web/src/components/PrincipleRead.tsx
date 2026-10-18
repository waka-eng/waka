import { useEffect, useRef, useState } from "react";
import { fetchPrincipleRead, onPrincipleStatus, requestPrincipleRead, type ApiPrinciple, type ApiPrincipleStatus } from "../lib/api/principles";
import { t, type SupportedLocale } from "../lib/i18n";
import { RETRY_MIN_MS } from "../lib/settle-at-least";

/**
 * Your own principles: the sky's lead line and one status sentence. Only the
 * active view polls. (Rooms' principles left with rooms, 2026-10-12.)
 */
/** Ten-second reads while a reading is in progress; after five minutes the
    line says it is still working and the poll slows to once a minute. */
const WAITING_READ_MS = 10_000;
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
   * A LONG WAIT IS NOT A FAILURE, AND IT HAS NO BUTTON. After
   * `MAX_WAITING_READS` the line says the work can take a few minutes and the
   * poll slows down. It offers no Try again: the server does not restart a
   * job that is still pending or running, so the button would do nothing.
   * Try again belongs to a FAILED phase, and to reads that could not be made.
   */
  const [slow, setSlow] = useState(false);
  const [attempt, setAttempt] = useState(0);
  /* TRY AGAIN GUARDS ITSELF. The server keeps no retry cooldown, so the
     button disables and says "Retrying…" from the press until the read it
     started answers, and for at least `RETRY_MIN_MS`. */
  const [retrying, setRetrying] = useState(false);
  /* When the press happened and which `attempt` it started: only a read of
     that attempt may end the "Retrying…" state. */
  const retryingSince = useRef<{ at: number; attempt: number } | null>(null);
  /* True while this component's own refresh POST is out, so its published
     answer is not mistaken for a retry from elsewhere. */
  const ownRequest = useRef(false);
  /* Bumped when a status heard from elsewhere says work started again: the
     poll restarts without that counting as a Try again. */
  const [resume, setResume] = useState(0);
  const stuckRef = useRef(false);
  const onReadRef = useRef(onRead);
  const retriedAttempt = useRef(0);
  onReadRef.current = onRead;
  /* A RETRY ELSEWHERE IS HEARD HERE. The paused-reading notice's Retry
     publishes its answer as a `refresh`; when that says work is moving
     again, this line drops its failure (or its slow wait) and polls again.
     Poll answers — this component's own included — never resume it. */
  useEffect(() => {
    if (!active) return;
    return onPrincipleStatus((next, source) => {
      if (source !== "refresh" || ownRequest.current || !stuckRef.current || (next.phase !== "processing" && next.phase !== "pending")) return;
      stuckRef.current = false;
      setStatus(next); setFailed(false); setSlow(false);
      setResume((value) => value + 1);
    });
  }, [active]);
  useEffect(() => {
    if (!active) return;
    let disposed = false;
    let running = false;
    let ensured = false;
    let consecutiveFailures = 0;
    let waitingReads = 0;
    let stopped = false;
    setSlow(false);
    let timer: number | undefined;
    let delay = 60_000;
    /* Only the read the press started (this effect run, for that attempt)
       ends "Retrying…" — a read of an earlier run still in flight does not. */
    const finishRetry = () => {
      const pressed = retryingSince.current;
      if (disposed || pressed === null || pressed.attempt !== attempt) return;
      retryingSince.current = null;
      window.setTimeout(() => setRetrying(false), Math.max(0, RETRY_MIN_MS - (Date.now() - pressed.at)));
    };
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
        /* A read that worked (a focus or visibility read after the poll gave
           up) restarts the poll: `finally` schedules the next one again. */
        stopped = false;
        const waiting = result.status.phase === "processing" || result.status.phase === "pending";
        waitingReads = waiting ? waitingReads + 1 : 0;
        const longWait = waitingReads >= MAX_WAITING_READS;
        delay = waiting && !longWait ? WAITING_READ_MS : 60_000;
        setSlow(longWait);
        const asked = attempt > retriedAttempt.current;
        if (!ensured && ((result.status.eligible && !result.status.supportPending && result.status.phase === "pending") ||
          ((result.status.eligible || result.status.supportPending) && result.status.phase === "failed" && asked))) {
          ownRequest.current = true;
          try { await requestPrincipleRead(asked); } finally { ownRequest.current = false; }
          /* Only a start (or a Try again) that the server took counts: a
             failed POST is sent again on the next poll (it throws into the
             catch below first). */
          retriedAttempt.current = attempt;
          ensured = true;
          if (!disposed) setStatus({ ...result.status, phase: result.status.supportPending ? "pending" : "processing" });
        }
      } catch {
        consecutiveFailures += 1;
        delay = consecutiveFailures < 3 ? consecutiveFailures * 1_000 : 10_000;
        stopped = consecutiveFailures >= MAX_FAILED_READS;
        if (!disposed && consecutiveFailures >= 3) setFailed(true);
      } finally {
        running = false;
        finishRetry();
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
  }, [active, locale, attempt, resume]);
  const error = failed || status?.phase === "failed";
  stuckRef.current = error || slow;
  const visibleRows = rows;
  const message = error ? status?.supportPending ? "worldSupportCheckFailed" : "worldPrinciplesError"
    : !status ? "worldPrinciplesLoading"
    : status.supportPending ? (status.phase === "processing" ? "worldSupportChecking" : status.phase === "pending" ? "worldSupportQueued" : "worldSupportNeedsContext")
    : slow ? "worldPrinciplesStillWorking"
    : status.phase === "processing" || status.phase === "pending" ? "worldPrinciplesReading"
    : status.signalCount < 3 ? "worldValuesSubSelf"
    : status.topOfMindCount < 1 ? "worldPrinciplesNeedRead"
    : "worldPrinciplesNoCandidate";
  return <>
    {visibleRows.length === 0 ? <p className="jar-values-lead">{t(locale, "worldValuesLeadSelf")}</p> : null}
    {visibleRows.length === 0 || error || slow || retrying || status?.phase === "processing" ?
      <p className="jar-values-sub" role={error ? "alert" : slow || status?.phase === "processing" ? "status" : undefined}>
        {t(locale, message)}
        {error || retrying ? <> <button type="button" disabled={retrying} onClick={() => {
          retryingSince.current = { at: Date.now(), attempt: attempt + 1 }; setRetrying(true); setAttempt(attempt + 1);
        }}>
          {t(locale, retrying ? "worldPrinciplesRetrying" : "worldPrinciplesRetry")}
        </button></> : null}
      </p> : null}
  </>;
}
