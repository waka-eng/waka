/**
 * Client for `/api/hunch` — mirrors `packages/api/src/routes/hunches.ts`.
 *
 * A hunch is the creature's one tentative line from the first saves, before a
 * reading exists (insight goal, phase 3). Yes affirms it; Not quite carries
 * what the person says instead, and a new hunch honours it.
 */
import { apiPath, getJson, postJson, type ProfileScoped } from "./http";

export interface ApiHunch { id: string; body: string; inspirationIds: string[]; status: "pending" }

const scoped = (path: string, options: ProfileScoped) => apiPath(`${path}${options.profile ? `?profile=${encodeURIComponent(options.profile)}` : ""}`);

export async function fetchHunch(options: ProfileScoped = {}): Promise<ApiHunch | null> {
  return (await getJson<{ hunch: ApiHunch | null }>(scoped("/hunch", options), "Failed to load the hunch")).hunch;
}

export async function answerHunch(id: string, answer: { answer: "yes" } | { answer: "not_quite"; correction: string },
  options: ProfileScoped = {}): Promise<void> {
  await postJson(scoped(`/hunch/${encodeURIComponent(id)}/answer`, options), answer, "Failed to answer the hunch");
}
