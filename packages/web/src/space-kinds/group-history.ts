import type { ApiGroupTimeline } from "../lib/api/groups";
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

/** A dial stop means the end of its calendar period, not an arbitrary instant. */
export function eventsAtStop(events: readonly GroupHistoryEvent[], at: number, grain: HistoryGrain): GroupHistoryEvent[] {
  const date = new Date(at);
  return events.filter((event) => {
    const then = new Date(event.at);
    return then.getFullYear() === date.getFullYear() &&
      (grain === "year" || then.getMonth() === date.getMonth() &&
        (grain === "month" || then.getDate() === date.getDate()));
  });
}

/** A date's short caption, with the complete event list left in the panel. */
export function groupHistoryCaption(events: readonly GroupHistoryEvent[], locale: SupportedLocale, limit = 2): string | null {
  if (events.length === 0) return null;
  const words = events.slice(0, limit).map((event) => event.line);
  if (events.length > limit) words.push(formatMessage(locale, "worldRoomHistoryMore", { count: events.length - limit }));
  return words.join(" · ");
}
