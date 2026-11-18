/**
 * Binds the provider interface to the pinned Gemini model through OpenRouter.
 *
 * Thin on purpose: everything interesting about a generation lives either in
 * the prompt (queue/gemini.ts) or in the deterministic pipeline around it
 * (lib/signal-derivation.ts, lib/top-of-mind-synthesis.ts). A provider that
 * accumulates logic is a provider you cannot swap.
 */

import {
  GEMINI_GENERATION_MODEL,
  askReflectionQuestion,
  askReviewQuestion,
  answerConversation,
  deriveReviewAnswer,
  assessSignalSupport,
  distillPrinciples,
  assessPrincipleGrounding,
  extractSignalCandidates,
  judgePrincipleRelation,
  judgeSignalMatch,
  routeDeclaration,
  synthesizeTopOfMind,
  reviewTopOfMind,
} from "../queue/gemini.js";
import type { ModelProvider } from "./model-provider.js";

export function createGeminiModelProvider(): ModelProvider {
  return {
    name: "openrouter",
    pinnedModel: GEMINI_GENERATION_MODEL,
    askReflectionQuestion,
    askReviewQuestion,
    answerConversation,
    deriveReviewAnswer,
    assessSignalSupport,
    extractSignalCandidates,
    judgeSignalMatch,
    synthesizeTopOfMind,
    reviewTopOfMind,
    distillPrinciples,
    assessPrincipleGrounding,
    judgePrincipleRelation,
    routeDeclaration,
  };
}
