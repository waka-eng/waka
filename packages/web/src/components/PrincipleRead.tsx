import { useEffect, useRef, useState } from "react";
import { fetchPrincipleRead, requestPrincipleRead, type ApiPrinciple, type ApiPrincipleStatus } from "../lib/api/principles";
import { formatMessage, t, type SupportedLocale } from "../lib/i18n";

/**
 * The selected profile's principles: a lead line and status. Only the
 * active view polls. (Rooms' principles left with rooms, 2026-10-12.)
 */
export function PrincipleRead({ active, locale, onRead, profileId, name }: {
  active: boolean; locale: SupportedLocale; profileId?: string; name?: string;
  onRead?: (rows: ApiPrinciple[]) => void;
}) {
  const [rows, setRows] = useState<ApiPrinciple[]>([]);
  const [status, setStatus] = useState<ApiPrincipleStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const onReadRef = useRef(onRead);
  const retriedAttempt = useRef(0);
  onReadRef.current = onRead;
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
        const result = await (profileId ? fetchPrincipleRead(profileId) : fetchPrincipleRead());
        if (disposed) return;
        setRows(result.principles);
        onReadRef.current?.(result.principles);
        setStatus(result.status);
        setFailed(false);
        consecutiveFailures = 0;
        delay = result.status.phase === "processing" || result.status.phase === "pending"
          ? 10_000 : 60_000;
        // Refresh requests act as the session's profile. An agent shown by
        // its human owner waits for its own worker rather than refreshing the human.
        if (!profileId && !ensured && ((result.status.eligible && !result.status.supportPending && result.status.phase === 'pending') ||
          ((result.status.eligible || result.status.supportPending) && result.status.phase === 'failed' && attempt > retriedAttempt.current))) {
          const retry = attempt > retriedAttempt.current;
          retriedAttempt.current = attempt;
          await requestPrincipleRead(retry);
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
  }, [active, locale, attempt, profileId]);
  const error = failed || status?.phase === "failed";
  const visibleRows = rows;
  const message = error ? status?.supportPending ? 'worldSupportCheckFailed' : "worldPrinciplesError"
    : !status ? "worldPrinciplesLoading"
    : status.supportPending ? (status.phase === 'processing' ? 'worldSupportChecking' : status.phase === 'pending' ? 'worldSupportQueued' : 'worldSupportNeedsContext')
    : status.phase === "processing" || status.phase === "pending" ? "worldPrinciplesReading"
    : status.signalCount < 3 ? "worldValuesSubSelf"
    : status.topOfMindCount < 1 ? "worldPrinciplesNeedRead"
    : "worldPrinciplesNoCandidate";
  return <>
    {visibleRows.length === 0 ? <p className="jar-values-lead">{profileId && name ? formatMessage(locale, "worldValuesLeadOther", { name }) : t(locale, "worldValuesLeadSelf")}</p> : null}
    {visibleRows.length === 0 || error || status?.phase === "processing" ?
      <p className="jar-values-sub" role={error ? "alert" : status?.phase === "processing" ? "status" : undefined}>
        {t(locale, message)}
        {error ? <> <button type="button" onClick={() => setAttempt((value) => value + 1)}>
          {t(locale, "worldPrinciplesRetry")}
        </button></> : null}
      </p> : null}
  </>;
}
