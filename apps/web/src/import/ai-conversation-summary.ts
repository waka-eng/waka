import type {
  AiConversationProvider,
  CanonicalAiConversationParticipant,
  CanonicalAiConversationSourceMeta,
  CanonicalAiConversationTurn,
} from "./ai-conversation.ts";

const AI_CONVERSATION_SUMMARY_PREAMBLE =
  "Summarize this AI conversation for semantic retrieval and embeddings. Preserve the user's core intents, named entities, concrete decisions, constraints, unresolved questions, and next steps. Omit filler, greetings, acknowledgements, and repeated phrasing.";
const AI_CONVERSATION_SUMMARY_INPUT_MAX_CHARACTERS = 6_000;
const AI_CONVERSATION_SUMMARY_MAX_SELECTED_TURNS = 18;
const AI_CONVERSATION_SUMMARY_MIN_SELECTED_TURNS = 6;
const AI_CONVERSATION_RAW_TRANSCRIPT_MAX_CHARACTERS = 4_200;
const AI_CONVERSATION_TURN_MAX_CHARACTERS = 360;

const AI_CONVERSATION_PROVIDERS = new Set<AiConversationProvider>([
  "claude",
  "chatgpt",
  "gemini",
  "other",
]);

const SIGNAL_KEYWORD_PATTERN =
  /\b(action items?|constraint|decision|deliverable|dependency|goal|implement(?:ation)?|issue|launch|must|need(?:ed|s)?|next steps?|open question|plan|problem|require(?:d|ment|s)?|risk|ship|should|todo|trade[- ]?off)\b/i;

const TECH_ENTITY_PATTERN =
  /\b(auth\.js|aws|cloudfront|dbscan|gemini|google|lambda|neon|next\.js|openai|pgvector|postgres|prisma|react|s3|sqs|sst|tailwind|typescript)\b/i;

const FILLER_PATTERNS = [
  /^(hi|hello|hey)( there)?[.!]*$/i,
  /^(thanks|thank you|thx)[.!]*$/i,
  /^(ok|okay|got it|sounds good|sure|yep|yes)[.!]*$/i,
  /^(happy to help|let me know|anything else)[.!]*$/i,
  /^how can i help\??$/i,
  /^(great question|good question)[.!]*$/i,
  /^(understood|noted|will do)[.!]*$/i,
] as const;

interface NormalizedSummaryTurn {
  index: number;
  role?: string;
  speaker: string;
  text: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readOptionalTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalizedValue = value.replace(/\s+/g, " ").trim();

  return normalizedValue.length > 0 ? normalizedValue : undefined;
}

function readOptionalPositiveInteger(value: unknown): number | undefined {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : undefined;
}

function readOptionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const values = value.flatMap((entry) => {
    const normalizedValue = readOptionalTrimmedString(entry);
    return normalizedValue === undefined ? [] : [normalizedValue];
  });

  return values.length > 0 ? values : undefined;
}

function clampText(value: string, maxCharacters: number): string {
  if (value.length <= maxCharacters) {
    return value;
  }

  const prefix = value.slice(0, Math.max(0, maxCharacters - 3)).trimEnd();
  const lastWhitespace = Math.max(prefix.lastIndexOf(" "), prefix.lastIndexOf("\n"));
  const safePrefix =
    lastWhitespace >= Math.floor(prefix.length * 0.7)
      ? prefix.slice(0, lastWhitespace).trimEnd()
      : prefix;

  return `${safePrefix}...`;
}

function formatConversationRole(value: unknown): string {
  const normalizedValue = readOptionalTrimmedString(value)?.toLowerCase();

  switch (normalizedValue) {
    case "assistant":
      return "Assistant";
    case "system":
      return "System";
    case "user":
      return "User";
    default:
      return normalizedValue === undefined
        ? "Speaker"
        : normalizedValue.charAt(0).toUpperCase() + normalizedValue.slice(1);
  }
}

function formatProviderName(provider: AiConversationProvider): string {
  switch (provider) {
    case "chatgpt":
      return "ChatGPT";
    case "claude":
      return "Claude";
    case "gemini":
      return "Gemini";
    default:
      return "Other";
  }
}

function isAiConversationSourceMeta(
  value: unknown,
): value is CanonicalAiConversationSourceMeta {
  if (!isRecord(value)) {
    return false;
  }

  const provider = readOptionalTrimmedString(value.provider);

  return provider !== undefined && AI_CONVERSATION_PROVIDERS.has(provider as AiConversationProvider);
}

function readParticipantName(
  participant: CanonicalAiConversationParticipant | undefined,
): string | undefined {
  return readOptionalTrimmedString(participant?.name);
}

function resolveTurnSpeaker(
  turn: Pick<
    CanonicalAiConversationTurn,
    "participantIndex" | "participantIdentityId" | "role"
  >,
  participants: readonly CanonicalAiConversationParticipant[],
  participantNames: readonly string[],
): string {
  if (
    typeof turn.participantIndex === "number" &&
    turn.participantIndex >= 0 &&
    turn.participantIndex < Math.max(participants.length, participantNames.length)
  ) {
    const participantName =
      participantNames[turn.participantIndex] ??
      readParticipantName(participants[turn.participantIndex]);

    if (participantName !== undefined) {
      return participantName;
    }
  }

  if (turn.participantIdentityId !== undefined) {
    const matchingParticipant = participants.find(
      (participant) => participant.identityId === turn.participantIdentityId,
    );
    const participantName = readParticipantName(matchingParticipant);

    if (participantName !== undefined) {
      return participantName;
    }
  }

  return formatConversationRole(turn.role);
}

function normalizeSummaryTurns(
  sourceMeta: CanonicalAiConversationSourceMeta,
): NormalizedSummaryTurn[] {
  const turns = Array.isArray(sourceMeta.turns) ? sourceMeta.turns : [];
  const participants = Array.isArray(sourceMeta.participants)
    ? sourceMeta.participants
    : [];
  const participantNames = readOptionalStringArray(sourceMeta.participantNames) ?? [];
  const seenTexts = new Set<string>();
  const normalizedTurns: NormalizedSummaryTurn[] = [];

  for (const [index, turn] of turns.entries()) {
    if (!isRecord(turn)) {
      continue;
    }

    const text = readOptionalTrimmedString(turn.text);

    if (text === undefined) {
      continue;
    }

    const dedupeKey = text.toLowerCase();

    if (seenTexts.has(dedupeKey)) {
      continue;
    }

    seenTexts.add(dedupeKey);
    normalizedTurns.push({
      index,
      role: readOptionalTrimmedString(turn.role),
      speaker: resolveTurnSpeaker(turn, participants, participantNames),
      text: clampText(text, AI_CONVERSATION_TURN_MAX_CHARACTERS),
    });
  }

  return normalizedTurns;
}

function isLikelyFillerTurn(text: string): boolean {
  if (
    SIGNAL_KEYWORD_PATTERN.test(text) ||
    TECH_ENTITY_PATTERN.test(text) ||
    /\d/.test(text) ||
    /https?:\/\//i.test(text)
  ) {
    return false;
  }

  const normalizedText = text.trim();

  if (normalizedText.length > 120) {
    return false;
  }

  return FILLER_PATTERNS.some((pattern) => pattern.test(normalizedText));
}

function scoreSummaryTurn(turn: NormalizedSummaryTurn): number {
  let score = 0;

  if (turn.role?.toLowerCase() === "user") {
    score += 3;
  }

  if (SIGNAL_KEYWORD_PATTERN.test(turn.text)) {
    score += 4;
  }

  if (TECH_ENTITY_PATTERN.test(turn.text)) {
    score += 3;
  }

  if (/\b[A-Z][A-Za-z0-9._-]{2,}\b/.test(turn.text) || /\d/.test(turn.text)) {
    score += 1;
  }

  if (turn.text.length >= 120) {
    score += 1;
  }

  if (isLikelyFillerTurn(turn.text)) {
    score -= 8;
  }

  return score;
}

function selectHighSignalTurns(
  turns: readonly NormalizedSummaryTurn[],
): NormalizedSummaryTurn[] {
  if (turns.length <= AI_CONVERSATION_SUMMARY_MAX_SELECTED_TURNS) {
    const nonFillerTurns = turns.filter((turn) => !isLikelyFillerTurn(turn.text));
    return nonFillerTurns.length > 0 ? nonFillerTurns : [...turns];
  }

  const rankedTurns = turns.map((turn) => ({
    score: scoreSummaryTurn(turn),
    turn,
  }));
  const selectedIndices = new Set<number>();

  const firstUserTurn = rankedTurns.find(
    ({ turn }) => turn.role?.toLowerCase() === "user",
  )?.turn.index;
  const requiredIndices = [
    turns[0]?.index,
    firstUserTurn,
    turns[turns.length - 1]?.index,
  ].filter((index): index is number => typeof index === "number");

  for (const requiredIndex of requiredIndices) {
    selectedIndices.add(requiredIndex);
  }

  const prioritizedTurns = [...rankedTurns].sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }

    return left.turn.index - right.turn.index;
  });

  for (const { turn } of prioritizedTurns) {
    if (selectedIndices.size >= AI_CONVERSATION_SUMMARY_MAX_SELECTED_TURNS) {
      break;
    }

    if (isLikelyFillerTurn(turn.text) && selectedIndices.size >= requiredIndices.length) {
      continue;
    }

    selectedIndices.add(turn.index);
  }

  const selectedTurns = turns.filter((turn) => selectedIndices.has(turn.index));
  const nonFillerTurns = selectedTurns.filter((turn) => !isLikelyFillerTurn(turn.text));

  if (nonFillerTurns.length >= AI_CONVERSATION_SUMMARY_MIN_SELECTED_TURNS) {
    return nonFillerTurns;
  }

  return selectedTurns;
}

function buildMetadataLines(
  sourceMeta: CanonicalAiConversationSourceMeta,
): string[] {
  const participantNames = Array.from(
    new Set(
      readOptionalStringArray(sourceMeta.participantNames) ??
        (Array.isArray(sourceMeta.participants)
          ? sourceMeta.participants.flatMap((participant) => {
              const participantName = readParticipantName(participant);
              return participantName === undefined ? [] : [participantName];
            })
          : []),
    ),
  );
  const turnCount =
    readOptionalPositiveInteger(sourceMeta.turnCount) ??
    (Array.isArray(sourceMeta.turns) ? sourceMeta.turns.length : undefined);
  const metadataLines = [`Provider: ${formatProviderName(sourceMeta.provider)}`];

  const conversationTitle = readOptionalTrimmedString(sourceMeta.conversationTitle);

  if (conversationTitle !== undefined) {
    metadataLines.push(`Title: ${conversationTitle}`);
  }

  const model = readOptionalTrimmedString(sourceMeta.model);

  if (model !== undefined) {
    metadataLines.push(`Model: ${model}`);
  }

  if (participantNames.length > 0) {
    metadataLines.push(`Participants: ${participantNames.join(", ")}`);
  }

  if (turnCount !== undefined) {
    metadataLines.push(`Turn count: ${turnCount}`);
  }

  return metadataLines;
}

function buildTurnSection(sourceMeta: CanonicalAiConversationSourceMeta): string | undefined {
  const selectedTurns = selectHighSignalTurns(normalizeSummaryTurns(sourceMeta));

  if (selectedTurns.length === 0) {
    return undefined;
  }

  return selectedTurns
    .map((turn) => `${turn.speaker}: ${turn.text}`)
    .join("\n");
}

export function buildAiConversationSummaryPromptContent(args: {
  rawContent: string;
  sourceMeta?: Record<string, unknown> | null;
}): string | undefined {
  const sourceMeta = isAiConversationSourceMeta(args.sourceMeta)
    ? args.sourceMeta
    : undefined;

  if (sourceMeta === undefined) {
    return undefined;
  }

  const normalizedRawContent = readOptionalTrimmedString(args.rawContent) ?? args.rawContent;
  const sections = [AI_CONVERSATION_SUMMARY_PREAMBLE];
  const metadataLines = buildMetadataLines(sourceMeta);

  if (metadataLines.length > 0) {
    sections.push(`Conversation metadata:\n${metadataLines.join("\n")}`);
  }

  const turnSection = buildTurnSection(sourceMeta);

  if (turnSection !== undefined) {
    sections.push(`High-signal turns:\n${turnSection}`);
  } else {
    sections.push(
      `Transcript excerpt:\n${clampText(normalizedRawContent, AI_CONVERSATION_RAW_TRANSCRIPT_MAX_CHARACTERS)}`,
    );
  }

  return clampText(
    sections.join("\n\n"),
    AI_CONVERSATION_SUMMARY_INPUT_MAX_CHARACTERS,
  );
}
