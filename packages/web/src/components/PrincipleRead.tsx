import { useEffect, useRef, useState } from "react";
import { fetchPrincipleRead, requestPrincipleRead, type ApiPrinciple, type ApiPrincipleStatus } from "../lib/api/principles";
import { t, type SupportedLocale } from "../lib/i18n";
import { PrincipleEvidence } from "./PrincipleEvidence";

/** Only the selected wall polls. Requests never render another wall's values. */
export function PrincipleRead({ groupId, active, locale, onRead }: {
  groupId?: string; active: boolean; locale: SupportedLocale;
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
        const result = await fetchPrincipleRead(groupId);
        if (disposed) return;
        setRows(result.principles);
        onReadRef.current?.(result.principles);
        setStatus(result.status);
        setFailed(false);
        consecutiveFailures = 0;
        delay = result.status.phase === "processing" || result.status.phase === "pending" ? 10_000 : 60_000;
        if (!ensured && result.status.eligible &&
          (result.status.phase === "pending" || result.status.phase === "processing" ||
            (result.status.phase === "failed" && attempt > retriedAttempt.current))) {
          const retry = attempt > retriedAttempt.current;
          retriedAttempt.current = attempt;
          await requestPrincipleRead(groupId, retry);
          ensured = true;
          if (!disposed) setStatus({ ...result.status, phase: "processing" });
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
  }, [groupId, active, locale, attempt]);
  const error = failed || status?.phase === "failed";
  const message = error ? groupId
      ? failed ? "worldPrinciplesRoomLoadFailed" : "worldPrinciplesRoomGenerationFailed"
      : "worldPrinciplesError"
    : !status ? groupId ? "worldPrinciplesRoomChecking" : "worldPrinciplesLoading"
    : status.phase === "processing" || status.phase === "pending" ? "worldPrinciplesReading"
    : status.signalCount < 3 ? (groupId ? "worldPrinciplesNeedRoomPatterns" : "worldValuesSubSelf")
    : status.topOfMindCount < 1 ? "worldPrinciplesNeedRead"
    : "worldPrinciplesNoCandidate";
  const groupEmpty = Boolean(groupId && rows.length === 0 && status && !error &&
    status.phase !== "processing" && status.phase !== "pending");
  const groupSignalCount = Math.min(status?.signalCount ?? 0, 3);
  return <>
    {!groupId && rows.length === 0 ? <p className="jar-values-lead">{t(locale, "worldValuesLeadSelf")}</p> : null}
    {groupId ? <p className="jar-values-eyebrow jar-label">{t(locale, "worldPhilosophiesValues")}</p> : null}
    {groupId && rows.length > 0 ? <>
      <ul className="jar-principles-list" role="list" aria-label={t(locale, "worldPhilosophiesValues")} data-jar-interactive="1">
      {[...rows].sort((a, b) => a.rank - b.rank).map((row, index) => <li key={row.id} className="jar-principle-group">
        <p className={index === 0 ? "jar-values-held jar-values-held--first" : "jar-values-held"}>
          <span className="jar-values-value">{row.statement}</span>
        </p>
        {row.state === "contested" ? <p className="jar-values-sub">{t(locale, "worldValueContested")}</p> : null}
        <details className="jar-values-sub" data-jar-interactive="1">
          <summary>{t(locale, "worldPrinciplesEvidence")}</summary>
          <PrincipleEvidence signals={row.citedSignals} locale={locale} />
        </details>
      </li>)}
      </ul>
    </> : null}
    {groupEmpty && status ? <div className="jar-principles-empty" role="status">
      <p className="jar-principles-empty-lead">{t(locale, "worldPrinciplesNeedRoomPatterns")}</p>
      {status.signalCount < 3 ? <>
        <div className="jar-principles-progress" role="progressbar"
          aria-label={t(locale, "worldPrinciplesRoomProgress")}
          aria-valuemin={0} aria-valuemax={3} aria-valuenow={groupSignalCount}>
          {[0, 1, 2].map((step) => <span key={step} className={step < groupSignalCount ? "ready" : ""} />)}
        </div>
        <p className="jar-principles-empty-count">
          {groupSignalCount}/3 {t(locale, "worldPrinciplesRoomProgress")}
        </p>
        <p className="jar-principles-empty-detail">{t(locale, "worldPrinciplesRoomHow")}</p>
        <p className="jar-principles-empty-detail">{t(locale, "worldPrinciplesRoomNext")}</p>
      </> : <p className="jar-principles-empty-detail">
        {t(locale, status.topOfMindCount < 1 ? "worldPrinciplesRoomNeedRead" : "worldPrinciplesRoomNoCandidate")}
      </p>}
    </div> : null}
    {!groupEmpty && (rows.length === 0 || error || status?.phase === "processing") ?
      <p className="jar-values-sub" role={error ? "alert" : status?.phase === "processing" ? "status" : undefined}>
        {t(locale, message)}
        {error ? <> <button type="button" onClick={() => setAttempt((value) => value + 1)}>
          {t(locale, "worldPrinciplesRetry")}
        </button></> : null}
      </p> : null}
  </>;
}
