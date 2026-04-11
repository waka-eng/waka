export type ReflectionGroundingFixtureSourceType =
  | "TEXT_NOTE"
  | "CLI_CONVERSATION"
  | "VOICE_NOTE"
  | "PHOTO"
  | "AI_CONVERSATION";

export type ReflectionGroundingNegativeFixtureCategory =
  | "generic"
  | "templated"
  | "loosely_related";

export interface ReflectionGroundingFixture {
  expectedGroundedQuestion: string;
  id: string;
  label: string;
  sourceText: string;
  sourceType: ReflectionGroundingFixtureSourceType;
}

export interface ReflectionGroundingNegativeFixture {
  category: ReflectionGroundingNegativeFixtureCategory;
  id: string;
  prompt: string;
  sourceFixtureId: ReflectionGroundingFixture["id"];
  sourceText: string;
}

export const REFLECTION_GROUNDING_FIXTURES = [
  {
    expectedGroundedQuestion:
      'What tradeoff in "group inspiration by latent themes instead of source" needs the clearest decision next?',
    id: "latent-theme-clustering",
    label: "Latent-theme clustering tradeoff",
    sourceText:
      "Maybe Waka should group inspiration by latent themes instead of source.",
    sourceType: "TEXT_NOTE",
  },
  {
    expectedGroundedQuestion:
      "What about the subway draft versus the later desk edit feels worth preserving before last-write-wins collapses them?",
    id: "offline-queue-last-write-wins",
    label: "Offline queue last-write-wins tension",
    sourceText:
      "The offline queue should keep the subway draft and the later desk edit, but last-write-wins might hide why the commute version mattered.",
    sourceType: "CLI_CONVERSATION",
  },
  {
    expectedGroundedQuestion:
      "Which part of the train tunnel reconnect makes Apple Notes speed feel non-negotiable for save confirmation?",
    id: "apple-notes-train-reconnect",
    label: "Apple Notes trust threshold",
    sourceText:
      "Voice memo: Apple Notes speed is the bar, and if save confirmation lags after the train tunnel reconnect, trust is gone.",
    sourceType: "VOICE_NOTE",
  },
  {
    expectedGroundedQuestion:
      'Why did "surprising connections" belong beside the Discoveries feed sketch on that receipt?',
    id: "discoveries-receipt-sketch",
    label: "Photo receipt discoveries sketch",
    sourceText:
      'Photo of a bookstore receipt where "surprising connections" is circled beside a sketch for the Discoveries feed.',
    sourceType: "PHOTO",
  },
  {
    expectedGroundedQuestion:
      "What downside of the 3-second polling loop felt acceptable once Lambda subscribers ruled out SSE?",
    id: "lambda-polling-loop",
    label: "Lambda polling tradeoff",
    sourceText:
      "In the ChatGPT export, the assistant proposed a 3-second polling loop because Lambda subscribers cannot keep SSE open.",
    sourceType: "AI_CONVERSATION",
  },
] as const satisfies readonly ReflectionGroundingFixture[];

export const PRIMARY_REFLECTION_GROUNDING_FIXTURE =
  REFLECTION_GROUNDING_FIXTURES[0];

export const NEGATIVE_REFLECTION_GROUNDING_FIXTURES = [
  {
    category: "generic",
    id: "latent-theme-generic-journal",
    prompt: "What exactly sparked this thought?",
    sourceFixtureId: REFLECTION_GROUNDING_FIXTURES[0].id,
    sourceText: REFLECTION_GROUNDING_FIXTURES[0].sourceText,
  },
  {
    category: "templated",
    id: "apple-notes-templated-revisit",
    prompt: "Which part of this capture should you explore further next time?",
    sourceFixtureId: REFLECTION_GROUNDING_FIXTURES[2].id,
    sourceText: REFLECTION_GROUNDING_FIXTURES[2].sourceText,
  },
  {
    category: "loosely_related",
    id: "offline-queue-loose-weekly-planning",
    prompt: "How could last-write-wins improve your weekly planning routine?",
    sourceFixtureId: REFLECTION_GROUNDING_FIXTURES[1].id,
    sourceText: REFLECTION_GROUNDING_FIXTURES[1].sourceText,
  },
] as const satisfies readonly ReflectionGroundingNegativeFixture[];
