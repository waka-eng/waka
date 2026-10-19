import { useEffect, useRef, useState } from "react";
import { fetchPrincipleRead, requestPrincipleRead, type ApiPrinciple, type ApiPrincipleStatus } from "../lib/api/principles";
import { t, type SupportedLocale } from "../lib/i18n";
import { settleAtLeast } from "../lib/settle-at-least";

/**
 * Your own principles: the sky's lead line and one status sentence. Only the
 * active view polls. (Rooms' principles left with rooms, 2026-10-12.)
 *
 * TWO KINDS OF REQUEST, KEPT APART. The poll loop only GETs — plus one
 * automatic start when the status says work is missing (`pending`). Try
 * again is the person's, and it is exactly ONE POST per press, sent from the
 * press itself and never aborted by the client: after 20 seconds without an
 * answer the button says "Still trying…", and when the answer comes the real
 * result shows. Nothing re-sends a retry on its own, and the poll never waits
 * on a POST.
 */
/** Ten-second reads while a reading is in progress; after five minutes the
    line says it is still working and the poll slows to once a minute. */
const WAITING_READ_MS = 10_000;
const MAX_WAITING_READS = 30;
/** While reads fail, the poll keeps asking every ten seconds, as on dev. */
const FAILED_READ_MS = 10_000;
/** Automatic starts for missing work before the line offers Try again. */
const MAX_AUTO_STARTS = 3;
/** How long a Try again may go unanswered before the button says so. */
const STILL_TRYING_AFTER_MS = 20_000;

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
     (at least `RETRY_MIN_MS`); "Still trying…" after 20s. */
  const [retrying, setRetrying] = useState(false);
  const [stillTrying, setStillTrying] = useState(false);
  /* The last Try again's POST failed: "Couldn't retry." */
  const [retryFailed, setRetryFailed] = useState(false);
  /* The automatic start failed `MAX_AUTO_STARTS` times: offer Try again. */
  const [startFailed, setStartFailed] = useState(false);
  /* Bumped to restart the poll after a Try again the server took. */
  const [resume, setResume] = useState(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const onReadRef = useRef(onRead);
  onReadRef.current = onRead;
  useEffect(() => {
    if (!active) return;
    let disposed = false;
    let running = false;
    let ensured = false;
    let starting = false;
    let autoStarts = 0;
    let consecutiveFailures = 0;
    let waitingReads = 0;
    setSlow(false);
    let timer: number | undefined;
    let delay = 60_000;
    /* THE ONE AUTOMATIC START, never awaited by the poll. Counted as done
       only once the server took it; a failure is retried on a later poll, up
       to `MAX_AUTO_STARTS`, and then the line offers Try again. */
    const autoStart = (current: ApiPrincipleStatus) => {
      starting = true;
      requestPrincipleRead(false)
        .then(() => {
          ensured = true;
          if (!disposed) setStatus({ ...current, phase: current.supportPending ? "pending" : "processing" });
        })
        .catch(() => {
          autoStarts += 1;
          if (!disposed && autoStarts >= MAX_AUTO_STARTS) setStartFailed(true);
        })
        .finally(() => { starting = false; });
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
        /* NEVER GIVES UP. A failing read shows the failure line (from the
           third in a row) and is asked again every ten seconds, as on dev. */
        consecutiveFailures += 1;
        delay = consecutiveFailures < 3 ? consecutiveFailures * 1_000 : FAILED_READ_MS;
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
  }, [active, locale, resume]);
  /* TRY AGAIN: one POST, from here, never aborted. */
  const tryAgain = () => {
    setRetrying(true); setRetryFailed(false); setStillTrying(false);
    const slowAnswer = window.setTimeout(() => { if (mounted.current) setStillTrying(true); }, STILL_TRYING_AFTER_MS);
    settleAtLeast(requestPrincipleRead(true))
      .then(() => {
        if (!mounted.current) return;
        setFailed(false); setStartFailed(false);
        setStatus((current) => current ? { ...current, phase: current.supportPending ? "pending" : "processing" } : current);
        setResume((value) => value + 1);
      })
      .catch(() => { if (mounted.current) setRetryFailed(true); })
      .finally(() => { window.clearTimeout(slowAnswer); if (mounted.current) { setRetrying(false); setStillTrying(false); } });
  };
  const error = failed || startFailed || retryFailed || status?.phase === "failed";
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
          {t(locale, stillTrying ? "worldStillTrying" : retrying ? "worldPrinciplesRetrying" : "worldPrinciplesRetry")}
        </button></> : null}
      </p> : null}
  </>;
}
