/**
 * The read-record client — who has been served whose derived memory.
 *
 * Read-only by design: consultations are infrastructure beside sessions
 * (never a fifth layer), and the account screen shows them so the owner can
 * see the reads their rules permit actually happening. A null reader is an
 * erased account — "someone" — and rendering that honestly is the point.
 */
import { apiPath, getJson } from "./http";

export interface ApiConsultation {
  id: string;
  /** Whose memory was served. */
  profile: { id: string; name: string };
  /** Who read it; null once the reader erased their account. */
  reader: { id: string; name: string } | null;
  surface: "signals" | "top_of_mind" | "principles" | "weather" | "export";
  artifactVersion: number | null;
  renderedOn: string | null;
  servedAt: string;
}

/** GET /consultations — the account's read record, newest first. */
export async function fetchConsultations(limit?: number): Promise<ApiConsultation[]> {
  const query = limit ? `?limit=${limit}` : "";
  const body = await getJson<{ consultations: ApiConsultation[] }>(
    apiPath(`/consultations${query}`),
    "Failed to load the read record",
  );
  return Array.isArray(body.consultations) ? body.consultations : [];
}
