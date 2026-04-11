import { createHash, randomUUID } from "node:crypto";

import type {
  CanonicalAiConversationParticipant,
  CanonicalAiConversationSourceMeta,
  CanonicalAiConversationTurn,
} from "./ai-conversation.ts";
import {
  deriveCanonicalParticipantDisplayNameCandidate,
  selectPreferredCanonicalParticipantDisplayName,
} from "./ai-conversation-participant-display-name.ts";

const GENERIC_PARTICIPANT_ALIASES = new Set([
  "ai",
  "assistant",
  "bot",
  "human",
  "model",
  "speaker",
  "system",
  "user",
]);

const PARTICIPANT_ALIAS_METADATA_FIELDS = [
  {
    fieldNames: ["email"],
    kind: "email",
    strength: 3,
  },
  {
    fieldNames: ["username", "userName", "user_name"],
    kind: "username",
    strength: 2,
  },
  {
    fieldNames: ["handle"],
    kind: "handle",
    strength: 2,
  },
  {
    fieldNames: ["displayName", "display_name", "fullName", "full_name", "name"],
    kind: "name",
    strength: 1,
  },
] as const;

type ParticipantAliasKind =
  (typeof PARTICIPANT_ALIAS_METADATA_FIELDS)[number]["kind"];

interface ParticipantAliasRecord {
  display: string;
  kind: ParticipantAliasKind | "name";
  normalized: string;
  strength: number;
}

interface ParticipantIdentitySnapshot {
  aliasMap: Map<string, ParticipantAliasRecord>;
  displayNameCandidate?: ReturnType<
    typeof deriveCanonicalParticipantDisplayNameCandidate
  >;
  identityId: string;
  roleKey?: string;
  sourceKeys: Set<string>;
}

export interface ResolveAiConversationParticipantIdentitiesArgs {
  generateIdentityId?: () => string;
  historicalSourceMetas?: readonly CanonicalAiConversationSourceMeta[];
  sourceMeta: CanonicalAiConversationSourceMeta;
}

export interface HistoricalAiConversationParticipantIdentityResolver {
  resolve(args: {
    sourceMeta: CanonicalAiConversationSourceMeta;
    userId: string;
  }): Promise<CanonicalAiConversationSourceMeta>;
}

export interface HistoricalAiConversationParticipantSourceMetaLoader {
  loadHistoricalSourceMetas(
    userId: string,
  ): Promise<readonly CanonicalAiConversationSourceMeta[]>;
}

function readOptionalTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalizedValue = value.trim();

  return normalizedValue.length > 0 ? normalizedValue : undefined;
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

function readOptionalNonNegativeInteger(value: unknown): number | undefined {
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readTurnsFromSourceMeta(
  sourceMeta: CanonicalAiConversationSourceMeta,
): CanonicalAiConversationTurn[] {
  if (!Array.isArray(sourceMeta.turns)) {
    return [];
  }

  return sourceMeta.turns.flatMap((turn) => {
    if (!isRecord(turn)) {
      return [];
    }

    const text = readOptionalTrimmedString(turn.text);

    if (text === undefined) {
      return [];
    }

    const participantIdentityId = readOptionalTrimmedString(
      turn.participantIdentityId,
    );
    const participantIndex = readOptionalNonNegativeInteger(turn.participantIndex);
    const capturedAt = readOptionalTrimmedString(turn.capturedAt);
    const role = readOptionalTrimmedString(turn.role);
    const sourceReference = readOptionalTrimmedString(turn.sourceReference);

    return [
      {
        ...(capturedAt === undefined ? {} : { capturedAt }),
        ...(participantIdentityId === undefined ? {} : { participantIdentityId }),
        ...(participantIndex === undefined ? {} : { participantIndex }),
        ...(role === undefined ? {} : { role }),
        ...(sourceReference === undefined ? {} : { sourceReference }),
        text,
      },
    ];
  });
}

function normalizeAliasValue(value: string, kind: ParticipantAliasKind | "name") {
  const trimmedValue = value.trim();

  if (trimmedValue.length === 0) {
    return undefined;
  }

  const collapsedValue =
    kind === "email"
      ? trimmedValue.toLowerCase()
      : trimmedValue.replace(/\s+/g, " ").replace(/^@+/, "").toLowerCase();

  return collapsedValue.length > 0 ? collapsedValue : undefined;
}

function normalizeRoleKey(value: unknown): string | undefined {
  const normalizedValue = readOptionalTrimmedString(value)?.toLowerCase();

  if (normalizedValue === undefined) {
    return undefined;
  }

  switch (normalizedValue) {
    case "ai":
    case "assistant":
    case "bard":
    case "bot":
    case "chatgpt":
    case "claude":
    case "gemini":
    case "model":
      return "assistant";
    case "human":
    case "prompt":
    case "user":
      return "user";
    default:
      return normalizedValue;
  }
}

function createParticipantSourceKey(
  provider: CanonicalAiConversationSourceMeta["provider"],
  sourceId: string,
): string {
  return `${provider}:${sourceId.trim().toLowerCase()}`;
}

function addParticipantAliasRecord(
  aliasMap: Map<string, ParticipantAliasRecord>,
  value: unknown,
  kind: ParticipantAliasKind | "name",
  strength: number,
): void {
  const display = readOptionalTrimmedString(value);

  if (display === undefined) {
    return;
  }

  const normalized = normalizeAliasValue(display, kind);

  if (normalized === undefined) {
    return;
  }

  const existingAliasRecord = aliasMap.get(normalized);

  if (
    existingAliasRecord === undefined ||
    existingAliasRecord.strength < strength ||
    (existingAliasRecord.strength === strength &&
      display.length > existingAliasRecord.display.length)
  ) {
    aliasMap.set(normalized, {
      display,
      kind,
      normalized,
      strength,
    });
  }
}

export function collectParticipantAliasRecords(
  participant: CanonicalAiConversationParticipant,
): ParticipantAliasRecord[] {
  const aliasMap = new Map<string, ParticipantAliasRecord>();

  addParticipantAliasRecord(aliasMap, participant.name, "name", 1);

  for (const alias of readOptionalStringArray(participant.aliases) ?? []) {
    addParticipantAliasRecord(aliasMap, alias, "name", 1);
  }

  if (isRecord(participant.sourceMetadata)) {
    for (const field of PARTICIPANT_ALIAS_METADATA_FIELDS) {
      for (const fieldName of field.fieldNames) {
        addParticipantAliasRecord(
          aliasMap,
          participant.sourceMetadata[fieldName],
          field.kind,
          field.strength,
        );
      }
    }
  }

  return [...aliasMap.values()].sort((left, right) => {
    if (right.strength !== left.strength) {
      return right.strength - left.strength;
    }

    return left.normalized.localeCompare(right.normalized);
  });
}

function collectParticipantSourceKeys(
  provider: CanonicalAiConversationSourceMeta["provider"],
  participant: CanonicalAiConversationParticipant,
): Set<string> {
  const sourceKeys = new Set<string>();
  const sourceId = readOptionalTrimmedString(participant.sourceId);

  if (sourceId !== undefined) {
    sourceKeys.add(createParticipantSourceKey(provider, sourceId));
  }

  return sourceKeys;
}

function deriveFallbackParticipantIdentityId(
  provider: CanonicalAiConversationSourceMeta["provider"],
  participant: CanonicalAiConversationParticipant,
): string {
  const aliasRecords = collectParticipantAliasRecords(participant);
  const sourceKey = [...collectParticipantSourceKeys(provider, participant)].sort()[0];
  const strongestAlias = aliasRecords.find(
    (aliasRecord) => !GENERIC_PARTICIPANT_ALIASES.has(aliasRecord.normalized),
  );
  const roleKey = normalizeRoleKey(participant.role) ?? "unknown";
  const fingerprint =
    sourceKey ??
    strongestAlias?.normalized ??
    aliasRecords[0]?.normalized ??
    `${roleKey}:${participant.name ?? participant.role ?? "participant"}`;

  return `participant_${createHash("sha256").update(fingerprint).digest("hex").slice(0, 24)}`;
}

function readParticipantsFromSourceMeta(
  sourceMeta: CanonicalAiConversationSourceMeta,
): CanonicalAiConversationParticipant[] {
  if (Array.isArray(sourceMeta.participants) && sourceMeta.participants.length > 0) {
    return [...sourceMeta.participants];
  }

  const participantCount = Math.max(
    sourceMeta.participantNames?.length ?? 0,
    sourceMeta.participantRoles?.length ?? 0,
  );

  if (participantCount === 0) {
    return [];
  }

  return Array.from({ length: participantCount }, (_, index) => ({
    ...(sourceMeta.participantNames?.[index] === undefined
      ? {}
      : { name: sourceMeta.participantNames[index] }),
    ...(sourceMeta.participantRoles?.[index] === undefined
      ? {}
      : { role: sourceMeta.participantRoles[index] }),
  }));
}

function buildParticipantIdentitySnapshots(
  historicalSourceMetas: readonly CanonicalAiConversationSourceMeta[],
): ParticipantIdentitySnapshot[] {
  const identitySnapshotsById = new Map<string, ParticipantIdentitySnapshot>();

  for (const sourceMeta of historicalSourceMetas) {
    for (const participant of readParticipantsFromSourceMeta(sourceMeta)) {
      const identityId =
        readOptionalTrimmedString(participant.identityId) ??
        deriveFallbackParticipantIdentityId(sourceMeta.provider, participant);
      const existingIdentitySnapshot = identitySnapshotsById.get(identityId);
      const identitySnapshot =
        existingIdentitySnapshot ??
        (() => {
          const createdIdentitySnapshot: ParticipantIdentitySnapshot = {
            aliasMap: new Map<string, ParticipantAliasRecord>(),
            displayNameCandidate: undefined,
            identityId,
            roleKey: normalizeRoleKey(participant.role),
            sourceKeys: new Set<string>(),
          };

          identitySnapshotsById.set(identityId, createdIdentitySnapshot);

          return createdIdentitySnapshot;
        })();

      for (const aliasRecord of collectParticipantAliasRecords(participant)) {
        addParticipantAliasRecord(
          identitySnapshot.aliasMap,
          aliasRecord.display,
          aliasRecord.kind,
          aliasRecord.strength,
        );
      }

      identitySnapshot.displayNameCandidate =
        selectPreferredCanonicalParticipantDisplayName(
          identitySnapshot.displayNameCandidate,
          deriveCanonicalParticipantDisplayNameCandidate({
            assistantName: readOptionalTrimmedString(sourceMeta.assistantName),
            participant,
            provider: sourceMeta.provider,
          }),
        );

      for (const sourceKey of collectParticipantSourceKeys(
        sourceMeta.provider,
        participant,
      )) {
        identitySnapshot.sourceKeys.add(sourceKey);
      }

      if (identitySnapshot.roleKey === undefined) {
        identitySnapshot.roleKey = normalizeRoleKey(participant.role);
      }
    }
  }

  return [...identitySnapshotsById.values()];
}

function areParticipantRolesCompatible(
  currentRoleKey: string | undefined,
  candidateRoleKey: string | undefined,
): boolean {
  return (
    currentRoleKey === undefined ||
    candidateRoleKey === undefined ||
    currentRoleKey === candidateRoleKey
  );
}

function selectSourceMatchedIdentity(
  currentSourceKeys: Set<string>,
  identitySnapshots: readonly ParticipantIdentitySnapshot[],
): ParticipantIdentitySnapshot | null {
  const sourceMatchedIdentitySnapshots = identitySnapshots
    .filter((identitySnapshot) =>
      [...currentSourceKeys].some((sourceKey) =>
        identitySnapshot.sourceKeys.has(sourceKey),
      ),
    )
    .sort((left, right) => left.identityId.localeCompare(right.identityId));

  return sourceMatchedIdentitySnapshots[0] ?? null;
}

function selectAliasMatchedIdentity(
  currentAliasRecords: readonly ParticipantAliasRecord[],
  currentRoleKey: string | undefined,
  identitySnapshots: readonly ParticipantIdentitySnapshot[],
): ParticipantIdentitySnapshot | null {
  const aliasMatchScoresByStrength = new Map<
    number,
    Map<string, { identitySnapshot: ParticipantIdentitySnapshot; score: number }>
  >();

  for (const currentAliasRecord of currentAliasRecords) {
    if (
      currentAliasRecord.strength <= 1 &&
      GENERIC_PARTICIPANT_ALIASES.has(currentAliasRecord.normalized)
    ) {
      continue;
    }

    for (const identitySnapshot of identitySnapshots) {
      if (
        !identitySnapshot.aliasMap.has(currentAliasRecord.normalized) ||
        !areParticipantRolesCompatible(currentRoleKey, identitySnapshot.roleKey)
      ) {
        continue;
      }

      const identityMatchesById =
        aliasMatchScoresByStrength.get(currentAliasRecord.strength) ?? new Map();
      const existingMatch = identityMatchesById.get(identitySnapshot.identityId);

      identityMatchesById.set(identitySnapshot.identityId, {
        identitySnapshot,
        score: (existingMatch?.score ?? 0) + 1,
      });
      aliasMatchScoresByStrength.set(
        currentAliasRecord.strength,
        identityMatchesById,
      );
    }
  }

  const orderedStrengths = [...aliasMatchScoresByStrength.keys()].sort(
    (left, right) => right - left,
  );

  for (const strength of orderedStrengths) {
    const aliasMatches = [
      ...(aliasMatchScoresByStrength.get(strength)?.values() ?? []),
    ].sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.identitySnapshot.identityId.localeCompare(
        right.identitySnapshot.identityId,
      );
    });

    if (aliasMatches.length === 0) {
      continue;
    }

    if (aliasMatches.length === 1) {
      return aliasMatches[0].identitySnapshot;
    }

    if (aliasMatches[0]?.score !== aliasMatches[1]?.score) {
      return aliasMatches[0]?.identitySnapshot ?? null;
    }
  }

  return null;
}

function mergeParticipantAliases(
  currentAliasRecords: readonly ParticipantAliasRecord[],
  matchedIdentitySnapshot: ParticipantIdentitySnapshot | null,
): string[] | undefined {
  const mergedAliases = new Map<string, ParticipantAliasRecord>();

  for (const aliasRecord of matchedIdentitySnapshot?.aliasMap.values() ?? []) {
    mergedAliases.set(aliasRecord.normalized, aliasRecord);
  }

  for (const aliasRecord of currentAliasRecords) {
    const existingAliasRecord = mergedAliases.get(aliasRecord.normalized);

    if (
      existingAliasRecord === undefined ||
      existingAliasRecord.strength < aliasRecord.strength ||
      (existingAliasRecord.strength === aliasRecord.strength &&
        aliasRecord.display.length > existingAliasRecord.display.length)
    ) {
      mergedAliases.set(aliasRecord.normalized, aliasRecord);
    }
  }

  const aliasDisplays = [...mergedAliases.values()]
    .sort((left, right) => {
      if (right.strength !== left.strength) {
        return right.strength - left.strength;
      }

      return left.display.localeCompare(right.display);
    })
    .map((aliasRecord) => aliasRecord.display);

  return aliasDisplays.length > 0 ? aliasDisplays : undefined;
}

export function resolveAiConversationParticipantIdentities(
  args: ResolveAiConversationParticipantIdentitiesArgs,
): CanonicalAiConversationSourceMeta {
  const currentParticipants = readParticipantsFromSourceMeta(args.sourceMeta);

  if (currentParticipants.length === 0) {
    return args.sourceMeta;
  }

  const identitySnapshots = buildParticipantIdentitySnapshots(
    args.historicalSourceMetas ?? [],
  );
  const generateIdentityId = args.generateIdentityId ?? randomUUID;

  const resolvedParticipants = currentParticipants.map((participant) => {
    const currentAliasRecords = collectParticipantAliasRecords(participant);
    const currentSourceKeys = collectParticipantSourceKeys(
      args.sourceMeta.provider,
      participant,
    );
    const currentRoleKey = normalizeRoleKey(participant.role);
    const sourceMatchedIdentity = selectSourceMatchedIdentity(
      currentSourceKeys,
      identitySnapshots,
    );
    const aliasMatchedIdentity =
      sourceMatchedIdentity ??
      selectAliasMatchedIdentity(
        currentAliasRecords,
        currentRoleKey,
        identitySnapshots,
      );
    const resolvedIdentityId =
      sourceMatchedIdentity?.identityId ??
      aliasMatchedIdentity?.identityId ??
      readOptionalTrimmedString(participant.identityId) ??
      generateIdentityId();
    const resolvedDisplayName =
      selectPreferredCanonicalParticipantDisplayName(
        deriveCanonicalParticipantDisplayNameCandidate({
          assistantName: readOptionalTrimmedString(args.sourceMeta.assistantName),
          participant,
          provider: args.sourceMeta.provider,
        }),
        sourceMatchedIdentity?.displayNameCandidate ??
          aliasMatchedIdentity?.displayNameCandidate,
      )?.value;
    const resolvedAliases = mergeParticipantAliases(
      currentAliasRecords,
      aliasMatchedIdentity,
    );
    const { name: _name, ...participantWithoutName } = participant;

    return {
      ...participantWithoutName,
      identityId: resolvedIdentityId,
      ...(resolvedDisplayName === undefined ? {} : { name: resolvedDisplayName }),
      ...(resolvedAliases === undefined ? {} : { aliases: resolvedAliases }),
    };
  });
  const resolvedParticipantNames = resolvedParticipants.flatMap((participant) => {
    const name = readOptionalTrimmedString(participant.name);
    return name === undefined ? [] : [name];
  });
  const resolvedParticipantRoles = resolvedParticipants.flatMap((participant) => {
    const role = readOptionalTrimmedString(participant.role);
    return role === undefined ? [] : [role];
  });
  const resolvedTurns = readTurnsFromSourceMeta(args.sourceMeta).map((turn) => {
    const resolvedParticipant =
      turn.participantIndex === undefined
        ? undefined
        : resolvedParticipants[turn.participantIndex];
    const resolvedIdentityId =
      readOptionalTrimmedString(turn.participantIdentityId) ??
      readOptionalTrimmedString(resolvedParticipant?.identityId);
    const resolvedRole =
      readOptionalTrimmedString(turn.role) ??
      readOptionalTrimmedString(resolvedParticipant?.role);

    return {
      ...(turn.capturedAt === undefined ? {} : { capturedAt: turn.capturedAt }),
      ...(resolvedIdentityId === undefined
        ? {}
        : { participantIdentityId: resolvedIdentityId }),
      ...(turn.participantIndex === undefined
        ? {}
        : { participantIndex: turn.participantIndex }),
      ...(resolvedRole === undefined ? {} : { role: resolvedRole }),
      ...(turn.sourceReference === undefined
        ? {}
        : { sourceReference: turn.sourceReference }),
      text: turn.text,
    };
  });

  return {
    ...args.sourceMeta,
    participantCount:
      args.sourceMeta.participantCount ?? resolvedParticipants.length,
    ...(resolvedParticipantNames.length > 0
      ? { participantNames: resolvedParticipantNames }
      : {}),
    participants: resolvedParticipants,
    ...(args.sourceMeta.participantRoles !== undefined
      ? { participantRoles: args.sourceMeta.participantRoles }
      : resolvedParticipantRoles.length > 0
        ? { participantRoles: resolvedParticipantRoles }
        : {}),
    ...(resolvedTurns.length > 0 ? { turns: resolvedTurns } : {}),
  };
}

export function createHistoricalAiConversationParticipantIdentityResolver(
  loader: HistoricalAiConversationParticipantSourceMetaLoader,
  options: Pick<
    ResolveAiConversationParticipantIdentitiesArgs,
    "generateIdentityId"
  > = {},
): HistoricalAiConversationParticipantIdentityResolver {
  return {
    async resolve({ sourceMeta, userId }) {
      return resolveAiConversationParticipantIdentities({
        generateIdentityId: options.generateIdentityId,
        historicalSourceMetas: await loader.loadHistoricalSourceMetas(userId),
        sourceMeta,
      });
    },
  };
}
