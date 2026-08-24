/**
 * The weather — what the loop did, told as days.
 *
 * One GET of `/api/weather`. The server assembles every sentence as a VIEW
 * of stored records (`the-weather.db.test.ts` proves a deleted record loses
 * its sentence), words every count and day label, and hands the world three
 * things: the told sentence for this caller's away-window, the fortnight of
 * days, and the antechamber — the refused candidates standing in the dim
 * place, each with its anchor. The client adds nothing and rewords nothing.
 */
import { apiPath, getJson } from "./http";

export interface ApiWeatherSentence {
  text: string;
  backing: string;
}

export interface ApiWeatherDay {
  daysAgo: number;
  label: string;
  sentences: ApiWeatherSentence[];
}

export interface ApiAntechamberRow {
  id: string;
  /** the refused candidate's words */
  candidateStatement: string;
  /** the dismissed signal whose vector refused it; null once truly deleted */
  anchorSignalId: string | null;
  /** what the anchor said at the moment it refused — outlives the anchor */
  anchorStatement: string;
  /** whether the anchor still refuses — false after restore or deletion */
  anchorStillRefusing: boolean;
  suppressedAt: string;
}

export interface ApiWeather {
  /** one sentence for the away-window; null when nothing happened */
  told: string | null;
  days: ApiWeatherDay[];
  antechamber: ApiAntechamberRow[];
}

export async function fetchTheWeather(options: { since?: Date } = {}): Promise<ApiWeather> {
  const params = new URLSearchParams();
  if (options.since) params.set("since", options.since.toISOString());
  const query = params.toString();
  const body = await getJson<{ weather: ApiWeather }>(
    apiPath(`/weather${query ? `?${query}` : ""}`),
    "Failed to read the weather",
  );
  return body.weather;
}
