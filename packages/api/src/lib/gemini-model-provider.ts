import { classifyInspirationText } from "../queue/gemini.js";
import { GeminiMeaningRelationshipJudgeClient } from "./meaning-relationship-judge.js";
import type { ModelProvider } from "./model-provider.js";
import { persistSignalPacketForSignal } from "./signal-packets.js";
import { rankTopOfMindRefreshCandidates } from "./top-of-mind-refresh.js";
import { GeminiWowJudgeClient } from "./wow-judge.js";

export function createGeminiModelProvider(): ModelProvider {
  return {
    name: "gemini",
    contextGraphRelationshipJudge: new GeminiMeaningRelationshipJudgeClient(),
    topOfMindNoteJudge: new GeminiWowJudgeClient(),
    classifySignalText: classifyInspirationText,
    generateSignalPacket: persistSignalPacketForSignal,
    async generateTopOfMindNotes(input) {
      return rankTopOfMindRefreshCandidates(input);
    },
  };
}
