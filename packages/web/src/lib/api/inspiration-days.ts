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

export interface ListKeptDaysRequest extends ProfileScoped {
  days?: number;
  /** IANA zone to group by. Defaults to this browser's own. */
  tz?: string;
}

/** GET /inspiration-days — how much was kept on each day, oldest first. */
export async function listKeptDays(request: ListKeptDaysRequest = {}): Promise<ApiKeptDay[]> {
  const params = new URLSearchParams();
  if (request.days !== undefined) params.set("days", String(request.days));
  const tz = request.tz ?? readerTimeZone();
  if (tz) params.set("tz", tz);
  if (request.profile) params.set("profile", request.profile);
  const query = params.toString();
  const body = await getJson<{ days: ApiKeptDay[] }>(
    apiPath(`/inspiration-days${query ? `?${query}` : ""}`),
    "Failed to load your days",
  );
  return Array.isArray(body.days) ? body.days : [];
}
