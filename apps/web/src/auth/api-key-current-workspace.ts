import {
  createApiKey,
  fetchApiKey,
  listApiKeys,
  revokeApiKey,
  rotateApiKey,
  type ApiKeyPersistenceClient,
  type ApiKeySafeRecord,
  type ApiKeyScope,
  type CreateApiKeyInput,
  type CreateApiKeyOptions,
  type CreatedApiKeyResult,
  type RevokeApiKeyOptions,
  type RotateApiKeyInput,
  type RotateApiKeyOptions,
  type RotatedApiKeyResult,
  type ScopedApiKeyLookup,
  type StoredApiKeyRecord,
} from "./api-key-persistence.ts";

export interface CurrentWorkspaceApiKeyScopeResolver {
  resolveCurrentWorkspaceApiKeyScope(): Promise<ApiKeyScope | null>;
}

export interface CurrentWorkspaceApiKeySessionUserLike {
  id?: unknown;
  [key: string]: unknown;
}

export interface CurrentWorkspaceApiKeySessionWorkspaceLike {
  id?: unknown;
  tenantId?: unknown;
  workspaceId?: unknown;
  [key: string]: unknown;
}

export interface CurrentWorkspaceApiKeySessionLike {
  user?: CurrentWorkspaceApiKeySessionUserLike | null;
  userId?: unknown;
  tenantId?: unknown;
  workspaceId?: unknown;
  workspace?: CurrentWorkspaceApiKeySessionWorkspaceLike | null;
  [key: string]: unknown;
}

export interface CurrentWorkspaceApiKeySessionProvider<
  TSession extends CurrentWorkspaceApiKeySessionLike = CurrentWorkspaceApiKeySessionLike,
> {
  getCurrentWorkspaceSession(): Promise<TSession | null>;
}

export interface CurrentWorkspaceMembershipRecord {
  tenantId: string;
  workspaceId: string;
}

export interface CurrentWorkspaceMembershipLookupClient<
  TRecord extends CurrentWorkspaceMembershipRecord = CurrentWorkspaceMembershipRecord,
> {
  membership: {
    findFirst(args: {
      where: {
        userId: string;
        tenantId?: string;
        workspaceId?: string;
      };
      orderBy: Array<{ createdAt: "asc" | "desc" }>;
    }): Promise<TRecord | null>;
  };
}

export interface CreateCurrentWorkspaceApiKeyScopeResolverDependencies<
  TSession extends CurrentWorkspaceApiKeySessionLike = CurrentWorkspaceApiKeySessionLike,
  TRecord extends CurrentWorkspaceMembershipRecord = CurrentWorkspaceMembershipRecord,
> {
  membershipClient: CurrentWorkspaceMembershipLookupClient<TRecord>;
  sessionProvider: CurrentWorkspaceApiKeySessionProvider<TSession>;
}

export type CurrentWorkspaceApiKeyCreateInput = Omit<
  CreateApiKeyInput,
  keyof ApiKeyScope
>;

export type CurrentWorkspaceApiKeyLookupInput = Pick<
  ScopedApiKeyLookup,
  "apiKeyId"
>;

export type CurrentWorkspaceRotateApiKeyInput = Omit<
  RotateApiKeyInput,
  keyof ApiKeyScope
>;

export class MissingCurrentWorkspaceApiKeyScopeError extends Error {
  constructor() {
    super(
      "A current user workspace scope is required before persisting API keys.",
    );
    this.name = "MissingCurrentWorkspaceApiKeyScopeError";
  }
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalizedValue = value.trim();

  return normalizedValue.length === 0 ? null : normalizedValue;
}

function readSessionUserId(
  session: CurrentWorkspaceApiKeySessionLike,
): string | null {
  return (
    readNonEmptyString(session.userId) ?? readNonEmptyString(session.user?.id)
  );
}

function readSessionWorkspaceScope(
  session: CurrentWorkspaceApiKeySessionLike,
): Omit<ApiKeyScope, "userId"> | null {
  const tenantId =
    readNonEmptyString(session.tenantId) ??
    readNonEmptyString(session.workspace?.tenantId);
  const workspaceId =
    readNonEmptyString(session.workspaceId) ??
    readNonEmptyString(session.workspace?.workspaceId) ??
    readNonEmptyString(session.workspace?.id);

  if (tenantId === null || workspaceId === null) {
    return null;
  }

  return {
    tenantId,
    workspaceId,
  };
}

async function findMembershipForUser<
  TRecord extends CurrentWorkspaceMembershipRecord,
>(
  membershipClient: CurrentWorkspaceMembershipLookupClient<TRecord>,
  where: {
    userId: string;
    tenantId?: string;
    workspaceId?: string;
  },
): Promise<TRecord | null> {
  return membershipClient.membership.findFirst({
    where,
    orderBy: [{ createdAt: "desc" }],
  });
}

export function createCurrentWorkspaceApiKeyScopeResolver<
  TSession extends CurrentWorkspaceApiKeySessionLike,
  TRecord extends CurrentWorkspaceMembershipRecord,
>({
  membershipClient,
  sessionProvider,
}: CreateCurrentWorkspaceApiKeyScopeResolverDependencies<
  TSession,
  TRecord
>): CurrentWorkspaceApiKeyScopeResolver {
  return {
    async resolveCurrentWorkspaceApiKeyScope() {
      const session = await sessionProvider.getCurrentWorkspaceSession();

      if (session === null) {
        return null;
      }

      const userId = readSessionUserId(session);

      if (userId === null) {
        return null;
      }

      const sessionScope = readSessionWorkspaceScope(session);

      if (sessionScope !== null) {
        const membership = await findMembershipForUser(membershipClient, {
          userId,
          tenantId: sessionScope.tenantId,
          workspaceId: sessionScope.workspaceId,
        });

        if (membership === null) {
          return null;
        }

        return {
          userId,
          tenantId: membership.tenantId,
          workspaceId: membership.workspaceId,
        };
      }

      const membership = await findMembershipForUser(membershipClient, {
        userId,
      });

      if (membership === null) {
        return null;
      }

      return {
        userId,
        tenantId: membership.tenantId,
        workspaceId: membership.workspaceId,
      };
    },
  };
}

export async function requireCurrentWorkspaceApiKeyScope(
  resolver: CurrentWorkspaceApiKeyScopeResolver,
): Promise<ApiKeyScope> {
  const scope = await resolver.resolveCurrentWorkspaceApiKeyScope();

  if (scope === null) {
    throw new MissingCurrentWorkspaceApiKeyScopeError();
  }

  return scope;
}

export async function createCurrentWorkspaceApiKey<
  TRecord extends StoredApiKeyRecord,
>(
  client: ApiKeyPersistenceClient<TRecord>,
  resolver: CurrentWorkspaceApiKeyScopeResolver,
  input: CurrentWorkspaceApiKeyCreateInput,
  options: CreateApiKeyOptions = {},
): Promise<CreatedApiKeyResult> {
  const scope = await requireCurrentWorkspaceApiKeyScope(resolver);

  return createApiKey(
    client,
    {
      ...scope,
      ...input,
    },
    options,
  );
}

export async function fetchCurrentWorkspaceApiKey<
  TRecord extends StoredApiKeyRecord,
>(
  client: ApiKeyPersistenceClient<TRecord>,
  resolver: CurrentWorkspaceApiKeyScopeResolver,
  input: CurrentWorkspaceApiKeyLookupInput,
): Promise<ApiKeySafeRecord | null> {
  const scope = await requireCurrentWorkspaceApiKeyScope(resolver);

  return fetchApiKey(client, {
    ...scope,
    ...input,
  });
}

export async function listCurrentWorkspaceApiKeys<
  TRecord extends StoredApiKeyRecord,
>(
  client: ApiKeyPersistenceClient<TRecord>,
  resolver: CurrentWorkspaceApiKeyScopeResolver,
): Promise<ApiKeySafeRecord[]> {
  const scope = await requireCurrentWorkspaceApiKeyScope(resolver);

  return listApiKeys(client, scope);
}

export async function revokeCurrentWorkspaceApiKey<
  TRecord extends StoredApiKeyRecord,
>(
  client: ApiKeyPersistenceClient<TRecord>,
  resolver: CurrentWorkspaceApiKeyScopeResolver,
  input: CurrentWorkspaceApiKeyLookupInput,
  options: RevokeApiKeyOptions = {},
): Promise<ApiKeySafeRecord | null> {
  const scope = await requireCurrentWorkspaceApiKeyScope(resolver);

  return revokeApiKey(
    client,
    {
      ...scope,
      ...input,
    },
    options,
  );
}

export async function rotateCurrentWorkspaceApiKey<
  TRecord extends StoredApiKeyRecord,
>(
  client: ApiKeyPersistenceClient<TRecord>,
  resolver: CurrentWorkspaceApiKeyScopeResolver,
  input: CurrentWorkspaceRotateApiKeyInput,
  options: RotateApiKeyOptions = {},
): Promise<RotatedApiKeyResult | null> {
  const scope = await requireCurrentWorkspaceApiKeyScope(resolver);

  return rotateApiKey(
    client,
    {
      ...scope,
      ...input,
    },
    options,
  );
}
