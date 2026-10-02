import { useEffect, useRef, useState } from "react";
import { fetchPrincipleRead, requestPrincipleRead, type ApiPrinciple, type ApiPrincipleStatus } from "../lib/api/principles";
import { t, type SupportedLocale } from "../lib/i18n";
import { PrincipleEvidence } from "./PrincipleEvidence";
import { GROUP_READ_TTL_MS } from "../space-kinds/group";

/** Only the selected wall polls. Requests never render another wall's values. */
export function PrincipleRead({ groupId, active, locale, refreshKey, onRead }: {
  groupId?: string; active: boolean; locale: SupportedLocale;
  /** Changes when the room's wall or top of mind is fetched again. */
  refreshKey?: number;
  onRead?: (rows: ApiPrinciple[]) => void;
}) {
  const [rows, setRows] = useState<ApiPrinciple[]>([]);
  const [status, setStatus] = useState<ApiPrincipleStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const onReadRef = useRef(onRead);
  const retriedAttempt = useRef(0);
  const leaseTimer = useRef<number | undefined>(undefined);
  onReadRef.current = onRead;
  useEffect(() => () => window.clearTimeout(leaseTimer.current), []);
  useEffect(() => {
    if (!active) {
      if (groupId) { window.clearTimeout(leaseTimer.current); setRows([]); setStatus(null); }
      return;
    }
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
        const result = await fetchPrincipleRead(groupId);
        if (disposed) return;
        setRows(result.principles);
        onReadRef.current?.(result.principles);
        setStatus(result.status);
        if (groupId) {
          window.clearTimeout(leaseTimer.current);
          leaseTimer.current = window.setTimeout(() => {
            setRows([]); setStatus(null); onReadRef.current?.([]);
          }, GROUP_READ_TTL_MS);
        }
        setFailed(false);
        consecutiveFailures = 0;
        delay = result.status.phase === "processing" || result.status.phase === "pending"
          ? 10_000 : groupId && result.principles.length === 0 ? 15_000 : 60_000;
        if (groupId) delay = Math.min(delay, GROUP_READ_TTL_MS - 5_000);
        if (!ensured && ((result.status.eligible && !result.status.supportPending && result.status.phase === 'pending') ||
          ((result.status.eligible || result.status.supportPending) && result.status.phase === 'failed' && attempt > retriedAttempt.current))) {
          const retry = attempt > retriedAttempt.current;
          retriedAttempt.current = attempt;
          await requestPrincipleRead(groupId, retry);
          ensured = true;
          if (!disposed) setStatus({ ...result.status, phase: result.status.supportPending ? 'pending' : 'processing' });
        }
      } catch {
        if (!disposed && groupId) {
          setRows([]); setStatus(null);
          onReadRef.current?.([]);
        }
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
  }, [groupId, active, locale, refreshKey, attempt]);
  const error = failed || status?.phase === "failed";
  // Neighboring walls do not retain another room's last verified wording.
  const visibleRows = groupId && !active ? [] : rows;
  const message = error ? status?.supportPending ? 'worldSupportCheckFailed' : groupId
      ? failed ? "worldPrinciplesRoomLoadFailed" : "worldPrinciplesRoomGenerationFailed"
      : "worldPrinciplesError"
    : !status ? groupId ? "worldPrinciplesRoomChecking" : "worldPrinciplesLoading"
    : status.supportPending ? (status.phase === 'processing' ? 'worldSupportChecking' : status.phase === 'pending' ? 'worldSupportQueued' : 'worldSupportNeedsContext')
    : groupId && status.restricted ? "worldRoomPrinciplesRestricted"
    : status.phase === "processing" || status.phase === "pending" ? "worldPrinciplesReading"
    : status.signalCount < 3 ? (groupId ? "worldPrinciplesNeedRoomPatterns" : "worldValuesSubSelf")
    : status.topOfMindCount < 1 ? "worldPrinciplesNeedRead"
    : "worldPrinciplesNoCandidate";
  const groupEmpty = Boolean(groupId && visibleRows.length === 0 && status && !error && !status.restricted && !status.supportPending);
  const groupSignalCount = Math.min(status?.signalCount ?? 0, 3);
  const groupStage = !status || status.signalCount < 3 ? "patterns"
    : status.topOfMindCount < 1 ? "topOfMind"
    : status.phase === "pending" ? "pending"
    : status.phase === "processing" ? "processing" : "noCandidate";
  const groupStageLead = {
    patterns: "worldPrinciplesNeedRoomPatterns",
    topOfMind: "worldPrinciplesRoomWaitingForTopOfMind",
    pending: "worldPrinciplesRoomStarting",
    processing: "worldPrinciplesRoomReading",
    noCandidate: "worldPrinciplesRoomNoCandidateLead",
  } as const;
  const groupStageDetail = {
    patterns: "worldPrinciplesRoomNext",
    topOfMind: "worldPrinciplesRoomNeedRead",
    pending: "worldPrinciplesRoomReadingDetail",
    processing: "worldPrinciplesRoomReadingDetail",
    noCandidate: "worldPrinciplesRoomNoCandidate",
  } as const;
  return <>
    {!groupId && visibleRows.length === 0 ? <p className="jar-values-lead">{t(locale, "worldValuesLeadSelf")}</p> : null}
    {groupId ? <p className="jar-values-eyebrow jar-label">{t(locale, "worldPhilosophiesValues")}</p> : null}
    {groupId && visibleRows.length > 0 ? <>
      <ul className="jar-principles-list" role="list" aria-label={t(locale, "worldPhilosophiesValues")} data-jar-interactive="1">
      {[...visibleRows].sort((a, b) => a.rank - b.rank).map((row, index) => <li key={row.id} className="jar-principle-group">
        <p className={index === 0 ? "jar-values-held jar-values-held--first" : "jar-values-held"}>
          <span className="jar-values-value">{row.statement}</span>
        </p>
        {row.state === "contested" ? <p className="jar-values-sub">{t(locale, "worldValueContested")}</p> : null}
        {row.unsupported ? <p className="jar-values-sub">{t(locale, "worldPrincipleSupportChanged")}</p> : null}
        {!row.unsupported && row.supportChanged ? <p className="jar-values-sub">{t(locale, "worldPrincipleSupportUnconfirmed")}</p> : null}
        <details className="jar-values-sub" data-jar-interactive="1">
          <summary>{t(locale, "worldPrinciplesEvidence")}</summary>
          <PrincipleEvidence signals={row.citedSignals} locale={locale} />
        </details>
      </li>)}
      </ul>
    </> : null}
    {groupEmpty && status ? <div className="jar-principles-empty" role="status">
      <p className="jar-principles-empty-lead">{t(locale, groupStageLead[groupStage])}</p>
      {groupStage === "patterns" ? <>
        <div className="jar-principles-progress" role="progressbar"
          aria-label={t(locale, "worldPrinciplesRoomProgress")}
          aria-valuemin={0} aria-valuemax={3} aria-valuenow={groupSignalCount}>
          {[0, 1, 2].map((step) => <span key={step} className={step < groupSignalCount ? "ready" : ""} />)}
        </div>
        <p className="jar-principles-empty-count">
          {groupSignalCount}/3 {t(locale, "worldPrinciplesRoomProgress")}
        </p>
        <p className="jar-principles-empty-detail">{t(locale, "worldPrinciplesRoomHow")}</p>
      </> : null}
      <p className="jar-principles-empty-detail">{t(locale, groupStageDetail[groupStage])}</p>
    </div> : null}
    {!groupEmpty && (visibleRows.length === 0 || error || status?.phase === "processing" || (groupId && status?.restricted)) ?
      <p className="jar-values-sub" role={error ? "alert" : status?.phase === "processing" ? "status" : undefined}>
        {t(locale, message)}
        {error ? <> <button type="button" onClick={() => setAttempt((value) => value + 1)}>
          {t(locale, "worldPrinciplesRetry")}
        </button></> : null}
      </p> : null}
  </>;
}
