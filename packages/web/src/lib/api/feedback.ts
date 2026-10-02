/**
 * Client for `/api/feedback` — mirrors `packages/api/src/routes/feedback.ts`.
 *
 * One verb: a person telling the system whether something it said about them
 * is true. It points at a signal or a top-of-mind entry, which is why it lives
 * on its own rather than under either — it is the same judgement about both.
 */

import { ApiError, apiPath, postJson } from "./http";

export type ApiFeedbackTarget = "signal" | "top_of_mind_entry" | "principle";
export type ApiFeedbackValue = "true" | "partly" | "not_true";

export interface ApiFeedback {
  id: string;
  profileId: string;
  targetType: ApiFeedbackTarget;
  targetId: string;
  value: ApiFeedbackValue;
  correctionText: string | null;
  createdAt: string;
  targetRevision?: string | null;
}

export interface CreateFeedbackRequest {
  targetType: ApiFeedbackTarget;
  targetId: string;
  value: ApiFeedbackValue;
  correctionText?: string;
  targetRevision?: string;
}

/** POST /feedback — "true", "partly", or "not true", about one thing. */
export async function createFeedback(
  input: CreateFeedbackRequest,
): Promise<ApiFeedback> {
  const body = await postJson<{ feedback: ApiFeedback }>(
    apiPath("/feedback"),
    input,
    "Failed to save feedback",
  );
  if (!body.feedback) {
    throw new ApiError({ status: 200, message: "Malformed feedback response" });
  }
  return body.feedback;
}
