/**
 * Binds the provider interface to the Gemini client.
 *
 * Thin on purpose: everything interesting about a generation lives either in
 * the prompt (queue/gemini.ts) or in the deterministic pipeline around it
 * (lib/signal-derivation.ts, lib/top-of-mind-synthesis.ts). A provider that
 * accumulates logic is a provider you cannot swap.
 */

import {
  askReflectionQuestion,
  assessSignalSupport,
  distillPrinciples,
  extractSignalCandidates,
  judgePrincipleRelation,
  judgeSignalMatch,
  routeDeclaration,
  synthesizeTopOfMind,
} from "../queue/gemini.js";
import type { ModelProvider } from "./model-provider.js";

export function createGeminiModelProvider(): ModelProvider {
  return {
    name: "gemini",
    askReflectionQuestion,
    assessSignalSupport,
    extractSignalCandidates,
    judgeSignalMatch,
    synthesizeTopOfMind,
    distillPrinciples,
    judgePrincipleRelation,
    routeDeclaration,
  };
}
