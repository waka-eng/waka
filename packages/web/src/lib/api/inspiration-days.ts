/**
 * Client for `/api/inspiration-days` — mirrors the route of the same name.
 *
 * One row per day that has anything on it. Quiet days are absent rather than
 * zero: the calendar draws its own grid and already knows every date in the
 * month, so a row per silent day would be the whole history spent saying
 * nothing happened in it.
 */

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

/**
 * The browser's own IANA zone, or nothing when it will not say.
 *
 * Without it the server grouped by UTC, and a save made at 8am in Seoul landed
 * on the previous date — the calendar a person reads is their own clock's.
 */
function browserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

/** GET /inspiration-days — how much was kept on each day, oldest first. */
export async function listKeptDays(request: ListKeptDaysRequest = {}): Promise<ApiKeptDay[]> {
  const params = new URLSearchParams();
  if (request.days !== undefined) params.set("days", String(request.days));
  const tz = request.tz ?? browserTimeZone();
  if (tz) params.set("tz", tz);
  if (request.profile) params.set("profile", request.profile);
  const query = params.toString();
  const body = await getJson<{ days: ApiKeptDay[] }>(
    apiPath(`/inspiration-days${query ? `?${query}` : ""}`),
    "Failed to load your days",
  );
  return Array.isArray(body.days) ? body.days : [];
}
