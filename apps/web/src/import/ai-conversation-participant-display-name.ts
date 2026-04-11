import type {
  AiConversationProvider,
  CanonicalAiConversationParticipant,
} from "./ai-conversation.ts";

const PARTICIPANT_NAME_METADATA_FIELDS = [
  "displayName",
  "display_name",
  "fullName",
  "full_name",
  "label",
  "name",
];

const PARTICIPANT_USERNAME_METADATA_FIELDS = [
  "username",
  "userName",
  "user_name",
];

const PARTICIPANT_HANDLE_METADATA_FIELDS = ["handle"];

const PARTICIPANT_EMAIL_METADATA_FIELDS = ["email"];

const GENERIC_PARTICIPANT_DISPLAY_NAMES = new Set([
  "ai",
  "assistant",
  "bot",
  "human",
  "model",
  "participant",
  "person",
  "prompt",
  "speaker",
  "system",
  "user",
]);

export interface CanonicalParticipantDisplayNameCandidate {
  priority: number;
  value: string;
}

interface DeriveCanonicalParticipantDisplayNameCandidateArgs {
  assistantName?: string;
  participant: CanonicalAiConversationParticipant;
  provider: AiConversationProvider;
}

function readOptionalTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmedValue = value.trim();

  return trimmedValue.length > 0 ? trimmedValue : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeDisplayNameComparisonValue(value: string): string {
  return collapseWhitespace(value)
    .toLowerCase()
    .replace(/^@+/, "")
    .replace(/[_\-.]+/g, " ")
    .replace(/[^a-z0-9 ]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function formatTitleCaseWord(value: string): string {
  if (value.length === 0) {
    return value;
  }

  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) {
    return value;
  }

  if (/^[A-Z0-9]{2,5}$/.test(value)) {
    return value;
  }

  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

function formatIdentifierDisplayName(value: string): string | undefined {
  const normalizedValue = collapseWhitespace(value).replace(/^@+/, "");
  const localPart = normalizedValue.includes("@")
    ? normalizedValue.slice(0, normalizedValue.indexOf("@"))
    : normalizedValue;
  const words = localPart.split(/[\s._-]+/).filter((word) => word.length > 0);

  if (words.length === 0) {
    return undefined;
  }

  return words.map((word) => formatTitleCaseWord(word)).join(" ");
}

function canonicalizeKnownParticipantLabel(value: string): string | undefined {
  switch (normalizeDisplayNameComparisonValue(value)) {
    case "chatgpt":
    case "chat gpt":
      return "ChatGPT";
    case "claude":
    case "claude ai":
      return "Claude";
    case "gemini":
    case "google gemini":
      return "Gemini";
    case "system":
      return "System";
    case "user":
    case "human":
      return "User";
    default:
      return undefined;
  }
}

function isGenericParticipantDisplayName(value: string): boolean {
  return GENERIC_PARTICIPANT_DISPLAY_NAMES.has(
    normalizeDisplayNameComparisonValue(value),
  );
}

function cleanupFreeformDisplayName(value: string): string | undefined {
  const cleanedValue = collapseWhitespace(value).replace(/^["'`]+|["'`]+$/g, "");

  return cleanedValue.length > 0 ? cleanedValue : undefined;
}

function readMetadataValue(
  participant: CanonicalAiConversationParticipant,
  fieldNames: readonly string[],
): string | undefined {
  if (!isRecord(participant.sourceMetadata)) {
    return undefined;
  }

  for (const fieldName of fieldNames) {
    const value = readOptionalTrimmedString(participant.sourceMetadata[fieldName]);

    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
}

function formatNamedDisplayCandidate(value: string): string | undefined {
  const cleanedValue = cleanupFreeformDisplayName(value);

  if (cleanedValue === undefined) {
    return undefined;
  }

  return canonicalizeKnownParticipantLabel(cleanedValue) ?? cleanedValue;
}

function createDisplayNameCandidate(
  value: string | undefined,
  priority: number,
  options: {
    allowGeneric?: boolean;
  } = {},
): CanonicalParticipantDisplayNameCandidate | undefined {
  if (
    value === undefined ||
    (!options.allowGeneric && isGenericParticipantDisplayName(value))
  ) {
    return undefined;
  }

  return {
    priority,
    value,
  };
}

function deriveAssistantFallbackDisplayName(
  provider: AiConversationProvider,
  assistantName: string | undefined,
): string {
  const cleanedAssistantName = formatNamedDisplayCandidate(assistantName ?? "");

  if (
    cleanedAssistantName !== undefined &&
    !isGenericParticipantDisplayName(cleanedAssistantName)
  ) {
    return cleanedAssistantName;
  }

  switch (provider) {
    case "chatgpt":
      return "ChatGPT";
    case "claude":
      return "Claude";
    case "gemini":
      return "Gemini";
    default:
      return "Assistant";
  }
}

function deriveRoleFallbackDisplayName(
  role: string | undefined,
  provider: AiConversationProvider,
  assistantName: string | undefined,
): string | undefined {
  const normalizedRole = normalizeDisplayNameComparisonValue(role ?? "");

  switch (normalizedRole) {
    case "ai":
    case "assistant":
    case "bard":
    case "bot":
    case "chatgpt":
    case "claude":
    case "gemini":
    case "model":
      return deriveAssistantFallbackDisplayName(provider, assistantName);
    case "human":
    case "prompt":
    case "user":
      return "User";
    case "system":
      return "System";
    default:
      return role === undefined ? undefined : formatIdentifierDisplayName(role);
  }
}

export function selectPreferredCanonicalParticipantDisplayName(
  current:
    | CanonicalParticipantDisplayNameCandidate
    | undefined,
  next:
    | CanonicalParticipantDisplayNameCandidate
    | undefined,
): CanonicalParticipantDisplayNameCandidate | undefined {
  if (current === undefined) {
    return next;
  }

  if (next === undefined) {
    return current;
  }

  if (next.priority !== current.priority) {
    return next.priority > current.priority ? next : current;
  }

  if (next.value.length !== current.value.length) {
    return next.value.length > current.value.length ? next : current;
  }

  return next.value.localeCompare(current.value) < 0 ? next : current;
}

export function deriveCanonicalParticipantDisplayNameCandidate(
  args: DeriveCanonicalParticipantDisplayNameCandidateArgs,
): CanonicalParticipantDisplayNameCandidate | undefined {
  const explicitName = createDisplayNameCandidate(
    formatNamedDisplayCandidate(args.participant.name ?? ""),
    5,
  );

  if (explicitName !== undefined) {
    return explicitName;
  }

  const metadataName = createDisplayNameCandidate(
    formatNamedDisplayCandidate(
      readMetadataValue(args.participant, PARTICIPANT_NAME_METADATA_FIELDS) ?? "",
    ),
    5,
  );

  if (metadataName !== undefined) {
    return metadataName;
  }

  if (
    normalizeDisplayNameComparisonValue(args.participant.role ?? "") === "assistant"
  ) {
    const assistantName = createDisplayNameCandidate(
      formatNamedDisplayCandidate(args.assistantName ?? ""),
      4,
    );

    if (assistantName !== undefined) {
      return assistantName;
    }
  }

  for (const fieldNames of [
    PARTICIPANT_USERNAME_METADATA_FIELDS,
    PARTICIPANT_HANDLE_METADATA_FIELDS,
  ]) {
    const candidate = createDisplayNameCandidate(
      formatIdentifierDisplayName(
        readMetadataValue(args.participant, fieldNames) ?? "",
      ),
      3,
    );

    if (candidate !== undefined) {
      return candidate;
    }
  }

  const emailCandidate = createDisplayNameCandidate(
    formatIdentifierDisplayName(
      readMetadataValue(args.participant, PARTICIPANT_EMAIL_METADATA_FIELDS) ?? "",
    ),
    2,
  );

  if (emailCandidate !== undefined) {
    return emailCandidate;
  }

  return createDisplayNameCandidate(
    deriveRoleFallbackDisplayName(
      readOptionalTrimmedString(args.participant.role),
      args.provider,
      args.assistantName,
    ),
    1,
    {
      allowGeneric: true,
    },
  );
}

export function deriveCanonicalParticipantDisplayName(
  args: DeriveCanonicalParticipantDisplayNameCandidateArgs,
): string | undefined {
  return deriveCanonicalParticipantDisplayNameCandidate(args)?.value;
}
