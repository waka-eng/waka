import { useEffect, useRef, useState } from "react";
import { fetchPrincipleRead, onPrincipleStatus, requestPrincipleRead, type ApiPrinciple, type ApiPrincipleStatus } from "../lib/api/principles";
import { t, type SupportedLocale } from "../lib/i18n";
import { settleAtLeast } from "../lib/settle-at-least";

/**
 * Your own principles: the sky's lead line and one status sentence. Only the
 * active view polls. (Rooms' principles left with rooms, 2026-10-12.)
 *
 * TWO KINDS OF REQUEST, KEPT APART. The poll loop only GETs — plus one
 * automatic start when the status says work is missing (`pending`). Try
 * again is the person's, and it is exactly ONE POST per press, sent from the
 * press itself: success resumes the poll, failure says so and waits for the
 * next press. Nothing re-sends a retry on its own, and the poll never waits
 * on a POST.
 */
/** Ten-second reads while a reading is in progress; after five minutes the
    line says it is still working and the poll slows to once a minute. */
const WAITING_READ_MS = 10_000;
const MAX_WAITING_READS = 30;
/** Failed reads in a row before the poll stops and waits for Try again. */
const MAX_FAILED_READS = 6;
/** Every POST from here gives up after this long (a hung request must not
    leave a button disabled forever). */
const POST_DEADLINE_MS = 20_000;
/** Automatic starts for missing work before the line offers Try again. */
const MAX_AUTO_STARTS = 3;

/** One POST /principles/refresh with the client deadline. */
async function postWithDeadline(retry: boolean): Promise<void> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(new DOMException("Request timed out", "TimeoutError")), POST_DEADLINE_MS);
  try { await requestPrincipleRead(retry, controller.signal); } finally { window.clearTimeout(timer); }
}

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
   */
  const [slow, setSlow] = useState(false);
  /* Try again in flight: disabled and "Retrying…" until its one POST answers
     (at least `RETRY_MIN_MS`, at most the POST deadline). */
  const [retrying, setRetrying] = useState(false);
  /* The last Try again's POST failed or timed out: "Couldn't retry." */
  const [retryFailed, setRetryFailed] = useState(false);
  /* The automatic start failed `MAX_AUTO_STARTS` times: offer Try again. */
  const [startFailed, setStartFailed] = useState(false);
  /* Bumped to restart the poll: after a Try again the server took, or when a
     status heard from elsewhere says work started again. */
  const [resume, setResume] = useState(0);
  const stuckRef = useRef(false);
  /* POSTs of this component's own still out, so their published answers are
     not mistaken for a retry from elsewhere. */
  const ownRequests = useRef(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const onReadRef = useRef(onRead);
  onReadRef.current = onRead;
  /* A RETRY ELSEWHERE IS HEARD HERE. The paused-reading notice's Retry
     publishes its answer as a `refresh`; when that says work is moving
     again, this line drops its failure (or its slow wait) and polls again.
     Poll answers — this component's own included — never resume it. */
  useEffect(() => {
    if (!active) return;
    return onPrincipleStatus((next, source) => {
      if (source !== "refresh" || ownRequests.current > 0 || !stuckRef.current || (next.phase !== "processing" && next.phase !== "pending")) return;
      stuckRef.current = false;
      setStatus(next); setFailed(false); setSlow(false); setRetryFailed(false); setStartFailed(false);
      setResume((value) => value + 1);
    });
  }, [active]);
  useEffect(() => {
    if (!active) return;
    let disposed = false;
    let running = false;
    let ensured = false;
    let starting = false;
    let autoStarts = 0;
    let consecutiveFailures = 0;
    let waitingReads = 0;
    let stopped = false;
    setSlow(false);
    let timer: number | undefined;
    let delay = 60_000;
    /* THE ONE AUTOMATIC START, never awaited by the poll. Counted as done
       only once the server took it; a failure is retried on a later poll, up
       to `MAX_AUTO_STARTS`, and then the line offers Try again. */
    const autoStart = (current: ApiPrincipleStatus) => {
      starting = true;
      ownRequests.current += 1;
      postWithDeadline(false)
        .then(() => {
          ensured = true;
          if (!disposed) setStatus({ ...current, phase: current.supportPending ? "pending" : "processing" });
        })
        .catch(() => {
          autoStarts += 1;
          if (!disposed && autoStarts >= MAX_AUTO_STARTS) setStartFailed(true);
        })
        .finally(() => { starting = false; ownRequests.current -= 1; });
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
        /* Work moving (or done) answers any earlier "couldn't retry" or a
           failed automatic start: those lines are no longer true. */
        if (result.status.phase === "processing" || result.status.phase === "ready") { setRetryFailed(false); setStartFailed(false); }
        const waiting = result.status.phase === "processing" || result.status.phase === "pending";
        waitingReads = waiting ? waitingReads + 1 : 0;
        const longWait = waitingReads >= MAX_WAITING_READS;
        delay = waiting && !longWait ? WAITING_READ_MS : 60_000;
        setSlow(longWait);
        if (!ensured && !starting && autoStarts < MAX_AUTO_STARTS &&
          result.status.eligible && !result.status.supportPending && result.status.phase === "pending") autoStart(result.status);
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
  }, [active, locale, resume]);
  /* TRY AGAIN: one POST, from here. */
  const tryAgain = () => {
    setRetrying(true); setRetryFailed(false);
    ownRequests.current += 1;
    settleAtLeast(postWithDeadline(true))
      .then(() => {
        if (!mounted.current) return;
        setFailed(false); setStartFailed(false);
        setStatus((current) => current ? { ...current, phase: current.supportPending ? "pending" : "processing" } : current);
        setResume((value) => value + 1);
      })
      .catch(() => { if (mounted.current) setRetryFailed(true); })
      .finally(() => { ownRequests.current -= 1; if (mounted.current) setRetrying(false); });
  };
  const error = failed || startFailed || retryFailed || status?.phase === "failed";
  stuckRef.current = error || slow;
  const visibleRows = rows;
  const message = retryFailed ? "worldPrinciplesRetryFailed"
    : error ? status?.supportPending ? "worldSupportCheckFailed" : "worldPrinciplesError"
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
        {error || retrying ? <> <button type="button" disabled={retrying} onClick={tryAgain}>
          {t(locale, retrying ? "worldPrinciplesRetrying" : "worldPrinciplesRetry")}
        </button></> : null}
      </p> : null}
  </>;
}
