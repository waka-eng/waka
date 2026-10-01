import { useEffect, useState } from "react";
import { fetchGroupTopOfMind, type ApiGroupTimeline, type ApiGroupTopOfMind } from "../lib/api";
import { t, type SupportedLocale } from "../lib/locales";
import { dateWords } from "../lib/words";
import { eventsAtStop, groupHistoryEvents, groupReadingChangeAtStop, type GroupHistoryStop } from "./group-history";

type Comparison = { key: string; before: ApiGroupTopOfMind | null; after: ApiGroupTopOfMind };

function Wording({ reading, locale }: { reading: ApiGroupTopOfMind | null; locale: SupportedLocale }) {
  const entries = reading?.entries ?? [];
  return <>
    {reading?.restricted ? <p className="jar-was" role="status">{t(locale, "worldRoomReadRestricted")}</p> : null}
    {entries.length > 0 ? <ul className="jar-group-moment-words">
    {entries.map((entry) => <li key={entry.id}>{entry.body}</li>)}
  </ul> : reading?.restricted ? null : <p className="jar-was">{t(locale, "worldNothingReadTogether")}</p>}
  </>;
}

/** A selected date's complete event list and the room's wording across its read. */
export function GroupMoment({ groupId, timeline, stop, locale, readRevision }: {
  groupId: string; timeline: ApiGroupTimeline; stop: GroupHistoryStop; locale: SupportedLocale;
  readRevision?: number;
}) {
  const events = eventsAtStop(groupHistoryEvents(timeline, locale), stop.at, stop.grain);
  const change = groupReadingChangeAtStop(timeline, stop);
  const key = change ? `${groupId}:${change.before?.version ?? 0}:${change.after.version}:${readRevision ?? 0}` : null;
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!change || !key) return;
    let active = true;
    setComparison(null);
    setFailedKey(null);
    void Promise.all([
      change.before ? fetchGroupTopOfMind(groupId, change.before.version) : Promise.resolve(null),
      fetchGroupTopOfMind(groupId, change.after.version),
    ]).then(([before, after]) => {
      if (!after.topOfMind || (change.before && !before?.topOfMind)) {
        throw new Error("The timeline named a room version that could not be read");
      }
      if (active) setComparison({ key, before, after });
    }).catch(() => {
      if (active) setFailedKey(key);
    });
    return () => { active = false; };
  }, [groupId, change?.before?.version, change?.after.version, key, attempt, readRevision]);

  const ready = comparison?.key === key ? comparison : null;
  const beforeWords = ready?.before?.entries.map((entry) => entry.body) ?? [];
  const afterWords = ready?.after.entries.map((entry) => entry.body) ?? [];
  const wordingHeld = !ready?.before?.restricted && !ready?.after.restricted && beforeWords.length > 0 && beforeWords.length === afterWords.length &&
    beforeWords.every((body, index) => body === afterWords[index]);
  return <section className="jar-group-moment" aria-label={t(locale, "worldRoomHistorySelected")}>
    <p className="jar-prov-lead jar-label">{t(locale, "worldRoomHistorySelected")} · {stop.label}</p>
    {events.map((event) => <p key={event.key} className="jar-was">
      {event.line} · {dateWords(event.at, Date.now(), locale)}
    </p>)}
    {change && key ? failedKey === key ? <p className="jar-was" role="alert">
      {t(locale, "worldRoomHistoryFailed")}{" "}
      <button type="button" onClick={() => setAttempt((value) => value + 1)}>
        {t(locale, "worldRoomHistoryRetry")}
      </button>
    </p> : ready ? <div className="jar-group-moment-compare">
      <div>
        <p className="jar-label">{t(locale, "worldRoomHistoryBefore")}</p>
        <Wording reading={ready.before} locale={locale} />
      </div>
      <div>
        <p className="jar-label">{t(locale, "worldRoomHistoryAfter")}</p>
        <Wording reading={ready.after} locale={locale} />
      </div>
      {wordingHeld
        ? <p className="jar-was">{t(locale, "worldRoomHistoryUnchanged")}</p> : null}
    </div> : <p className="jar-was" role="status">{t(locale, "worldRoomHistoryLoading")}</p> : null}
  </section>;
}
