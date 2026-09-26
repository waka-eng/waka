import type { ApiGroupTimeline, ApiGroupTimelineVersion } from "../lib/api/groups";
import { formatMessage, t, type SupportedLocale } from "../lib/locales";
import { givenName } from "../lib/words";

export interface GroupHistoryEvent {
  key: string;
  at: number;
  line: string;
  kind: "reading" | "door";
}

/** One account of the room's past for both its panel and its date menu. */
export function groupHistoryEvents(timeline: ApiGroupTimeline, locale: SupportedLocale): GroupHistoryEvent[] {
  return [
    ...timeline.versions
      .filter((version) => version.reason !== "no_change")
      .map((version) => ({
        key: `v:${version.id}`,
        at: Date.parse(version.createdAt) || 0,
        kind: "reading" as const,
        line: version.reason === "initial" ? t(locale, "worldRoomFirstSpoke")
          : version.reason === "member_proposal" ? t(locale, "worldProposalCarried")
          : version.reason === "human_edit" ? t(locale, "worldSentenceReworded")
          : t(locale, "worldRoomReRead"),
      })),
    ...timeline.doorMarks.map((mark) => ({
      key: `d:${mark.profileId ?? "departed"}:${mark.kind}:${mark.occurredAt}`,
      at: Date.parse(mark.occurredAt) || 0,
      kind: "door" as const,
      line: formatMessage(locale,
        mark.kind === "joined" ? "worldArrived"
          : mark.kind === "left" ? "worldLeftRoom" : "worldWasRemoved",
        { name: mark.name ? givenName(mark.name) : t(locale, "worldSomeoneWord") }),
    })),
  ].filter((event) => event.at > 0).sort((a, b) => b.at - a.at);
}

export type HistoryGrain = "day" | "month" | "year";
export interface GroupHistoryStop { at: number; grain: HistoryGrain; label: string }

/** A dial stop means the end of its calendar period, not an arbitrary instant. */
function inStopPeriod(eventAt: number, at: number, grain: HistoryGrain): boolean {
  if (eventAt <= 0) return false;
  const date = new Date(at);
  const then = new Date(eventAt);
  return then.getFullYear() === date.getFullYear() &&
    (grain === "year" || then.getMonth() === date.getMonth() &&
      (grain === "month" || then.getDate() === date.getDate()));
}

export function eventsAtStop(events: readonly GroupHistoryEvent[], at: number, grain: HistoryGrain): GroupHistoryEvent[] {
  return events.filter((event) => inStopPeriod(event.at, at, grain));
}

/** A date's short caption, with the complete event list left in the panel. */
export function groupHistoryCaption(events: readonly GroupHistoryEvent[], locale: SupportedLocale, limit = 2): string | null {
  if (events.length === 0) return null;
  const words = events.slice(0, limit).map((event) => event.line);
  if (events.length > limit) words.push(formatMessage(locale, "worldRoomHistoryMore", { count: events.length - limit }));
  return words.join(" · ");
}

/** The wording on either side of all meaningful reads in one selected period. */
export function groupReadingChangeAtStop(
  timeline: ApiGroupTimeline,
  stop: GroupHistoryStop,
): { before: ApiGroupTimelineVersion | null; after: ApiGroupTimelineVersion } | null {
  const versions = [...timeline.versions].sort((a, b) => a.version - b.version);
  const inPeriod = versions.filter((version) =>
    inStopPeriod(Date.parse(version.createdAt) || 0, stop.at, stop.grain));
  const firstChange = inPeriod.find((version) => version.reason !== "no_change");
  if (!firstChange) return null;
  const firstIndex = versions.findIndex((version) => version.id === firstChange.id);
  return { before: versions[firstIndex - 1] ?? null, after: inPeriod[inPeriod.length - 1] };
}
