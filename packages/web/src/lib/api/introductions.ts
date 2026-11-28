/**
 * Client for `/api/introductions` — mirrors `packages/api/src/routes/introductions.ts`.
 *
 * WAKA introduces two consenting people whose principles overlap. Only
 * principles are compared, never saves; nothing about the other person is
 * ever returned, not even a name: only this person's own principle words,
 * once both said Introduce us to that match.
 */
import { apiPath, getJson, postJson } from "./http";

export type ApiIntroduction =
  | { id: string; stage: "ask" }
  | { id: string; stage: "introduced"; principle: string };

export interface ApiIntroductionState {
  available: boolean;
  consent: { enabled: boolean; answered: boolean };
  offerConsent: boolean;
  introduction: ApiIntroduction | null;
}

export type ApiIntroductionAnswer =
  | { stage: "waiting" }
  | { stage: "declined" }
  | Extract<ApiIntroduction, { stage: "introduced" }>;

export async function fetchIntroductions(): Promise<ApiIntroductionState> {
  return getJson<ApiIntroductionState>(apiPath("/introductions"), "Failed to load introductions");
}

export async function setIntroductionConsent(enabled: boolean): Promise<void> {
  await postJson(apiPath("/introductions/consent"), { enabled }, "Failed to change introductions");
}

export async function answerIntroduction(id: string, answer: "yes" | "no"): Promise<ApiIntroductionAnswer> {
  return postJson<ApiIntroductionAnswer>(apiPath(`/introductions/${encodeURIComponent(id)}/answer`), { answer }, "Failed to answer the introduction");
}

export async function markIntroductionSeen(id: string): Promise<void> {
  await postJson(apiPath(`/introductions/${encodeURIComponent(id)}/seen`), {}, "Failed to close the introduction");
}
