import { deriveCanonicalParticipantDisplayName } from "./ai-conversation-participant-display-name.ts";

export const AI_CONVERSATION_IMPORT_SOURCE_TYPE = "AI_CONVERSATION" as const;

export const CANONICAL_AI_CONVERSATION_RAW_CONTENT_REQUIRED_ERROR =
  "AI conversation imports require rawContent to contain at least 1 character.";
export const CANONICAL_AI_CONVERSATION_PROVIDER_REQUIRED_ERROR =
  "AI conversation imports require sourceMeta.provider.";
export const CLAUDE_CONVERSATION_BODY_REQUIRED_ERROR =
  "Claude conversation payload must include at least one text message.";
export const CHATGPT_CONVERSATION_BODY_REQUIRED_ERROR =
  "ChatGPT conversation payload must include at least one text message.";
export const GEMINI_CONVERSATION_BODY_REQUIRED_ERROR =
  "Gemini conversation payload must include at least one text message.";

export type AiConversationProvider =
  | "claude"
  | "chatgpt"
  | "gemini"
  | "other";

export type ImportableAiConversationProvider = Exclude<
  AiConversationProvider,
  "other"
>;

export interface CanonicalAiConversationSourceMeta {
  assistantName?: string;
  capturedAt?: string;
  conversationId?: string;
  sourceConversationRef?: string;
  conversationTitle?: string;
  conversationUrl?: string;
  messageCount?: number;
  model?: string;
  participantCount?: number;
  participantNames?: readonly string[];
  participants?: readonly CanonicalAiConversationParticipant[];
  participantRoles?: readonly string[];
  publishedAt?: string;
  projectId?: string;
  provider: AiConversationProvider;
  shareId?: string;
  sourceApp?: string;
  sourceHost?: string;
  sourceId?: string;
  threadId?: string;
  turns?: readonly CanonicalAiConversationTurn[];
  turnCount?: number;
  updatedAt?: string;
  workspaceId?: string;
  [key: string]: unknown;
}

export interface CanonicalAiConversationParticipant {
  aliases?: readonly string[];
  identityId?: string;
  name?: string;
  role?: string;
  sourceId?: string;
  sourceMetadata?: Record<string, unknown>;
}

export interface CanonicalAiConversationTurn {
  capturedAt?: string;
  participantIdentityId?: string;
  participantIndex?: number;
  role?: string;
  sourceReference?: string;
  text: string;
}

export interface CanonicalAiConversationImport {
  rawContent: string;
  sourceMeta: CanonicalAiConversationSourceMeta;
  sourceType: typeof AI_CONVERSATION_IMPORT_SOURCE_TYPE;
  sourceUrl?: string;
}

export interface CreateCanonicalAiConversationImportInput {
  rawContent: string;
  sourceMeta: CanonicalAiConversationSourceMeta;
  sourceUrl?: string;
}

export interface ClaudeConversationMessagePayload {
  author?: unknown;
  content?: unknown;
  role?: unknown;
  sender?: unknown;
  text?: unknown;
}

export interface ValidatedClaudeConversationPayload {
  conversationTitle?: string;
  conversationUrl?: string;
  messages?: readonly ClaudeConversationMessagePayload[];
  model?: string;
  provider: "claude";
  title?: string;
}

export interface ChatGptConversationMessagePayload {
  author?: unknown;
  content?: unknown;
  create_time?: unknown;
  metadata?: {
    model_slug?: unknown;
  };
  model?: unknown;
  model_slug?: unknown;
  parts?: unknown;
  role?: unknown;
  text?: unknown;
}

export interface ChatGptConversationMappingEntryPayload {
  children?: readonly string[];
  message?: ChatGptConversationMessagePayload | null;
  parent?: string | null;
}

export interface ValidatedChatGptConversationPayload {
  conversationTitle?: string;
  conversationUrl?: string;
  default_model_slug?: string;
  mapping?: Record<string, ChatGptConversationMappingEntryPayload>;
  messages?: readonly ChatGptConversationMessagePayload[];
  model?: string;
  provider: "chatgpt";
  title?: string;
}

export interface GeminiConversationMessagePayload {
  author?: unknown;
  content?: unknown;
  parts?: unknown;
  role?: unknown;
  text?: unknown;
}

export interface GeminiConversationTurnPayload {
  assistant?: unknown;
  messages?: readonly GeminiConversationMessagePayload[];
  model?: unknown;
  prompt?: unknown;
  query?: unknown;
  response?: unknown;
  user?: unknown;
}

export interface ValidatedGeminiConversationPayload {
  chunks?: readonly GeminiConversationMessagePayload[];
  conversationTitle?: string;
  conversationUrl?: string;
  messages?: readonly GeminiConversationMessagePayload[];
  model?: string;
  modelName?: string;
  provider: "gemini";
  title?: string;
  turns?: readonly GeminiConversationTurnPayload[];
}

export type ValidatedAiConversationPayload =
  | ValidatedClaudeConversationPayload
  | ValidatedChatGptConversationPayload
  | ValidatedGeminiConversationPayload;

interface ExtractedCanonicalAiConversationTurn {
  capturedAt?: string;
  participant: CanonicalAiConversationParticipant;
  sourceReference?: string;
  text: string;
}

interface OrderedChatGptMappingEntry {
  childIds: readonly string[];
  createdAt?: number;
  entryId: string;
  index: number;
  message?: ChatGptConversationMessagePayload;
  parentId?: string;
}

const ADDITIONAL_CANONICAL_SOURCE_META_STRING_FIELDS = [
  {
    fieldNames: ["assistantName", "assistant_name"],
    key: "assistantName",
  },
  {
    fieldNames: ["conversationId", "conversation_id"],
    key: "conversationId",
  },
  {
    fieldNames: ["projectId", "project_id"],
    key: "projectId",
  },
  {
    fieldNames: ["shareId", "share_id"],
    key: "shareId",
  },
  {
    fieldNames: ["sourceApp", "source_app", "appName", "app_name"],
    key: "sourceApp",
  },
  {
    fieldNames: ["sourceHost", "source_host", "host", "hostname"],
    key: "sourceHost",
  },
  {
    fieldNames: ["sourceId", "source_id", "id", "uuid"],
    key: "sourceId",
  },
  {
    fieldNames: ["threadId", "thread_id"],
    key: "threadId",
  },
  {
    fieldNames: ["workspaceId", "workspace_id", "spaceId", "space_id"],
    key: "workspaceId",
  },
] as const;

const ADDITIONAL_CANONICAL_SOURCE_META_NUMBER_FIELDS = [
  {
    fieldNames: ["messageCount", "message_count"],
    key: "messageCount",
  },
  {
    fieldNames: ["turnCount", "turn_count"],
    key: "turnCount",
  },
  {
    fieldNames: ["participantCount", "participant_count"],
    key: "participantCount",
  },
] as const;

const ADDITIONAL_CANONICAL_SOURCE_META_TIMESTAMP_FIELDS = [
  {
    fieldNames: [
      "capturedAt",
      "captured_at",
      "createdAt",
      "created_at",
      "created",
      "timestamp",
      "time",
      "date",
      "create_time",
    ],
    key: "capturedAt",
  },
  {
    fieldNames: [
      "updatedAt",
      "updated_at",
      "modifiedAt",
      "modified_at",
      "modified",
      "lastModifiedAt",
      "last_modified_at",
      "lastUpdatedAt",
      "last_updated_at",
      "update_time",
    ],
    key: "updatedAt",
  },
  {
    fieldNames: [
      "publishedAt",
      "published_at",
      "published",
      "publishTime",
      "publish_time",
      "publishedDate",
      "published_date",
      "publicationDate",
      "publication_date",
    ],
    key: "publishedAt",
  },
] as const;

const ADDITIONAL_CANONICAL_SOURCE_META_STRING_ARRAY_FIELDS = [
  {
    fieldNames: ["participantNames", "participant_names"],
    key: "participantNames",
  },
  {
    fieldNames: ["participantRoles", "participant_roles"],
    key: "participantRoles",
  },
] as const;

const ADDITIONAL_CANONICAL_SOURCE_META_PARTICIPANT_FIELDS = [
  "participants",
  "participantList",
  "participant_list",
] as const;

const CANONICAL_TIMESTAMP_CONTAINER_FIELD_NAMES = [
  "timestamps",
  "time",
] as const;

const CANONICAL_PARTICIPANT_NAME_FIELD_NAMES = [
  "name",
  "displayName",
  "display_name",
  "fullName",
  "full_name",
  "label",
  "username",
  "user_name",
  "assistantName",
  "assistant_name",
] as const;

const CANONICAL_PARTICIPANT_ALIAS_FIELD_NAMES = [
  "aliases",
  "aliasList",
  "alias_list",
] as const;

const CANONICAL_PARTICIPANT_IDENTITY_ID_FIELD_NAMES = [
  "identityId",
  "identity_id",
] as const;

const CANONICAL_PARTICIPANT_ROLE_FIELD_NAMES = [
  "role",
  "participantRole",
  "participant_role",
  "type",
  "kind",
] as const;

const CANONICAL_PARTICIPANT_SOURCE_ID_FIELD_NAMES = [
  "sourceId",
  "source_id",
  "participantId",
  "participant_id",
  "id",
  "uuid",
  "userId",
  "user_id",
  "memberId",
  "member_id",
  "authorId",
  "author_id",
] as const;

const CANONICAL_PARTICIPANT_SOURCE_METADATA_FIELD_NAMES = [
  "metadata",
  "meta",
  "sourceMetadata",
  "source_metadata",
  "sourceMeta",
  "source_meta",
] as const;

const CANONICAL_TURN_SOURCE_REFERENCE_FIELD_NAMES = [
  "sourceReference",
  "source_reference",
  "sourceRef",
  "source_ref",
  "messageReference",
  "message_reference",
  "sourceMessageId",
  "source_message_id",
  "messageId",
  "message_id",
  "turnId",
  "turn_id",
  "id",
  "uuid",
] as const;

const CANONICAL_TURN_TIMESTAMP_FIELD_NAMES = [
  "capturedAt",
  "captured_at",
  "createdAt",
  "created_at",
  "created",
  "timestamp",
  "time",
  "date",
  "create_time",
] as const;

const RESERVED_CANONICAL_SOURCE_META_KEYS = new Set<string>([
  "capturedAt",
  "conversationTitle",
  "conversationUrl",
  "model",
  "publishedAt",
  "provider",
  "turnCount",
  "updatedAt",
  "rawContent",
  "title",
  "name",
  "sourceUrl",
  "shareUrl",
  "sourceMeta",
  ...CANONICAL_TIMESTAMP_CONTAINER_FIELD_NAMES,
  "messages",
  "chatMessages",
  "chat_messages",
  "mapping",
  "turns",
  "chunks",
  "default_model_slug",
  "modelName",
  ...ADDITIONAL_CANONICAL_SOURCE_META_PARTICIPANT_FIELDS,
  ...ADDITIONAL_CANONICAL_SOURCE_META_STRING_FIELDS.flatMap(
    (field) => field.fieldNames,
  ),
  ...ADDITIONAL_CANONICAL_SOURCE_META_NUMBER_FIELDS.flatMap(
    (field) => field.fieldNames,
  ),
  ...ADDITIONAL_CANONICAL_SOURCE_META_TIMESTAMP_FIELDS.flatMap(
    (field) => field.fieldNames,
  ),
  ...ADDITIONAL_CANONICAL_SOURCE_META_STRING_ARRAY_FIELDS.flatMap(
    (field) => field.fieldNames,
  ),
]);

const RESERVED_CANONICAL_PARTICIPANT_KEYS = new Set<string>([
  ...CANONICAL_PARTICIPANT_NAME_FIELD_NAMES,
  ...CANONICAL_PARTICIPANT_ALIAS_FIELD_NAMES,
  ...CANONICAL_PARTICIPANT_IDENTITY_ID_FIELD_NAMES,
  ...CANONICAL_PARTICIPANT_ROLE_FIELD_NAMES,
  ...CANONICAL_PARTICIPANT_SOURCE_ID_FIELD_NAMES,
  ...CANONICAL_PARTICIPANT_SOURCE_METADATA_FIELD_NAMES,
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readOptionalTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalizedValue = value.trim();

  return normalizedValue.length > 0 ? normalizedValue : undefined;
}

function readOptionalFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function createIsoTimestamp(value: number): string | undefined {
  const timestamp = new Date(value);

  return Number.isNaN(timestamp.getTime()) ? undefined : timestamp.toISOString();
}

function normalizeUnixTimestamp(value: number): string | undefined {
  if (!Number.isFinite(value)) {
    return undefined;
  }

  return createIsoTimestamp(Math.abs(value) >= 100_000_000_000 ? value : value * 1000);
}

function normalizeOptionalTimestamp(value: unknown): string | undefined {
  if (value instanceof Date) {
    return createIsoTimestamp(value.getTime());
  }

  const numericValue = readOptionalFiniteNumber(value);

  if (numericValue !== undefined) {
    return normalizeUnixTimestamp(numericValue);
  }

  const normalizedValue = readOptionalTrimmedString(value);

  if (normalizedValue === undefined) {
    return undefined;
  }

  if (/^\d{4}$/u.test(normalizedValue)) {
    return createIsoTimestamp(Date.parse(`${normalizedValue}-01-01T00:00:00.000Z`));
  }

  if (/^\d{4}-\d{2}$/u.test(normalizedValue)) {
    return createIsoTimestamp(Date.parse(`${normalizedValue}-01T00:00:00.000Z`));
  }

  if (/^\d{4}-\d{2}-\d{2}$/u.test(normalizedValue)) {
    return createIsoTimestamp(Date.parse(`${normalizedValue}T00:00:00.000Z`));
  }

  if (
    /^\d{4}-\d{2}-\d{2}[T ]\d{2}(?::\d{2})?(?::\d{2}(?:\.\d{1,9})?)?$/u.test(
      normalizedValue,
    )
  ) {
    return createIsoTimestamp(
      Date.parse(`${normalizedValue.replace(" ", "T")}Z`),
    );
  }

  if (/^[+-]?\d+(?:\.\d+)?$/u.test(normalizedValue)) {
    return normalizeUnixTimestamp(Number(normalizedValue));
  }

  return createIsoTimestamp(Date.parse(normalizedValue));
}

function readOptionalPositiveInteger(value: unknown): number | undefined {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : undefined;
}

function readOptionalNonNegativeInteger(value: unknown): number | undefined {
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : undefined;
}

function readOptionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalizedValues = value.flatMap((entry) => {
    const normalizedValue = readOptionalTrimmedString(entry);
    return normalizedValue === undefined ? [] : [normalizedValue];
  });

  return normalizedValues.length > 0 ? normalizedValues : undefined;
}

function normalizeComparisonValue(value: unknown): string | undefined {
  const normalizedValue = readOptionalTrimmedString(value);

  return normalizedValue === undefined
    ? undefined
    : normalizedValue.replace(/\s+/g, " ").toLowerCase();
}

function readFirstMatchingString(
  record: Record<string, unknown>,
  fieldNames: readonly string[],
): string | undefined {
  for (const fieldName of fieldNames) {
    const value = readOptionalTrimmedString(record[fieldName]);

    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
}

function readFirstMatchingTimestamp(
  record: Record<string, unknown>,
  fieldNames: readonly string[],
): string | undefined {
  for (const fieldName of fieldNames) {
    const value = normalizeOptionalTimestamp(record[fieldName]);

    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
}

function readFirstMatchingTimestampFromContainers(
  record: Record<string, unknown>,
  fieldNames: readonly string[],
): string | undefined {
  const directTimestamp = readFirstMatchingTimestamp(record, fieldNames);

  if (directTimestamp !== undefined) {
    return directTimestamp;
  }

  for (const containerFieldName of CANONICAL_TIMESTAMP_CONTAINER_FIELD_NAMES) {
    const containerValue = record[containerFieldName];

    if (!isRecord(containerValue)) {
      continue;
    }

    const nestedTimestamp = readFirstMatchingTimestamp(containerValue, fieldNames);

    if (nestedTimestamp !== undefined) {
      return nestedTimestamp;
    }
  }

  return undefined;
}

function readCanonicalTurnSourceReference(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  return readFirstMatchingString(value, CANONICAL_TURN_SOURCE_REFERENCE_FIELD_NAMES);
}

function attachSourceReferenceToMessage(
  message: unknown,
  sourceReference: string | undefined,
): unknown {
  if (!isRecord(message)) {
    return message;
  }

  const normalizedSourceReference =
    readCanonicalTurnSourceReference(message) ??
    readOptionalTrimmedString(sourceReference);

  return normalizedSourceReference === undefined
    ? message
    : {
        ...message,
        sourceReference: normalizedSourceReference,
      };
}

function readFirstMatchingPositiveInteger(
  record: Record<string, unknown>,
  fieldNames: readonly string[],
): number | undefined {
  for (const fieldName of fieldNames) {
    const value = readOptionalPositiveInteger(record[fieldName]);

    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
}

function readFirstMatchingNonNegativeInteger(
  record: Record<string, unknown>,
  fieldNames: readonly string[],
): number | undefined {
  for (const fieldName of fieldNames) {
    const value = readOptionalNonNegativeInteger(record[fieldName]);

    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
}

function readFirstMatchingStringArray(
  record: Record<string, unknown>,
  fieldNames: readonly string[],
): string[] | undefined {
  for (const fieldName of fieldNames) {
    const value = readOptionalStringArray(record[fieldName]);

    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
}

function normalizeCanonicalParticipantRole(value: unknown): {
  role?: string;
  sourceRole?: string;
} {
  const sourceRole = readOptionalTrimmedString(value);

  if (sourceRole === undefined) {
    return {};
  }

  const normalizedValue = sourceRole.toLowerCase();
  let role: string;
  let translated = false;

  switch (normalizedValue) {
    case "assistant":
    case "system":
    case "user":
      role = normalizedValue;
      break;
    case "ai":
    case "bard":
    case "bot":
    case "chatgpt":
    case "claude":
    case "gemini":
    case "model":
      role = "assistant";
      translated = true;
      break;
    case "human":
    case "prompt":
      role = "user";
      translated = true;
      break;
    default:
      role = sourceRole;
      break;
  }

  return {
    role,
    ...(translated ? { sourceRole } : {}),
  };
}

function normalizeKnownCanonicalParticipantRole(value: unknown): {
  role?: string;
  sourceRole?: string;
} {
  const sourceRole = readOptionalTrimmedString(value);

  if (sourceRole === undefined) {
    return {};
  }

  const normalizedValue = sourceRole.toLowerCase();
  let role: string;
  let translated = false;

  switch (normalizedValue) {
    case "assistant":
    case "system":
    case "user":
      role = normalizedValue;
      break;
    case "ai":
    case "bard":
    case "bot":
    case "chatgpt":
    case "claude":
    case "gemini":
    case "model":
      role = "assistant";
      translated = true;
      break;
    case "human":
    case "prompt":
      role = "user";
      translated = true;
      break;
    default:
      return {};
  }

  return {
    role,
    ...(translated ? { sourceRole } : {}),
  };
}

function attachParticipantSourceRole(
  sourceMetadata: Record<string, unknown> | undefined,
  sourceRole: string | undefined,
): Record<string, unknown> | undefined {
  if (sourceRole === undefined) {
    return sourceMetadata;
  }

  const existingSourceRole = readOptionalTrimmedString(sourceMetadata?.sourceRole);

  if (existingSourceRole !== undefined) {
    return sourceMetadata;
  }

  return {
    ...(sourceMetadata ?? {}),
    sourceRole,
  };
}

function setOptionalRecordValue(
  record: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  if (value !== undefined) {
    record[key] = value;
  }
}

function normalizeAdditionalCanonicalSourceMetaValue(
  value: unknown,
): string | number | boolean | readonly string[] | undefined {
  const normalizedString = readOptionalTrimmedString(value);

  if (normalizedString !== undefined) {
    return normalizedString;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "boolean") {
    return value;
  }

  return readOptionalStringArray(value);
}

function normalizeParticipantMetadataValue(value: unknown): unknown {
  const normalizedString = readOptionalTrimmedString(value);

  if (normalizedString !== undefined) {
    return normalizedString;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "boolean" || value === null) {
    return value;
  }

  if (Array.isArray(value)) {
    const normalizedEntries = value.flatMap((entry) => {
      const normalizedEntry = normalizeParticipantMetadataValue(entry);
      return normalizedEntry === undefined ? [] : [normalizedEntry];
    });

    return normalizedEntries.length > 0 ? normalizedEntries : undefined;
  }

  if (!isRecord(value)) {
    return undefined;
  }

  const normalizedRecord = Object.fromEntries(
    Object.entries(value).flatMap(([key, entryValue]) => {
      const normalizedEntryValue = normalizeParticipantMetadataValue(entryValue);
      return normalizedEntryValue === undefined
        ? []
        : [[key, normalizedEntryValue]];
    }),
  );

  return Object.keys(normalizedRecord).length > 0 ? normalizedRecord : undefined;
}

function isNormalizedParticipantMetadataRecord(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractCanonicalParticipantSourceMetadata(
  participant: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const sourceMetadata: Record<string, unknown> = {};

  for (const fieldName of CANONICAL_PARTICIPANT_SOURCE_METADATA_FIELD_NAMES) {
    const normalizedMetadata = normalizeParticipantMetadataValue(
      participant[fieldName],
    );

    if (!isNormalizedParticipantMetadataRecord(normalizedMetadata)) {
      continue;
    }

    Object.assign(sourceMetadata, normalizedMetadata);
  }

  for (const [key, value] of Object.entries(participant)) {
    if (RESERVED_CANONICAL_PARTICIPANT_KEYS.has(key)) {
      continue;
    }

    const normalizedValue = normalizeParticipantMetadataValue(value);

    if (normalizedValue !== undefined) {
      sourceMetadata[key] = normalizedValue;
    }
  }

  return Object.keys(sourceMetadata).length > 0 ? sourceMetadata : undefined;
}

function createCanonicalParticipant(
  participant: unknown,
  fallbackSourceId?: string,
): CanonicalAiConversationParticipant | undefined {
  if (typeof participant === "string") {
    const name = readOptionalTrimmedString(participant);
    return name === undefined ? undefined : { name };
  }

  if (!isRecord(participant)) {
    return undefined;
  }

  const name = readFirstMatchingString(
    participant,
    CANONICAL_PARTICIPANT_NAME_FIELD_NAMES,
  );
  const aliases = readFirstMatchingStringArray(
    participant,
    CANONICAL_PARTICIPANT_ALIAS_FIELD_NAMES,
  );
  const identityId = readFirstMatchingString(
    participant,
    CANONICAL_PARTICIPANT_IDENTITY_ID_FIELD_NAMES,
  );
  const role = readFirstMatchingString(
    participant,
    CANONICAL_PARTICIPANT_ROLE_FIELD_NAMES,
  );
  const sourceId =
    readFirstMatchingString(
      participant,
      CANONICAL_PARTICIPANT_SOURCE_ID_FIELD_NAMES,
    ) ?? readOptionalTrimmedString(fallbackSourceId);
  const sourceMetadata = extractCanonicalParticipantSourceMetadata(participant);
  const normalizedRole = normalizeCanonicalParticipantRole(role);
  const normalizedSourceMetadata = attachParticipantSourceRole(
    sourceMetadata,
    normalizedRole.sourceRole,
  );

  if (
    aliases === undefined &&
    identityId === undefined &&
    name === undefined &&
    normalizedRole.role === undefined &&
    sourceId === undefined &&
    normalizedSourceMetadata === undefined
  ) {
    return undefined;
  }

  return {
    ...(aliases === undefined ? {} : { aliases }),
    ...(identityId === undefined ? {} : { identityId }),
    ...(name === undefined ? {} : { name }),
    ...(normalizedRole.role === undefined ? {} : { role: normalizedRole.role }),
    ...(sourceId === undefined ? {} : { sourceId }),
    ...(normalizedSourceMetadata === undefined
      ? {}
      : { sourceMetadata: normalizedSourceMetadata }),
  };
}

function readCanonicalParticipants(
  value: unknown,
): CanonicalAiConversationParticipant[] | undefined {
  if (Array.isArray(value)) {
    const participants = value.flatMap((entry) => {
      const canonicalParticipant = createCanonicalParticipant(entry);
      return canonicalParticipant === undefined ? [] : [canonicalParticipant];
    });

    return participants.length > 0 ? participants : undefined;
  }

  if (!isRecord(value)) {
    return undefined;
  }

  const participants = Object.entries(value).flatMap(([key, entryValue]) => {
    const canonicalParticipant = createCanonicalParticipant(entryValue, key);
    return canonicalParticipant === undefined ? [] : [canonicalParticipant];
  });

  return participants.length > 0 ? participants : undefined;
}

function buildCanonicalParticipantsFromSummaryFields(
  participantNames: readonly string[] | undefined,
  participantRoles: readonly string[] | undefined,
): CanonicalAiConversationParticipant[] | undefined {
  const participantCount = Math.max(
    participantNames?.length ?? 0,
    participantRoles?.length ?? 0,
  );

  if (participantCount === 0) {
    return undefined;
  }

  return Array.from({ length: participantCount }, (_, index) => {
    const normalizedRole = normalizeCanonicalParticipantRole(participantRoles?.[index]);
    const sourceMetadata = attachParticipantSourceRole(
      undefined,
      normalizedRole.sourceRole,
    );

    return {
      ...(participantNames?.[index] === undefined
        ? {}
        : { name: participantNames[index] }),
      ...(normalizedRole.role === undefined ? {} : { role: normalizedRole.role }),
      ...(sourceMetadata === undefined ? {} : { sourceMetadata }),
    };
  });
}

function mergeParticipantSummaryFields(
  participants: readonly CanonicalAiConversationParticipant[],
  participantNames: readonly string[] | undefined,
  participantRoles: readonly string[] | undefined,
): CanonicalAiConversationParticipant[] {
  return participants.map((participant, index) => {
    const normalizedRole =
      participant.role === undefined
        ? normalizeCanonicalParticipantRole(participantRoles?.[index])
        : { role: participant.role };
    const sourceMetadata =
      participant.role === undefined
        ? attachParticipantSourceRole(
            participant.sourceMetadata,
            normalizedRole.sourceRole,
          )
        : participant.sourceMetadata;

    return {
      ...participant,
      ...(participant.name === undefined && participantNames?.[index] !== undefined
        ? { name: participantNames[index] }
        : {}),
      ...(participant.role === undefined && normalizedRole.role !== undefined
        ? { role: normalizedRole.role }
        : {}),
      ...(sourceMetadata === participant.sourceMetadata || sourceMetadata === undefined
        ? {}
        : { sourceMetadata }),
    };
  });
}

function normalizeCanonicalParticipantDisplayNames(
  participants: readonly CanonicalAiConversationParticipant[],
  args: {
    assistantName?: string;
    provider: AiConversationProvider;
  },
): CanonicalAiConversationParticipant[] {
  return participants.map((participant) => {
    const { name: _name, ...participantWithoutName } = participant;
    const displayName = deriveCanonicalParticipantDisplayName({
      assistantName: args.assistantName,
      participant,
      provider: args.provider,
    });

    return {
      ...participantWithoutName,
      ...(displayName === undefined ? {} : { name: displayName }),
    };
  });
}

function deriveParticipantNames(
  participants: readonly CanonicalAiConversationParticipant[],
): string[] | undefined {
  const participantNames = participants.flatMap((participant) => {
    const name = readOptionalTrimmedString(participant.name);
    return name === undefined ? [] : [name];
  });

  return participantNames.length > 0 ? participantNames : undefined;
}

function deriveParticipantRoles(
  participants: readonly CanonicalAiConversationParticipant[],
): string[] | undefined {
  const participantRoles = participants.flatMap((participant) => {
    const role = readOptionalTrimmedString(participant.role);
    return role === undefined ? [] : [role];
  });

  return participantRoles.length > 0 ? participantRoles : undefined;
}

function createCanonicalTurn(
  value: unknown,
): CanonicalAiConversationTurn | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const text = joinTextFragments(
    extractTextFragments(value.text ?? value.content ?? value.message ?? value.body),
  );

  if (text === undefined) {
    return undefined;
  }

  const normalizedRole = normalizeCanonicalParticipantRole(
    readFirstMatchingString(value, ["role", "participantRole", "participant_role"]),
  );
  const participantIndex = readFirstMatchingNonNegativeInteger(value, [
    "participantIndex",
    "participant_index",
  ]);
  const participantIdentityId = readFirstMatchingString(value, [
    "participantIdentityId",
    "participant_identity_id",
  ]);
  const capturedAt = readFirstMatchingTimestampFromContainers(
    value,
    CANONICAL_TURN_TIMESTAMP_FIELD_NAMES,
  );
  const sourceReference = readCanonicalTurnSourceReference(value);

  return {
    ...(capturedAt === undefined ? {} : { capturedAt }),
    ...(participantIdentityId === undefined ? {} : { participantIdentityId }),
    ...(participantIndex === undefined ? {} : { participantIndex }),
    ...(normalizedRole.role === undefined ? {} : { role: normalizedRole.role }),
    ...(sourceReference === undefined ? {} : { sourceReference }),
    text,
  };
}

function readCanonicalTurns(
  value: unknown,
): CanonicalAiConversationTurn[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const turns = value.flatMap((entry) => {
    const canonicalTurn = createCanonicalTurn(entry);
    return canonicalTurn === undefined ? [] : [canonicalTurn];
  });

  return turns.length > 0 ? turns : undefined;
}

function createCanonicalParticipantFromMessageAuthor(
  author: unknown,
  fallbackRole?: unknown,
): CanonicalAiConversationParticipant {
  if (isRecord(author)) {
    const participant =
      createCanonicalParticipant({
        ...author,
        ...(author.role === undefined && fallbackRole !== undefined
          ? { role: fallbackRole }
          : {}),
      }) ?? createCanonicalParticipant({ role: fallbackRole });

    if (participant !== undefined) {
      return participant;
    }
  }

  const knownAuthorRole = normalizeKnownCanonicalParticipantRole(author);
  const fallbackNormalizedRole = normalizeCanonicalParticipantRole(fallbackRole);
  const name =
    knownAuthorRole.role === undefined ? readOptionalTrimmedString(author) : undefined;
  const role = knownAuthorRole.role ?? fallbackNormalizedRole.role;
  const sourceMetadata = attachParticipantSourceRole(
    undefined,
    knownAuthorRole.sourceRole ?? fallbackNormalizedRole.sourceRole,
  );

  return {
    ...(name === undefined ? { name: "Speaker" } : { name }),
    ...(role === undefined ? {} : { role }),
    ...(sourceMetadata === undefined ? {} : { sourceMetadata }),
  };
}

function areParticipantRolesCompatible(
  leftRole: unknown,
  rightRole: unknown,
): boolean {
  const normalizedLeftRole = normalizeComparisonValue(leftRole);
  const normalizedRightRole = normalizeComparisonValue(rightRole);

  return (
    normalizedLeftRole === undefined ||
    normalizedRightRole === undefined ||
    normalizedLeftRole === normalizedRightRole
  );
}

function findCanonicalParticipantIndex(
  participants: readonly CanonicalAiConversationParticipant[],
  candidate: CanonicalAiConversationParticipant,
): number | undefined {
  const candidateSourceId = normalizeComparisonValue(candidate.sourceId);

  if (candidateSourceId !== undefined) {
    const sourceMatches = participants.flatMap((participant, index) =>
      normalizeComparisonValue(participant.sourceId) === candidateSourceId &&
      areParticipantRolesCompatible(candidate.role, participant.role)
        ? [index]
        : [],
    );

    if (sourceMatches.length > 0) {
      return sourceMatches[0];
    }
  }

  const candidateName = normalizeComparisonValue(candidate.name);

  if (candidateName !== undefined) {
    const nameMatches = participants.flatMap((participant, index) =>
      normalizeComparisonValue(participant.name) === candidateName &&
      areParticipantRolesCompatible(candidate.role, participant.role)
        ? [index]
        : [],
    );

    if (nameMatches.length === 1) {
      return nameMatches[0];
    }
  }

  const candidateRole = normalizeComparisonValue(candidate.role);

  if (candidateRole !== undefined) {
    const roleMatches = participants.flatMap((participant, index) =>
      normalizeComparisonValue(participant.role) === candidateRole ? [index] : [],
    );

    if (roleMatches.length === 1) {
      return roleMatches[0];
    }
  }

  return undefined;
}

function buildCanonicalConversationStructure(args: {
  assistantName?: string;
  participants?: readonly CanonicalAiConversationParticipant[];
  provider: AiConversationProvider;
  turns: readonly ExtractedCanonicalAiConversationTurn[];
}): {
  participants: CanonicalAiConversationParticipant[];
  turns: CanonicalAiConversationTurn[];
} {
  const participants = [...(args.participants ?? [])];
  const turns = args.turns.map((turn) => {
    let participantIndex = findCanonicalParticipantIndex(
      participants,
      turn.participant,
    );

    if (participantIndex === undefined) {
      participants.push(turn.participant);
      participantIndex = participants.length - 1;
    }

    const participant = participants[participantIndex];
    const normalizedRole = readOptionalTrimmedString(participant?.role);

    return {
      ...(turn.capturedAt === undefined ? {} : { capturedAt: turn.capturedAt }),
      participantIndex,
      ...(normalizedRole === undefined ? {} : { role: normalizedRole }),
      ...(turn.sourceReference === undefined
        ? {}
        : { sourceReference: turn.sourceReference }),
      text: turn.text,
    };
  });

  return {
    participants: normalizeCanonicalParticipantDisplayNames(participants, {
      assistantName: args.assistantName,
      provider: args.provider,
    }),
    turns,
  };
}

function resolveCanonicalParticipants(
  input: Record<string, unknown>,
  participantNames: readonly string[] | undefined,
  participantRoles: readonly string[] | undefined,
): CanonicalAiConversationParticipant[] | undefined {
  for (const fieldName of ADDITIONAL_CANONICAL_SOURCE_META_PARTICIPANT_FIELDS) {
    const participants = readCanonicalParticipants(input[fieldName]);

    if (participants === undefined) {
      continue;
    }

    return mergeParticipantSummaryFields(
      participants,
      participantNames,
      participantRoles,
    );
  }

  return buildCanonicalParticipantsFromSummaryFields(
    participantNames,
    participantRoles,
  );
}

function joinTextFragments(fragments: readonly string[]): string | undefined {
  const normalizedFragments = fragments
    .map((fragment) => fragment.trim())
    .filter((fragment) => fragment.length > 0);

  if (normalizedFragments.length === 0) {
    return undefined;
  }

  return normalizedFragments.join("\n");
}

function extractTextFragments(value: unknown): string[] {
  if (typeof value === "string") {
    const normalizedValue = value.trim();
    return normalizedValue.length > 0 ? [normalizedValue] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => extractTextFragments(entry));
  }

  if (!isRecord(value)) {
    return [];
  }

  if ("text" in value) {
    return extractTextFragments(value.text);
  }

  if ("parts" in value) {
    return extractTextFragments(value.parts);
  }

  if ("content" in value) {
    return extractTextFragments(value.content);
  }

  if ("body" in value) {
    return extractTextFragments(value.body);
  }

  if ("message" in value) {
    return extractTextFragments(value.message);
  }

  if ("value" in value) {
    return extractTextFragments(value.value);
  }

  if ("candidates" in value) {
    return extractTextFragments(value.candidates);
  }

  return [];
}

function formatConversationRole(value: unknown, fallback = "Speaker"): string {
  const normalizedValue = readOptionalTrimmedString(value)?.toLowerCase();

  if (normalizedValue === undefined) {
    return fallback;
  }

  switch (normalizedValue) {
    case "assistant":
    case "ai":
    case "bard":
    case "bot":
    case "chatgpt":
    case "claude":
    case "gemini":
    case "model":
      return "Assistant";
    case "human":
    case "prompt":
    case "user":
      return "User";
    case "system":
      return "System";
    default:
      return normalizedValue.charAt(0).toUpperCase() + normalizedValue.slice(1);
  }
}

function buildConversationBody(
  turns: readonly ExtractedCanonicalAiConversationTurn[],
): string {
  return turns
    .map(
      (turn) =>
        `${formatConversationRole(turn.participant.role ?? turn.participant.name)}: ${turn.text}`,
    )
    .join("\n");
}

function createTurnsFromMessages(
  messages: readonly unknown[],
  readParticipant: (
    message: Record<string, unknown>,
  ) => CanonicalAiConversationParticipant,
  readText: (message: Record<string, unknown>) => string | undefined,
): ExtractedCanonicalAiConversationTurn[] {
  return messages.flatMap((message) => {
    if (!isRecord(message)) {
      return [];
    }

    const capturedAt = readFirstMatchingTimestampFromContainers(
      message,
      CANONICAL_TURN_TIMESTAMP_FIELD_NAMES,
    );
    const sourceReference = readCanonicalTurnSourceReference(message);
    const text = readText(message);

    if (text === undefined) {
      return [];
    }

    return [
      {
        participant: readParticipant(message),
        ...(capturedAt === undefined ? {} : { capturedAt }),
        ...(sourceReference === undefined ? {} : { sourceReference }),
        text,
      },
    ];
  });
}

function resolveConversationTitle(payload: object): string | undefined {
  const record = payload as unknown as Record<string, unknown>;

  return (
    readOptionalTrimmedString(record.conversationTitle) ??
    readOptionalTrimmedString(record.title) ??
    readOptionalTrimmedString(record.name)
  );
}

function resolveConversationUrl(payload: object): string | undefined {
  const record = payload as unknown as Record<string, unknown>;

  return (
    readOptionalTrimmedString(record.conversationUrl) ??
    readOptionalTrimmedString(record.sourceUrl) ??
    readOptionalTrimmedString(record.shareUrl)
  );
}

function extractAdditionalCanonicalSourceMeta(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const additionalSourceMeta: Record<string, unknown> = {};
  const provider =
    (readOptionalTrimmedString(input.provider) as AiConversationProvider | undefined) ??
    "other";

  for (const field of ADDITIONAL_CANONICAL_SOURCE_META_STRING_FIELDS) {
    setOptionalRecordValue(
      additionalSourceMeta,
      field.key,
      readFirstMatchingString(input, field.fieldNames),
    );
  }

  for (const field of ADDITIONAL_CANONICAL_SOURCE_META_NUMBER_FIELDS) {
    setOptionalRecordValue(
      additionalSourceMeta,
      field.key,
      readFirstMatchingPositiveInteger(input, field.fieldNames),
    );
  }

  for (const field of ADDITIONAL_CANONICAL_SOURCE_META_TIMESTAMP_FIELDS) {
    setOptionalRecordValue(
      additionalSourceMeta,
      field.key,
      readFirstMatchingTimestampFromContainers(input, field.fieldNames),
    );
  }

  const participantNames = readFirstMatchingStringArray(input, [
    "participantNames",
    "participant_names",
  ]);
  const participantRoles = readFirstMatchingStringArray(input, [
    "participantRoles",
    "participant_roles",
  ]);

  setOptionalRecordValue(
    additionalSourceMeta,
    "participantNames",
    participantNames,
  );
  setOptionalRecordValue(
    additionalSourceMeta,
    "participantRoles",
    participantRoles,
  );

  const participants = resolveCanonicalParticipants(
    input,
    participantNames,
    participantRoles,
  );
  const normalizedParticipants =
    participants === undefined
      ? undefined
      : normalizeCanonicalParticipantDisplayNames(participants, {
          assistantName: readOptionalTrimmedString(additionalSourceMeta.assistantName),
          provider,
        });
  const normalizedTurns = readCanonicalTurns(input.turns);

  setOptionalRecordValue(additionalSourceMeta, "participants", normalizedParticipants);
  setOptionalRecordValue(additionalSourceMeta, "turns", normalizedTurns);

  if (normalizedParticipants !== undefined) {
    setOptionalRecordValue(
      additionalSourceMeta,
      "participantCount",
      normalizedParticipants.length,
    );
    setOptionalRecordValue(
      additionalSourceMeta,
      "participantNames",
      deriveParticipantNames(normalizedParticipants),
    );
    setOptionalRecordValue(
      additionalSourceMeta,
      "participantRoles",
      deriveParticipantRoles(normalizedParticipants) ??
        additionalSourceMeta.participantRoles,
    );
  }

  for (const [key, value] of Object.entries(input)) {
    if (RESERVED_CANONICAL_SOURCE_META_KEYS.has(key)) {
      continue;
    }

    if (Object.prototype.hasOwnProperty.call(additionalSourceMeta, key)) {
      continue;
    }

    const normalizedValue = normalizeAdditionalCanonicalSourceMetaValue(value);

    if (normalizedValue !== undefined) {
      additionalSourceMeta[key] = normalizedValue;
    }
  }

  return additionalSourceMeta;
}

function selectTurnTimestampBoundary(
  turns: readonly CanonicalAiConversationTurn[] | undefined,
  direction: "first" | "last",
): string | undefined {
  if (turns === undefined) {
    return undefined;
  }

  let resolvedBoundaryTimestamp: string | undefined;

  for (const turn of turns) {
    const timestamp = normalizeOptionalTimestamp(turn.capturedAt);

    if (timestamp === undefined) {
      continue;
    }

    if (resolvedBoundaryTimestamp === undefined) {
      resolvedBoundaryTimestamp = timestamp;
      continue;
    }

    if (
      (direction === "first" && timestamp < resolvedBoundaryTimestamp) ||
      (direction === "last" && timestamp > resolvedBoundaryTimestamp)
    ) {
      resolvedBoundaryTimestamp = timestamp;
    }
  }

  return resolvedBoundaryTimestamp;
}

function normalizeCanonicalSourceMeta(
  input: CanonicalAiConversationSourceMeta,
  sourceUrl: string | undefined,
): CanonicalAiConversationSourceMeta {
  const inputRecord = input as unknown as Record<string, unknown>;
  const provider = readOptionalTrimmedString(input.provider);
  const conversationTitle = readOptionalTrimmedString(input.conversationTitle);
  const conversationUrl =
    readOptionalTrimmedString(input.conversationUrl) ?? sourceUrl;
  const model = readOptionalTrimmedString(input.model);
  const additionalSourceMeta = extractAdditionalCanonicalSourceMeta(inputRecord);
  const turns = Array.isArray(additionalSourceMeta.turns)
    ? (additionalSourceMeta.turns as CanonicalAiConversationTurn[])
    : undefined;
  const capturedAt =
    normalizeOptionalTimestamp(additionalSourceMeta.capturedAt) ??
    selectTurnTimestampBoundary(turns, "first");
  const updatedAt =
    normalizeOptionalTimestamp(additionalSourceMeta.updatedAt) ??
    selectTurnTimestampBoundary(turns, "last");
  const publishedAt = normalizeOptionalTimestamp(additionalSourceMeta.publishedAt);
  const turnCount =
    turns?.length ??
    readOptionalPositiveInteger(additionalSourceMeta.turnCount) ??
    readOptionalPositiveInteger(input.turnCount);
  const sourceConversationRef = buildAiConversationSourceReference(
    {
      ...additionalSourceMeta,
      ...(conversationUrl === undefined ? {} : { conversationUrl }),
      provider,
    },
    sourceUrl,
  );

  if (provider === undefined) {
    throw new TypeError(CANONICAL_AI_CONVERSATION_PROVIDER_REQUIRED_ERROR);
  }

  return {
    ...additionalSourceMeta,
    ...(capturedAt === undefined ? {} : { capturedAt }),
    provider: provider as AiConversationProvider,
    ...(conversationTitle === undefined ? {} : { conversationTitle }),
    ...(conversationUrl === undefined ? {} : { conversationUrl }),
    ...(model === undefined ? {} : { model }),
    ...(publishedAt === undefined ? {} : { publishedAt }),
    ...(sourceConversationRef === undefined ? {} : { sourceConversationRef }),
    ...(typeof turnCount === "number" && turnCount > 0 ? { turnCount } : {}),
    ...(updatedAt === undefined ? {} : { updatedAt }),
  };
}

export function buildAiConversationSourceReference(
  input: {
    conversationId?: unknown;
    conversationUrl?: unknown;
    provider?: unknown;
    shareId?: unknown;
    sourceConversationRef?: unknown;
    sourceId?: unknown;
    threadId?: unknown;
  },
  sourceUrl?: string,
): string | undefined {
  const provider = readOptionalTrimmedString(input.provider)?.toLowerCase();

  if (provider === undefined) {
    return readOptionalTrimmedString(input.sourceConversationRef);
  }

  const stableReference =
    (() => {
      const conversationId = readOptionalTrimmedString(input.conversationId);

      if (conversationId !== undefined) {
        return `ai-conversation-ref:v1:${provider}:conversation=${conversationId}`;
      }

      const threadId = readOptionalTrimmedString(input.threadId);

      if (threadId !== undefined) {
        return `ai-conversation-ref:v1:${provider}:thread=${threadId}`;
      }

      const shareId = readOptionalTrimmedString(input.shareId);

      if (shareId !== undefined) {
        return `ai-conversation-ref:v1:${provider}:share=${shareId}`;
      }

      const sourceId = readOptionalTrimmedString(input.sourceId);

      if (sourceId !== undefined) {
        return `ai-conversation-ref:v1:${provider}:source=${sourceId}`;
      }

      const conversationUrl =
        readOptionalTrimmedString(input.conversationUrl) ??
        readOptionalTrimmedString(sourceUrl);

      if (conversationUrl !== undefined) {
        return `ai-conversation-ref:v1:${provider}:url=${conversationUrl}`;
      }

      return undefined;
    })();

  return stableReference ?? readOptionalTrimmedString(input.sourceConversationRef);
}

function buildCanonicalImportFromExtractedTurns(
  args: {
    additionalSourceMeta?: Record<string, unknown>;
    conversationTitle?: string;
    conversationUrl?: string;
    errorMessage: string;
    model?: string;
    provider: ImportableAiConversationProvider;
    turns: readonly ExtractedCanonicalAiConversationTurn[];
  },
): CanonicalAiConversationImport {
  if (args.turns.length === 0) {
    throw new TypeError(args.errorMessage);
  }

  const explicitParticipants = readCanonicalParticipants(
    args.additionalSourceMeta?.participants,
  );
  const canonicalConversationStructure = buildCanonicalConversationStructure({
    assistantName: readOptionalTrimmedString(args.additionalSourceMeta?.assistantName),
    participants: explicitParticipants,
    provider: args.provider,
    turns: args.turns,
  });
  const participantNames = deriveParticipantNames(
    canonicalConversationStructure.participants,
  );
  const participantRoles = deriveParticipantRoles(
    canonicalConversationStructure.participants,
  );
  const participantCount = canonicalConversationStructure.participants.length;

  return createCanonicalAiConversationImport({
    rawContent: buildConversationBody(args.turns),
    ...(args.conversationUrl === undefined ? {} : { sourceUrl: args.conversationUrl }),
    sourceMeta: {
      ...(args.additionalSourceMeta ?? {}),
      participantCount,
      ...(participantNames === undefined ? {} : { participantNames }),
      participants: canonicalConversationStructure.participants,
      ...(participantRoles === undefined ? {} : { participantRoles }),
      provider: args.provider,
      ...(args.conversationTitle === undefined
        ? {}
        : { conversationTitle: args.conversationTitle }),
      ...(args.conversationUrl === undefined
        ? {}
        : { conversationUrl: args.conversationUrl }),
      ...(args.model === undefined ? {} : { model: args.model }),
      turns: canonicalConversationStructure.turns,
      turnCount: args.turns.length,
    },
  });
}

function readArrayFieldMatch(
  payload: object,
  fieldNames: readonly string[],
): {
  fieldName?: string;
  values: readonly unknown[];
} {
  const record = payload as unknown as Record<string, unknown>;

  for (const fieldName of fieldNames) {
    const value = record[fieldName];

    if (Array.isArray(value)) {
      return {
        fieldName,
        values: value,
      };
    }
  }

  return {
    values: [],
  };
}

function readArrayField(
  payload: object,
  fieldNames: readonly string[],
): readonly unknown[] {
  return readArrayFieldMatch(payload, fieldNames).values;
}

function readClaudeConversationMessages(
  payload: ValidatedClaudeConversationPayload,
): readonly unknown[] {
  const { fieldName, values } = readArrayFieldMatch(payload, [
    "messages",
    "chatMessages",
    "chat_messages",
  ]);
  const referencePrefix = fieldName ?? "messages";

  return values.map((message, index) =>
    attachSourceReferenceToMessage(message, `${referencePrefix}:${index}`),
  );
}

function readChatGptConversationMessages(
  payload: ValidatedChatGptConversationPayload,
): readonly unknown[] {
  const directMessages = readArrayField(payload, ["messages"]);

  if (directMessages.length > 0) {
    return directMessages.map((message, index) =>
      attachSourceReferenceToMessage(message, `messages:${index}`),
    );
  }

  if (!isRecord(payload.mapping)) {
    return [];
  }

  const orderedEntries = Object.entries(payload.mapping).flatMap(
    ([entryId, value], index): OrderedChatGptMappingEntry[] => {
      if (!isRecord(value)) {
        return [];
      }

      const childIds = Array.isArray(value.children)
        ? value.children.flatMap((childId) => {
            const normalizedChildId = readOptionalTrimmedString(childId);
            return normalizedChildId === undefined ? [] : [normalizedChildId];
          })
        : [];
      const parentId = readOptionalTrimmedString(value.parent);
      const message = isRecord(value.message)
        ? (value.message as ChatGptConversationMessagePayload)
        : undefined;

      return [
        {
          childIds,
          createdAt:
            message === undefined
              ? undefined
              : readOptionalFiniteNumber(message.create_time),
          entryId,
          index,
          ...(message === undefined ? {} : { message }),
          ...(parentId === undefined ? {} : { parentId }),
        },
      ];
    },
  );

  const compareEntries = (
    left: OrderedChatGptMappingEntry,
    right: OrderedChatGptMappingEntry,
  ) => {
    if (left.createdAt !== undefined && right.createdAt !== undefined) {
      if (left.createdAt !== right.createdAt) {
        return left.createdAt - right.createdAt;
      }
    } else if (left.createdAt !== undefined || right.createdAt !== undefined) {
      return left.createdAt === undefined ? 1 : -1;
    }

    return left.index - right.index;
  };
  const entriesById = new Map(
    orderedEntries.map((entry) => [entry.entryId, entry] as const),
  );
  const childIdsByParent = new Map<string, string[]>();

  for (const entry of orderedEntries) {
    if (entry.parentId === undefined) {
      continue;
    }

    const siblingIds = childIdsByParent.get(entry.parentId) ?? [];
    siblingIds.push(entry.entryId);
    childIdsByParent.set(entry.parentId, siblingIds);
  }

  const roots = orderedEntries
    .filter(
      (entry) =>
        entry.parentId === undefined || !entriesById.has(entry.parentId),
    )
    .sort(compareEntries);
  const visitedEntryIds = new Set<string>();
  const orderedMessages: ChatGptConversationMessagePayload[] = [];

  const visitEntry = (entryId: string) => {
    if (visitedEntryIds.has(entryId)) {
      return;
    }

    const entry = entriesById.get(entryId);

    if (entry === undefined) {
      return;
    }

    visitedEntryIds.add(entryId);

    if (entry.message !== undefined) {
      orderedMessages.push(
        attachSourceReferenceToMessage(
          entry.message,
          `mapping:${entry.entryId}`,
        ) as ChatGptConversationMessagePayload,
      );
    }

    const declaredChildIds = entry.childIds.filter((childId) =>
      entriesById.has(childId),
    );
    const declaredChildIdSet = new Set(declaredChildIds);
    const inferredChildIds = (childIdsByParent.get(entry.entryId) ?? [])
      .filter((childId) => !declaredChildIdSet.has(childId))
      .sort((leftId, rightId) => {
        const leftEntry = entriesById.get(leftId);
        const rightEntry = entriesById.get(rightId);

        if (leftEntry === undefined || rightEntry === undefined) {
          return 0;
        }

        return compareEntries(leftEntry, rightEntry);
      });

    for (const childId of [...declaredChildIds, ...inferredChildIds]) {
      visitEntry(childId);
    }
  };

  for (const root of roots) {
    visitEntry(root.entryId);
  }

  const remainingEntries = orderedEntries
    .filter((entry) => !visitedEntryIds.has(entry.entryId))
    .sort(compareEntries);

  for (const entry of remainingEntries) {
    visitEntry(entry.entryId);
  }

  return orderedMessages;
}

function readGeminiConversationMessages(
  payload: ValidatedGeminiConversationPayload,
): readonly unknown[] {
  const { fieldName, values: directMessages } = readArrayFieldMatch(payload, [
    "messages",
    "chunks",
  ]);

  if (directMessages.length > 0) {
    const referencePrefix = fieldName ?? "messages";

    return directMessages.map((message, index) =>
      attachSourceReferenceToMessage(message, `${referencePrefix}:${index}`),
    );
  }

  const turns = readArrayField(payload, ["turns"]);
  const messages: unknown[] = [];

  for (const [turnIndex, turn] of turns.entries()) {
    if (!isRecord(turn)) {
      continue;
    }

    const nestedMessages = readArrayField(turn, ["messages"]);

    if (nestedMessages.length > 0) {
      messages.push(
        ...nestedMessages.map((message, messageIndex) =>
          attachSourceReferenceToMessage(
            message,
            `turns:${turnIndex}:messages:${messageIndex}`,
          ),
        ),
      );
      continue;
    }

    const userContent = turn.query ?? turn.user ?? turn.prompt;
    const assistantContent = turn.response ?? turn.assistant ?? turn.model;

    if (userContent !== undefined) {
      messages.push({
        content: userContent,
        role: "user",
        sourceReference: `turns:${turnIndex}:query`,
      });
    }

    if (assistantContent !== undefined) {
      messages.push({
        content: assistantContent,
        role: "assistant",
        sourceReference: `turns:${turnIndex}:response`,
      });
    }
  }

  return messages;
}

function resolveChatGptModel(
  payload: ValidatedChatGptConversationPayload,
  messages: readonly unknown[],
): string | undefined {
  const topLevelModel =
    readOptionalTrimmedString(payload.model) ??
    readOptionalTrimmedString(payload.default_model_slug);

  if (topLevelModel !== undefined) {
    return topLevelModel;
  }

  for (const message of messages) {
    if (!isRecord(message)) {
      continue;
    }

    const messageModel =
      readOptionalTrimmedString(message.model) ??
      readOptionalTrimmedString(message.model_slug) ??
      (isRecord(message.metadata)
        ? readOptionalTrimmedString(message.metadata.model_slug)
        : undefined);

    if (messageModel !== undefined) {
      return messageModel;
    }
  }

  return undefined;
}

function resolveGeminiModel(
  payload: ValidatedGeminiConversationPayload,
): string | undefined {
  return (
    readOptionalTrimmedString(payload.model) ??
    readOptionalTrimmedString(payload.modelName)
  );
}

export function createCanonicalAiConversationImport(
  input: CreateCanonicalAiConversationImportInput,
): CanonicalAiConversationImport {
  const normalizedRawContent = input.rawContent.trim();

  if (normalizedRawContent.length === 0) {
    throw new TypeError(CANONICAL_AI_CONVERSATION_RAW_CONTENT_REQUIRED_ERROR);
  }

  const normalizedSourceUrl = readOptionalTrimmedString(input.sourceUrl);

  return {
    rawContent: normalizedRawContent,
    sourceType: AI_CONVERSATION_IMPORT_SOURCE_TYPE,
    ...(normalizedSourceUrl === undefined ? {} : { sourceUrl: normalizedSourceUrl }),
    sourceMeta: normalizeCanonicalSourceMeta(input.sourceMeta, normalizedSourceUrl),
  };
}

export function extractClaudeConversationImport(
  payload: ValidatedClaudeConversationPayload,
): CanonicalAiConversationImport {
  const turns = createTurnsFromMessages(
    readClaudeConversationMessages(payload),
    (message) =>
      createCanonicalParticipantFromMessageAuthor(
        message.author ?? message.sender ?? message.role,
        message.role ?? message.sender ?? message.author,
      ),
    (message) =>
      joinTextFragments(
        extractTextFragments(message.content ?? message.text ?? message),
      ),
  );

  return buildCanonicalImportFromExtractedTurns({
    additionalSourceMeta: extractAdditionalCanonicalSourceMeta(
      payload as unknown as Record<string, unknown>,
    ),
    conversationTitle: resolveConversationTitle(payload),
    conversationUrl: resolveConversationUrl(payload),
    errorMessage: CLAUDE_CONVERSATION_BODY_REQUIRED_ERROR,
    model: readOptionalTrimmedString(payload.model),
    provider: "claude",
    turns,
  });
}

export function extractChatGptConversationImport(
  payload: ValidatedChatGptConversationPayload,
): CanonicalAiConversationImport {
  const messages = readChatGptConversationMessages(payload);
  const turns = createTurnsFromMessages(
    messages,
    (message) =>
      createCanonicalParticipantFromMessageAuthor(
        message.author,
        isRecord(message.author)
          ? message.author.role ?? message.author.name ?? message.role
          : message.author ?? message.role,
      ),
    (message) =>
      joinTextFragments(
        extractTextFragments(
          message.content ?? message.parts ?? message.text ?? message,
        ),
      ),
  );

  return buildCanonicalImportFromExtractedTurns({
    additionalSourceMeta: extractAdditionalCanonicalSourceMeta(
      payload as unknown as Record<string, unknown>,
    ),
    conversationTitle: resolveConversationTitle(payload),
    conversationUrl: resolveConversationUrl(payload),
    errorMessage: CHATGPT_CONVERSATION_BODY_REQUIRED_ERROR,
    model: resolveChatGptModel(payload, messages),
    provider: "chatgpt",
    turns,
  });
}

export function extractGeminiConversationImport(
  payload: ValidatedGeminiConversationPayload,
): CanonicalAiConversationImport {
  const turns = createTurnsFromMessages(
    readGeminiConversationMessages(payload),
    (message) =>
      createCanonicalParticipantFromMessageAuthor(
        message.author,
        isRecord(message.author)
          ? message.author.role ?? message.author.name ?? message.role
          : message.author ?? message.role,
      ),
    (message) =>
      joinTextFragments(
        extractTextFragments(
          message.content ?? message.parts ?? message.text ?? message,
        ),
      ),
  );

  return buildCanonicalImportFromExtractedTurns({
    additionalSourceMeta: extractAdditionalCanonicalSourceMeta(
      payload as unknown as Record<string, unknown>,
    ),
    conversationTitle: resolveConversationTitle(payload),
    conversationUrl: resolveConversationUrl(payload),
    errorMessage: GEMINI_CONVERSATION_BODY_REQUIRED_ERROR,
    model: resolveGeminiModel(payload),
    provider: "gemini",
    turns,
  });
}

export function extractAiConversationImportFromValidatedPayload(
  payload: ValidatedAiConversationPayload,
): CanonicalAiConversationImport {
  switch (payload.provider) {
    case "claude":
      return extractClaudeConversationImport(payload);
    case "chatgpt":
      return extractChatGptConversationImport(payload);
    case "gemini":
      return extractGeminiConversationImport(payload);
  }
}
