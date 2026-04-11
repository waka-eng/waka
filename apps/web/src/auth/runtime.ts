import { randomBytes } from "node:crypto";

import { cookies } from "next/headers.js";
import type { Prisma, User } from "@prisma/client";

import { authenticateApiKeyRequest, type ApiKeyAuthStore } from "./api-key.ts";
import {
  createCurrentWorkspaceApiKeyScopeResolver,
  type CurrentWorkspaceApiKeySessionLike,
  type CurrentWorkspaceMembershipLookupClient,
} from "./api-key-current-workspace.ts";
import type { LoadCurrentWorkspaceSettingsApiKeysDependencies } from "./api-key-settings-loader.ts";
import type {
  CreateApiKeyRouteDependencies,
} from "./api-key-create-route.ts";
import { createApiKeyPersistenceRepository } from "./api-key-persistence.ts";
import type {
  RevokeApiKeyRouteDependencies,
} from "./api-key-revoke-route.ts";
import type { CreateInspirationRouteDependencies } from "../inspirations/create-route.ts";
import type { DeleteInspirationRouteDependencies } from "../inspirations/delete-route.ts";
import type { ListInspirationsRouteDependencies } from "../inspirations/list-route.ts";
import type { ReadInspirationRouteDependencies } from "../inspirations/read-route.ts";
import type { UpdateInspirationRouteDependencies } from "../inspirations/update-route.ts";
import type {
  GoogleAccountUpsertArgs,
  GoogleUserFindUniqueArgs,
  GoogleUserPersistenceClient,
  GoogleUserUpsertArgs,
} from "./google-user-persistence.ts";
import type { GoogleUserClaims } from "./providers/google.ts";
import { getPrismaClient } from "../server/prisma.ts";

export const DEV_SIGN_IN_COOKIE_VALUE = "waka-dev-session";
export const CLI_AUTH_REDIRECT_URI_COOKIE_NAME = "waka-cli-redirect-uri";
export const DEFAULT_RUNTIME_WORKSPACE_SLUG = "personal";
export const DEFAULT_RUNTIME_WORKSPACE_NAME = "Personal";

const AUTH_SESSION_COOKIE_NAMES = [
  "__Secure-authjs.session-token",
  "authjs.session-token",
  "__Secure-next-auth.session-token",
  "next-auth.session-token",
] as const;
const DEV_RUNTIME_GOOGLE_SUBJECT = "waka-dev-localhost";
const DEV_RUNTIME_EMAIL = "dev@waka.local";
const DEV_RUNTIME_NAME = "Local Workspace";
const AUTH_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type CookieStoreLike = {
  get(name: string): { value: string } | undefined;
};

export interface RuntimeAuthenticatedSession
  extends CurrentWorkspaceApiKeySessionLike {
  source: "apiKey" | "db-session" | "dev-session";
  userId: string;
}

function normalizeNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalizedValue = value.trim();

  return normalizedValue.length > 0 ? normalizedValue : null;
}

function readAuthCookieFromHeader(
  cookieHeader: string | null | undefined,
): string | null {
  if (typeof cookieHeader !== "string" || cookieHeader.trim().length === 0) {
    return null;
  }

  for (const cookieEntry of cookieHeader.split(";")) {
    const [rawName, ...rawValueParts] = cookieEntry.split("=");
    const cookieName = rawName?.trim();

    if (cookieName === undefined || !AUTH_SESSION_COOKIE_NAMES.includes(cookieName as (typeof AUTH_SESSION_COOKIE_NAMES)[number])) {
      continue;
    }

    return decodeURIComponent(rawValueParts.join("=").trim());
  }

  return null;
}

function readAuthCookieFromStore(
  cookieStore: CookieStoreLike,
): string | null {
  for (const cookieName of AUTH_SESSION_COOKIE_NAMES) {
    const cookieValue = normalizeNonEmptyString(cookieStore.get(cookieName)?.value);

    if (cookieValue !== null) {
      return cookieValue;
    }
  }

  return null;
}

function buildWorkspaceIdentity(
  user: Pick<User, "email" | "id" | "name">,
): {
  tenantName: string;
  tenantSlug: string;
  workspaceName: string;
  workspaceSlug: string;
} {
  const displayName = normalizeNonEmptyString(user.name) ?? user.email;

  return {
    tenantName: displayName,
    tenantSlug: `user-${user.id}`,
    workspaceName: `${displayName}'s ${DEFAULT_RUNTIME_WORKSPACE_NAME}`,
    workspaceSlug: DEFAULT_RUNTIME_WORKSPACE_SLUG,
  };
}

export async function ensureDefaultWorkspaceForUser(
  user: Pick<User, "email" | "id" | "name">,
): Promise<{
  tenantId: string;
  workspaceId: string;
}> {
  const prismaClient = getPrismaClient();
  const existingMembership = await prismaClient.membership.findFirst({
    where: {
      userId: user.id,
    },
    orderBy: [{ createdAt: "desc" }],
  });

  if (existingMembership !== null) {
    return {
      tenantId: existingMembership.tenantId,
      workspaceId: existingMembership.workspaceId,
    };
  }

  const identity = buildWorkspaceIdentity(user);
  const tenant = await prismaClient.tenant.upsert({
    where: {
      slug: identity.tenantSlug,
    },
    update: {
      name: identity.tenantName,
    },
    create: {
      name: identity.tenantName,
      slug: identity.tenantSlug,
    },
  });
  const workspace = await prismaClient.workspace.upsert({
    where: {
      tenantId_slug: {
        tenantId: tenant.id,
        slug: identity.workspaceSlug,
      },
    },
    update: {
      name: identity.workspaceName,
    },
    create: {
      tenantId: tenant.id,
      slug: identity.workspaceSlug,
      name: identity.workspaceName,
    },
  });
  const membership = await prismaClient.membership.upsert({
    where: {
      workspaceId_userId: {
        workspaceId: workspace.id,
        userId: user.id,
      },
    },
    update: {
      tenantId: tenant.id,
    },
    create: {
      tenantId: tenant.id,
      workspaceId: workspace.id,
      userId: user.id,
    },
  });

  return {
    tenantId: membership.tenantId,
    workspaceId: membership.workspaceId,
  };
}

async function ensureDevRuntimeUser(): Promise<User> {
  const prismaClient = getPrismaClient();

  return prismaClient.user.upsert({
    where: {
      googleSubject: DEV_RUNTIME_GOOGLE_SUBJECT,
    },
    update: {
      email: DEV_RUNTIME_EMAIL,
      image: null,
      name: DEV_RUNTIME_NAME,
    },
    create: {
      googleSubject: DEV_RUNTIME_GOOGLE_SUBJECT,
      email: DEV_RUNTIME_EMAIL,
      image: null,
      name: DEV_RUNTIME_NAME,
    },
  });
}

async function resolveRuntimeSessionFromToken(
  sessionToken: string | null,
): Promise<RuntimeAuthenticatedSession | null> {
  if (sessionToken === null) {
    return null;
  }

  if (sessionToken === DEV_SIGN_IN_COOKIE_VALUE) {
    const devUser = await ensureDevRuntimeUser();
    const workspace = await ensureDefaultWorkspaceForUser(devUser);

    return {
      source: "dev-session",
      userId: devUser.id,
      ...workspace,
    };
  }

  const prismaClient = getPrismaClient();
  const persistedSession = await prismaClient.session.findUnique({
    where: {
      sessionToken,
    },
  });

  if (persistedSession === null || persistedSession.expires.getTime() <= Date.now()) {
    return null;
  }

  return {
    source: "db-session",
    userId: persistedSession.userId,
  };
}

function createPrismaMembershipLookupClient(): CurrentWorkspaceMembershipLookupClient {
  const prismaClient = getPrismaClient();

  return {
    membership: {
      async findFirst(args) {
        return prismaClient.membership.findFirst(args);
      },
    },
  };
}

function createPrismaApiKeyPersistenceClient() {
  const prismaClient = getPrismaClient();

  return createApiKeyPersistenceRepository(prismaClient);
}

function createPrismaApiKeyAuthStore(): ApiKeyAuthStore {
  const prismaClient = getPrismaClient();

  return {
    async findApiKeyByHashedKey(hashedKey) {
      return prismaClient.apiKey.findFirst({
        where: {
          hashedKey,
          revokedAt: null,
        },
        select: {
          id: true,
          revokedAt: true,
          userId: true,
        },
      });
    },
    async findInactiveApiKeyByHashedKey(hashedKey) {
      return prismaClient.apiKey.findFirst({
        where: {
          hashedKey,
          revokedAt: {
            not: null,
          },
        },
        select: {
          id: true,
          revokedAt: true,
          userId: true,
        },
      });
    },
    async markApiKeyUsed(apiKeyId, lastUsedAt) {
      await prismaClient.apiKey.update({
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

export function createPrismaGoogleUserPersistenceClient(): GoogleUserPersistenceClient<User> {
  const prismaClient = getPrismaClient();

  return {
    account: {
      async upsert(args: GoogleAccountUpsertArgs) {
        return prismaClient.account.upsert({
          where: {
            provider_providerAccountId: {
              provider: args.where.provider,
              providerAccountId: args.where.providerAccountId,
            },
          },
          create: {
            access_token: args.create.accessToken,
            expires_at: args.create.expiresAt,
            id_token: args.create.idToken,
            provider: args.create.provider,
            providerAccountId: args.create.providerAccountId,
            refresh_token: args.create.refreshToken,
            scope: args.create.scope,
            session_state: args.create.sessionState,
            token_type: args.create.tokenType,
            type: args.create.type,
            userId: args.create.userId,
          },
          update: {
            access_token: args.update.accessToken,
            expires_at: args.update.expiresAt,
            id_token: args.update.idToken,
            refresh_token: args.update.refreshToken,
            scope: args.update.scope,
            session_state: args.update.sessionState,
            token_type: args.update.tokenType,
            type: args.update.type,
            userId: args.update.userId,
          },
        });
      },
    },
    user: {
      async findUnique(args: GoogleUserFindUniqueArgs) {
        if ("id" in args.where) {
          return prismaClient.user.findUnique({
            where: {
              id: args.where.id,
            },
          });
        }

        return prismaClient.user.findUnique({
          where: {
            googleSubject: args.where.googleSubject,
          },
        });
      },
      async upsert(args: GoogleUserUpsertArgs) {
        return prismaClient.user.upsert({
          where: {
            googleSubject: args.where.googleSubject,
          },
          create: args.create,
          update: args.update,
        });
      },
    },
  };
}

export async function resolveRuntimeAuthenticatedSessionFromRequest(
  request: Request,
): Promise<RuntimeAuthenticatedSession | null> {
  const cookieSession = await resolveRuntimeSessionFromToken(
    readAuthCookieFromHeader(request.headers.get("cookie")),
  );

  if (cookieSession !== null) {
    return cookieSession;
  }

  const apiKeyAuthResult = await authenticateApiKeyRequest(
    request,
    createPrismaApiKeyAuthStore(),
  );

  if (!apiKeyAuthResult.ok) {
    return null;
  }

  return {
    source: "apiKey",
    userId: apiKeyAuthResult.apiKey.userId,
  };
}

export async function resolveRuntimeAuthenticatedSessionFromCookies():
Promise<RuntimeAuthenticatedSession | null> {
  const cookieStore = await cookies();

  return resolveRuntimeSessionFromToken(readAuthCookieFromStore(cookieStore));
}

function buildRouteSessionProvider(
  session: RuntimeAuthenticatedSession | null,
) {
  return {
    async getCurrentWorkspaceSession() {
      if (session === null) {
        return null;
      }

      return {
        tenantId: session.tenantId,
        userId: session.userId,
        workspaceId: session.workspaceId,
      };
    },
  };
}

function buildCurrentWorkspaceDependencies(
  session: RuntimeAuthenticatedSession | null,
) {
  return {
    apiKeyPersistenceClient: createPrismaApiKeyPersistenceClient(),
    currentWorkspaceScopeResolver: createCurrentWorkspaceApiKeyScopeResolver({
      membershipClient: createPrismaMembershipLookupClient(),
      sessionProvider: buildRouteSessionProvider(session),
    }),
  };
}

export async function createCreateApiKeyRouteDependenciesForRequest(
  request: Request,
): Promise<CreateApiKeyRouteDependencies> {
  const session = await resolveRuntimeAuthenticatedSessionFromRequest(request);

  return {
    apiKeyPersistenceClient: createPrismaApiKeyPersistenceClient(),
    membershipClient: createPrismaMembershipLookupClient(),
    sessionProvider: buildRouteSessionProvider(session),
  };
}

export async function createCreateApiKeyRouteDependenciesFromCookies():
Promise<CreateApiKeyRouteDependencies> {
  const session = await resolveRuntimeAuthenticatedSessionFromCookies();

  return {
    apiKeyPersistenceClient: createPrismaApiKeyPersistenceClient(),
    membershipClient: createPrismaMembershipLookupClient(),
    sessionProvider: buildRouteSessionProvider(session),
  };
}

export async function createRevokeApiKeyRouteDependenciesForRequest(
  request: Request,
): Promise<RevokeApiKeyRouteDependencies> {
  const session = await resolveRuntimeAuthenticatedSessionFromRequest(request);

  return {
    apiKeyPersistenceClient: createPrismaApiKeyPersistenceClient(),
    membershipClient: createPrismaMembershipLookupClient(),
    sessionProvider: buildRouteSessionProvider(session),
  };
}

export async function createRevokeApiKeyRouteDependenciesFromCookies():
Promise<RevokeApiKeyRouteDependencies> {
  const session = await resolveRuntimeAuthenticatedSessionFromCookies();

  return {
    apiKeyPersistenceClient: createPrismaApiKeyPersistenceClient(),
    membershipClient: createPrismaMembershipLookupClient(),
    sessionProvider: buildRouteSessionProvider(session),
  };
}

export async function createSettingsApiKeysDependenciesFromCookies():
Promise<LoadCurrentWorkspaceSettingsApiKeysDependencies<any>> {
  const session = await resolveRuntimeAuthenticatedSessionFromCookies();

  return buildCurrentWorkspaceDependencies(session);
}

export async function createPersistentAuthSession(
  userId: string,
): Promise<{
  expires: Date;
  sessionToken: string;
}> {
  const prismaClient = getPrismaClient();
  const sessionToken = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + AUTH_SESSION_TTL_MS);

  await prismaClient.session.create({
    data: {
      expires,
      sessionToken,
      userId,
    },
  });

  return {
    expires,
    sessionToken,
  };
}

export async function createRuntimeAuthSessionForUser(
  user: Pick<User, "email" | "id" | "name">,
): Promise<{
  expires: Date;
  sessionToken: string;
  tenantId: string;
  workspaceId: string;
}> {
  const workspace = await ensureDefaultWorkspaceForUser(user);
  const session = await createPersistentAuthSession(user.id);

  return {
    ...workspace,
    ...session,
  };
}

export function buildSessionCookieOptions(
  requestUrl: string,
  expires: Date,
): {
  expires: Date;
  httpOnly: true;
  name: string;
  path: "/";
  sameSite: "lax";
  secure: boolean;
} {
  const isSecure = new URL(requestUrl).protocol === "https:";

  return {
    expires,
    httpOnly: true,
    name: isSecure ? "__Secure-authjs.session-token" : "authjs.session-token",
    path: "/",
    sameSite: "lax",
    secure: isSecure,
  };
}

export function isValidCliRedirectUri(
  redirectUri: string,
): boolean {
  let parsedRedirectUri: URL;

  try {
    parsedRedirectUri = new URL(redirectUri);
  } catch {
    return false;
  }

  if (parsedRedirectUri.protocol !== "http:") {
    return false;
  }

  return (
    parsedRedirectUri.hostname === "localhost" ||
    parsedRedirectUri.hostname === "127.0.0.1" ||
    parsedRedirectUri.hostname === "0.0.0.0"
  );
}

export async function issueCliAuthApiKeyForUser(
  user: Pick<User, "email" | "id" | "name">,
): Promise<string> {
  const workspace = await ensureDefaultWorkspaceForUser(user);
  const scopeResolver = createCurrentWorkspaceApiKeyScopeResolver({
    membershipClient: createPrismaMembershipLookupClient(),
    sessionProvider: {
      async getCurrentWorkspaceSession() {
        return {
          tenantId: workspace.tenantId,
          userId: user.id,
          workspaceId: workspace.workspaceId,
        };
      },
    },
  });
  const { createCurrentWorkspaceApiKey } = await import(
    "./api-key-current-workspace.ts"
  );

  const result = await createCurrentWorkspaceApiKey(
    createPrismaApiKeyPersistenceClient(),
    scopeResolver,
    {
      description: "Created by Waka CLI auth",
      metadata: {
        surface: "cli",
      } as Prisma.JsonValue,
      name: "Waka CLI",
    },
  );

  return result.plainKey;
}

export function toRuntimeUserRecord(
  user: GoogleUserClaims | User,
): Pick<User, "email" | "id" | "name"> {
  return {
    email: user.email,
    id: user.id,
    name: user.name ?? null,
  };
}

function createRequestAuthResolver() {
  return {
    async resolveAuthenticatedUserId(request: Request) {
      return (await resolveRuntimeAuthenticatedSessionFromRequest(request))?.userId ?? null;
    },
  };
}

function scheduleInProcess(task: () => Promise<void>): void {
  void task();
}

const noopQueuePublisher = {
  async enqueue(): Promise<void> {
    return undefined;
  },
};

export async function createCreateInspirationRouteDependenciesForRequest(
  _request: Request,
): Promise<CreateInspirationRouteDependencies<any>> {
  const prismaClient = getPrismaClient();

  return {
    auth: createRequestAuthResolver(),
    backgroundScheduler: scheduleInProcess,
    enrichmentPipeline: prismaClient as any,
    persistence: prismaClient as any,
    queuePublisher: noopQueuePublisher,
  };
}

export async function createListInspirationsRouteDependenciesForRequest(
  _request: Request,
): Promise<ListInspirationsRouteDependencies<any>> {
  return {
    auth: createRequestAuthResolver(),
    persistence: getPrismaClient() as any,
  };
}

export async function createReadInspirationRouteDependenciesForRequest(
  _request: Request,
): Promise<ReadInspirationRouteDependencies<any>> {
  return {
    auth: createRequestAuthResolver(),
    persistence: getPrismaClient() as any,
  };
}

export async function createUpdateInspirationRouteDependenciesForRequest(
  _request: Request,
): Promise<UpdateInspirationRouteDependencies<any>> {
  const prismaClient = getPrismaClient();

  return {
    auth: createRequestAuthResolver(),
    backgroundScheduler: scheduleInProcess,
    enrichmentPipeline: prismaClient as any,
    persistence: prismaClient as any,
    queuePublisher: noopQueuePublisher,
  };
}

export async function createDeleteInspirationRouteDependenciesForRequest(
  _request: Request,
): Promise<DeleteInspirationRouteDependencies<any>> {
  return {
    auth: createRequestAuthResolver(),
    persistence: getPrismaClient() as any,
  };
}
