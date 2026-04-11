import { randomBytes } from "node:crypto";

import {
  API_KEY_PLAINTEXT_PREFIX,
  extractApiKeySecret,
  hashApiKey,
  type ApiKeyAuthStore,
} from "./api-key.ts";

export const API_KEY_SECRET_PREFIX = API_KEY_PLAINTEXT_PREFIX;
export const API_KEY_PREFIX_LENGTH = 16;
export const API_KEY_SECRET_BYTES = 24;

type JsonPrimitive = boolean | number | string | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | {
      [key: string]: JsonValue;
    };

export interface ApiKeyScope {
  userId: string;
  tenantId: string;
  workspaceId: string;
}

export interface ApiKeySafeRecord extends ApiKeyScope {
  id: string;
  name: string;
  description: string | null;
  keyPrefix: string;
  metadata: JsonValue | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface StoredApiKeyRecord extends ApiKeySafeRecord {
  hashedKey: string;
}

export interface CreateApiKeyInput extends ApiKeyScope {
  name: string;
  description?: string | null;
  metadata?: JsonValue | null;
}

export interface ScopedApiKeyLookup extends ApiKeyScope {
  apiKeyId: string;
}

export interface RotateApiKeyInput extends ScopedApiKeyLookup {
  name?: string;
  description?: string | null;
  metadata?: JsonValue | null;
}

export interface CreateApiKeyOptions {
  plainKey?: string;
}

export interface RevokeApiKeyOptions {
  revokedAt?: Date;
}

export interface RotateApiKeyOptions {
  plainKey?: string;
  revokedAt?: Date;
}

export interface CreatedApiKeyResult {
  apiKey: ApiKeySafeRecord;
  plainKey: string;
}

export interface RotatedApiKeyResult extends CreatedApiKeyResult {
  previousApiKey: ApiKeySafeRecord;
}

export interface GeneratedApiKeyMaterial {
  plainKey: string;
  secret: string;
  keyPrefix: string;
  hashedKey: string;
}

export interface ApiKeyRecordWhere {
  id?: string;
  userId?: string;
  tenantId?: string;
  workspaceId?: string;
  hashedKey?: string;
  revokedAt?: Date | null;
}

export interface ApiKeyCreateData extends ApiKeyScope {
  name: string;
  description: string | null;
  keyPrefix: string;
  metadata: JsonValue | null;
  hashedKey: string;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

export interface ApiKeyUpdateData {
  name?: string;
  description?: string | null;
  keyPrefix?: string;
  metadata?: JsonValue | null;
  hashedKey?: string;
  lastUsedAt?: Date | null;
  revokedAt?: Date | null;
}

export interface ApiKeyPersistenceClient<
  TRecord extends StoredApiKeyRecord = StoredApiKeyRecord,
> {
  apiKey: {
    create(args: { data: ApiKeyCreateData }): Promise<TRecord>;
    findFirst(args: { where: ApiKeyRecordWhere }): Promise<TRecord | null>;
    findMany(args: {
      where: ApiKeyRecordWhere;
      orderBy: Array<{ createdAt: "asc" | "desc" }>;
    }): Promise<TRecord[]>;
    update(args: { where: { id: string }; data: ApiKeyUpdateData }): Promise<TRecord>;
  };
  $transaction?<T>(
    operation: (
      client: ApiKeyPersistenceClient<TRecord>,
    ) => Promise<T>,
  ): Promise<T>;
}

export interface ApiKeyRepositoryRoot<
  TRecord extends StoredApiKeyRecord = StoredApiKeyRecord,
> {
  apiKey: {
    create(args: { data: ApiKeyCreateData }): Promise<TRecord>;
    findFirst(args: { where: ApiKeyRecordWhere }): Promise<TRecord | null>;
    findMany(args: {
      where: ApiKeyRecordWhere;
      orderBy: Array<{ createdAt: "asc" | "desc" }>;
    }): Promise<TRecord[]>;
    update(args: { where: { id: string }; data: ApiKeyUpdateData }): Promise<TRecord>;
  };
  $transaction?<T>(
    operation: (client: ApiKeyRepositoryRoot<TRecord>) => Promise<T>,
  ): Promise<T>;
}

export function createApiKeyPersistenceRepository<
  TRecord extends StoredApiKeyRecord,
>(
  root: ApiKeyRepositoryRoot<TRecord>,
): ApiKeyPersistenceClient<TRecord> {
  return {
    apiKey: {
      async create(args) {
        return root.apiKey.create(args);
      },
      async findFirst(args) {
        return root.apiKey.findFirst(args);
      },
      async findMany(args) {
        return root.apiKey.findMany(args);
      },
      async update(args) {
        return root.apiKey.update(args);
      },
    },
    $transaction:
      root.$transaction === undefined
        ? undefined
        : async function runRepositoryTransaction<TResult>(
            operation: (
              client: ApiKeyPersistenceClient<TRecord>,
            ) => Promise<TResult>,
          ): Promise<TResult> {
            return root.$transaction!(async (tx) =>
              operation(createApiKeyPersistenceRepository(tx)),
            );
          },
  };
}

function normalizeDescription(
  description: string | null | undefined,
): string | null {
  return description ?? null;
}

function normalizeMetadata(metadata: JsonValue | null | undefined): JsonValue | null {
  return metadata ?? null;
}

export function generatePlainApiKey(): string {
  return `${API_KEY_SECRET_PREFIX}${randomBytes(API_KEY_SECRET_BYTES).toString("base64url")}`;
}

export function createApiKeyMaterial(
  plainKey: string = generatePlainApiKey(),
): GeneratedApiKeyMaterial {
  return {
    plainKey,
    secret: extractApiKeySecret(plainKey),
    keyPrefix: deriveApiKeyPrefix(plainKey),
    hashedKey: hashApiKey(plainKey),
  };
}

export function deriveApiKeyPrefix(
  plainKey: string,
  visibleLength: number = API_KEY_PREFIX_LENGTH,
): string {
  if (plainKey.trim().length === 0) {
    throw new Error("API key must be a non-empty string");
  }

  return plainKey.slice(
    0,
    Math.max(API_KEY_SECRET_PREFIX.length + 1, visibleLength),
  );
}

export function toApiKeySafeRecord<TRecord extends StoredApiKeyRecord>(
  record: TRecord,
): ApiKeySafeRecord {
  const { hashedKey: _hashedKey, ...safeRecord } = record;

  return safeRecord;
}

async function runTransaction<TRecord extends StoredApiKeyRecord, TResult>(
  client: ApiKeyPersistenceClient<TRecord>,
  operation: (tx: ApiKeyPersistenceClient<TRecord>) => Promise<TResult>,
): Promise<TResult> {
  if (client.$transaction) {
    return client.$transaction(operation);
  }

  return operation(client);
}

function buildScopedApiKeyWhere(input: ScopedApiKeyLookup): ApiKeyRecordWhere {
  return {
    id: input.apiKeyId,
    userId: input.userId,
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
  };
}

export async function createApiKey<TRecord extends StoredApiKeyRecord>(
  client: ApiKeyPersistenceClient<TRecord>,
  input: CreateApiKeyInput,
  options: CreateApiKeyOptions = {},
): Promise<CreatedApiKeyResult> {
  const apiKeyMaterial = createApiKeyMaterial(options.plainKey);
  const storedRecord = await client.apiKey.create({
    data: {
      userId: input.userId,
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      name: input.name,
      description: normalizeDescription(input.description),
      keyPrefix: apiKeyMaterial.keyPrefix,
      metadata: normalizeMetadata(input.metadata),
      hashedKey: apiKeyMaterial.hashedKey,
      lastUsedAt: null,
      revokedAt: null,
    },
  });

  return {
    apiKey: toApiKeySafeRecord(storedRecord),
    plainKey: apiKeyMaterial.plainKey,
  };
}

export async function fetchApiKey<TRecord extends StoredApiKeyRecord>(
  client: ApiKeyPersistenceClient<TRecord>,
  input: ScopedApiKeyLookup,
): Promise<ApiKeySafeRecord | null> {
  const record = await client.apiKey.findFirst({
    where: buildScopedApiKeyWhere(input),
  });

  return record === null ? null : toApiKeySafeRecord(record);
}

export async function listApiKeys<TRecord extends StoredApiKeyRecord>(
  client: ApiKeyPersistenceClient<TRecord>,
  scope: ApiKeyScope,
): Promise<ApiKeySafeRecord[]> {
  const records = await client.apiKey.findMany({
    where: {
      userId: scope.userId,
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
    },
    orderBy: [{ createdAt: "desc" }],
  });

  return records.map((record) => toApiKeySafeRecord(record));
}

export async function revokeApiKey<TRecord extends StoredApiKeyRecord>(
  client: ApiKeyPersistenceClient<TRecord>,
  input: ScopedApiKeyLookup,
  options: RevokeApiKeyOptions = {},
): Promise<ApiKeySafeRecord | null> {
  const existingRecord = await client.apiKey.findFirst({
    where: buildScopedApiKeyWhere(input),
  });

  if (existingRecord === null) {
    return null;
  }

  if (existingRecord.revokedAt !== null) {
    return toApiKeySafeRecord(existingRecord);
  }

  const revokedRecord = await client.apiKey.update({
    where: {
      id: existingRecord.id,
    },
    data: {
      revokedAt: options.revokedAt ?? new Date(),
    },
  });

  return toApiKeySafeRecord(revokedRecord);
}

export async function rotateApiKey<TRecord extends StoredApiKeyRecord>(
  client: ApiKeyPersistenceClient<TRecord>,
  input: RotateApiKeyInput,
  options: RotateApiKeyOptions = {},
): Promise<RotatedApiKeyResult | null> {
  return runTransaction(client, async (tx) => {
    const existingRecord = await tx.apiKey.findFirst({
      where: buildScopedApiKeyWhere(input),
    });

    if (existingRecord === null || existingRecord.revokedAt !== null) {
      return null;
    }

    const revokedAt = options.revokedAt ?? new Date();
    const revokedRecord = await tx.apiKey.update({
      where: {
        id: existingRecord.id,
      },
      data: {
        revokedAt,
      },
    });
    const nextRecord = await createApiKey(
      tx,
      {
        userId: existingRecord.userId,
        tenantId: existingRecord.tenantId,
        workspaceId: existingRecord.workspaceId,
        name: input.name ?? existingRecord.name,
        description:
          input.description === undefined
            ? existingRecord.description
            : input.description,
        metadata:
          input.metadata === undefined ? existingRecord.metadata : input.metadata,
      },
      {
        plainKey: options.plainKey,
      },
    );

    return {
      previousApiKey: toApiKeySafeRecord(revokedRecord),
      apiKey: nextRecord.apiKey,
      plainKey: nextRecord.plainKey,
    };
  });
}

export function createApiKeyAuthStore<TRecord extends StoredApiKeyRecord>(
  client: ApiKeyPersistenceClient<TRecord>,
): ApiKeyAuthStore {
  return {
    async findApiKeyByHashedKey(hashedKey) {
      const record = await client.apiKey.findFirst({
        where: {
          hashedKey,
          revokedAt: null,
        },
      });

      if (record === null) {
        return null;
      }

      return {
        id: record.id,
        userId: record.userId,
        revokedAt: record.revokedAt,
      };
    },
    async findInactiveApiKeyByHashedKey(hashedKey) {
      const record = await client.apiKey.findFirst({
        where: {
          hashedKey,
        },
      });

      if (record === null || record.revokedAt === null) {
        return null;
      }

      return {
        id: record.id,
        userId: record.userId,
        revokedAt: record.revokedAt,
      };
    },
    async markApiKeyUsed(apiKeyId, lastUsedAt) {
      await client.apiKey.update({
        where: {
          id: apiKeyId,
        },
        data: {
          lastUsedAt,
        },
      });
    },
  };
}

export const createScopedApiKey = createApiKey;
export const fetchScopedApiKey = fetchApiKey;
export const listScopedApiKeys = listApiKeys;
export const revokeScopedApiKey = revokeApiKey;
export const rotateScopedApiKey = rotateApiKey;
export const generateApiKeyMaterial = createApiKeyMaterial;
