import { useEffect, useRef, useState } from "react";
import { fetchPrincipleRead, requestPrincipleRead, type ApiPrinciple, type ApiPrincipleStatus } from "../lib/api/principles";
import { t, type SupportedLocale } from "../lib/i18n";

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
        if (!disposed) setFailed(true);
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
  const message = error ? "worldPrinciplesError"
    : !status ? "worldPrinciplesLoading"
    : status.phase === "processing" || status.phase === "pending" ? "worldPrinciplesReading"
    : status.signalCount < 3 ? (groupId ? "worldPrinciplesNeedRoomPatterns" : "worldValuesSubSelf")
    : status.topOfMindCount < 1 ? "worldPrinciplesNeedRead"
    : "worldPrinciplesNoCandidate";
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
          {row.citedSignals.map((signal) => <p key={signal.id}>{signal.statement}</p>)}
        </details>
      </li>)}
      </ul>
    </> : null}
    {rows.length === 0 || error || status?.phase === "processing" ?
      <p className="jar-values-sub" role={error ? "alert" : "status"}>
        {t(locale, message)}
        {error ? <> <button type="button" onClick={() => setAttempt((value) => value + 1)}>
          {t(locale, "worldPrinciplesRetry")}
        </button></> : null}
      </p> : null}
  </>;
}
