import { useEffect, useRef, useState } from "react";
import { fetchPrincipleRead, requestPrincipleRead, type ApiPrinciple, type ApiPrincipleStatus } from "../lib/api/principles";
import { t, type SupportedLocale } from "../lib/i18n";

/**
 * Only the selected wall polls. Requests never render another wall's values.
 *
 * ── A ROOM'S PHILOSOPHIES AND VALUES ARE GONE (2026-10-12) ──────────────
 *
 * Founder: "방 없애" — remove rooms.
 *
 * This component answered for two spaces and the room half was the larger
 * one: a `groupId` switched every request onto `/groups/:id/principles`, a
 * `refreshKey` re-read it whenever the room's wall or board was refetched,
 * and `GROUP_READ_TTL_MS` armed a timer that BLANKED the rows after thirty
 * seconds — because a shared read is permission-sensitive and a version
 * number cannot tell you access was revoked. Leaving a room's wall cleared
 * the rows too, so a neighbouring column could never retain another room's
 * last verified wording. There was a whole staged empty state with it: three
 * patterns needed, then a reading, then a candidate, with a progress bar and
 * a sentence per stage, and a restricted branch for a room you could no
 * longer read.
 *
 * It rests on the ruling in `goals/room-timeline.md` (since removed) that
 * every room would grow its own philosophies and values. That is now a ruling about a thing that
 * does not exist. Your own sky is untouched, which is where this started.
 */
export function PrincipleRead({ active, locale, onRead }: {
  active: boolean; locale: SupportedLocale;
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
        const result = await fetchPrincipleRead();
        if (disposed) return;
        setRows(result.principles);
        onReadRef.current?.(result.principles);
        setStatus(result.status);
        setFailed(false);
        consecutiveFailures = 0;
        delay = result.status.phase === "processing" || result.status.phase === "pending"
          ? 10_000 : 60_000;
        if (!ensured && ((result.status.eligible && !result.status.supportPending && result.status.phase === 'pending') ||
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
  }, [active, locale, attempt]);
  const error = failed || status?.phase === "failed";
  const visibleRows = rows;
  const message = error ? status?.supportPending ? 'worldSupportCheckFailed' : "worldPrinciplesError"
    : !status ? "worldPrinciplesLoading"
    : status.supportPending ? (status.phase === 'processing' ? 'worldSupportChecking' : status.phase === 'pending' ? 'worldSupportQueued' : 'worldSupportNeedsContext')
    : status.phase === "processing" || status.phase === "pending" ? "worldPrinciplesReading"
    : status.signalCount < 3 ? "worldValuesSubSelf"
    : status.topOfMindCount < 1 ? "worldPrinciplesNeedRead"
    : "worldPrinciplesNoCandidate";
  /* THE ROOM'S WHOLE RENDER WENT FROM HERE: its own eyebrow, its own list
     (a room's values were listed by this component; your own are drawn by
     the sky), the staged empty state with its three-pattern progress bar and
     a lead and a detail sentence per stage, and the restricted branch. What
     is left is your own sky's lead line and the one status sentence, which
     is what this file held before rooms ever reached into it. */
  return <>
    {visibleRows.length === 0 ? <p className="jar-values-lead">{t(locale, "worldValuesLeadSelf")}</p> : null}
    {visibleRows.length === 0 || error || status?.phase === "processing" ?
      <p className="jar-values-sub" role={error ? "alert" : status?.phase === "processing" ? "status" : undefined}>
        {t(locale, message)}
        {error ? <> <button type="button" onClick={() => setAttempt((value) => value + 1)}>
          {t(locale, "worldPrinciplesRetry")}
        </button></> : null}
      </p> : null}
  </>;
}
