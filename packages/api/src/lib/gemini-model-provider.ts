import { classifyInspirationText } from "../queue/gemini.js";
import { GeminiAmbitionSynthesisClient } from "./ambition-synthesis-gemini.js";
import { GeminiMeaningRelationshipJudgeClient } from "./meaning-relationship-judge.js";
import type { ModelProvider } from "./model-provider.js";
import { persistSignalPacketForSignal } from "./signal-packets.js";
import { rankTopOfMindRefreshCandidates } from "./top-of-mind-refresh.js";
import { GeminiWowJudgeClient } from "./wow-judge.js";

export function createGeminiModelProvider(): ModelProvider {
  const ambitionSynthesisClient = new GeminiAmbitionSynthesisClient();

  return {
    name: "gemini",
    contextGraphRelationshipJudge: new GeminiMeaningRelationshipJudgeClient(),
    topOfMindNoteJudge: new GeminiWowJudgeClient(),
    classifySignalText: classifyInspirationText,
    generateSignalPacket: persistSignalPacketForSignal,
    async generateTopOfMindNotes(input) {
      return rankTopOfMindRefreshCandidates(input);
    },
    async synthesizeAmbition(input) {
      try {
        return await ambitionSynthesisClient.synthesizeAmbition(input);
      } catch (err) {
        // Synthesis is best-effort: returning null lets the bounded loop record
        // the provider failure without silently persisting deterministic text.
        console.warn("[gemini] ambition synthesis threw; returning null", {
          synthesisKey: input.synthesisKey,
          errorName: err instanceof Error ? err.name : typeof err,
        });
        return null;
      }
    },
  };
}
