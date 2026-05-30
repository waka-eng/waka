import type { ClassificationResult } from "../queue/gemini.js";
import type {
  MeaningRelationshipJudgeClient,
} from "./meaning-relationship-judge.js";
import type {
  PersistSignalPacketParams,
  PersistSignalPacketResult,
} from "./signal-packets.js";
import type {
  TopOfMindRefreshCandidate,
  TopOfMindRefreshEvidenceInput,
  TopOfMindRefreshNodeInput,
} from "./top-of-mind-refresh.js";
import type { WowJudgeClient } from "./wow-judge.js";

export interface TopOfMindNoteGenerationInput {
  userId: string;
  nodes: TopOfMindRefreshNodeInput[];
  evidence: TopOfMindRefreshEvidenceInput[];
  existingIdempotencyKeys?: Set<string>;
  limit?: number;
  now?: Date;
}

export interface ModelProvider {
  readonly name: string;
  readonly contextGraphRelationshipJudge: MeaningRelationshipJudgeClient;
  readonly topOfMindNoteJudge: WowJudgeClient;
  classifySignalText(rawText: string): Promise<ClassificationResult>;
  generateSignalPacket(
    params: PersistSignalPacketParams,
  ): Promise<PersistSignalPacketResult>;
  generateTopOfMindNotes(
    input: TopOfMindNoteGenerationInput,
  ): Promise<TopOfMindRefreshCandidate[]>;
}

let defaultProvider: ModelProvider | null = null;

export async function getDefaultModelProvider(): Promise<ModelProvider> {
  if (!defaultProvider) {
    const { createGeminiModelProvider } = await import("./gemini-model-provider.js");
    defaultProvider = createGeminiModelProvider();
  }
  return defaultProvider;
}

export function setDefaultModelProviderForTests(provider: ModelProvider | null): void {
  defaultProvider = provider;
}
