/**
 * Client for `/api/inspiration-days` — mirrors the route of the same name.
 *
 * One row per day that has anything on it. Quiet days are absent rather than
 * zero: the calendar draws its own grid and already knows every date in the
 * month, so a row per silent day would be the whole history spent saying
 * nothing happened in it.
 */

import { readerTimeZone } from "../words";
import { apiPath, getJson, type ProfileScoped } from "./http";

export interface ApiKeptDay {
  /** `YYYY-MM-DD`, in the zone the request named (UTC when it named none). */
  day: string;
  kept: number;
}

/** The days, and the zone the server actually grouped them in — the one
    asked for, or UTC when the server did not know it. */
export interface KeptDays {
  days: ApiKeptDay[];
  zone: string;
  /** True when the server used UTC because the zone asked for was absent,
      malformed or unknown. Absent from a server older than the flag. */
  fallback?: boolean;
}

/** Old names for the same place — the server's own list
    (`routes/inspiration-days.ts`), so a reply naming the new one is
    recognised as the zone that was asked for. */
const ZONE_LINKS: Record<string, string> = {
  "asia/calcutta": "asia/kolkata",
  "europe/kiev": "europe/kyiv",
  "asia/saigon": "asia/ho_chi_minh",
  "asia/katmandu": "asia/kathmandu",
  "asia/rangoon": "asia/yangon",
  "america/buenos_aires": "america/argentina/buenos_aires",
};
/** One spelling per place: lower case, old names read as their new ones. */
export function canonicalZone(tz: string): string {
  const lower = tz.toLowerCase();
  return ZONE_LINKS[lower] ?? lower;
}

export interface ListKeptDaysRequest extends ProfileScoped {
  days?: number;
  /** IANA zone to group by. Defaults to this browser's own. */
  tz?: string;
}

/** The server's own shape for a zone name (`routes/inspiration-days.ts`). A
    zone not shaped like one is not sent: the server would only fall back to
    UTC for it, and the request is cleaner without it. */
const ZONE_SHAPE = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+){0,2}$/;
export function zoneToSend(tz: string | undefined): string | undefined {
  return tz !== undefined && tz.length <= 64 && ZONE_SHAPE.test(tz) ? tz : undefined;
}

/** GET /inspiration-days — how much was kept on each day, oldest first. */
export async function listKeptDays(request: ListKeptDaysRequest = {}): Promise<KeptDays> {
  const params = new URLSearchParams();
  if (request.days !== undefined) params.set("days", String(request.days));
  const tz = zoneToSend(request.tz ?? readerTimeZone());
  if (tz) params.set("tz", tz);
  if (request.profile) params.set("profile", request.profile);
  const query = params.toString();
  const body = await getJson<{ days: ApiKeptDay[]; zone?: string; fallback?: boolean }>(
    apiPath(`/inspiration-days${query ? `?${query}` : ""}`),
    "Failed to load your days",
  );
  return {
    days: Array.isArray(body.days) ? body.days : [],
    zone: typeof body.zone === "string" ? body.zone : "UTC",
    ...(typeof body.fallback === "boolean" ? { fallback: body.fallback } : {}),
  };
}
