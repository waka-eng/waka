import {
  applyResolvedUserIdToAuthSession,
  applyResolvedUserIdToAuthToken,
  type AuthSessionLike,
  type AuthTokenLike,
  type AuthUserLike,
} from "./auth-context.ts";
import {
  persistGoogleUser,
  type GoogleUserPersistenceClient,
} from "./google-user-persistence.ts";
import {
  mapGoogleUserClaimsToUserModelPayload,
  type GoogleUserClaims,
} from "./providers/google.ts";

export interface AuthCallbackUserLike extends AuthUserLike {
  email?: unknown;
  googleSubject?: unknown;
  image?: unknown;
  name?: unknown;
  picture?: unknown;
}

export interface AuthCallbackTokenLike extends AuthTokenLike {
  email?: unknown;
  googleSubject?: unknown;
  id?: unknown;
  image?: unknown;
  name?: unknown;
  picture?: unknown;
}

export interface AuthCallbackSessionUserLike {
  email?: unknown;
  googleSubject?: unknown;
  id?: unknown;
  image?: unknown;
  name?: unknown;
  [key: string]: unknown;
}

export interface AuthCallbackSessionLike extends AuthSessionLike {
  user?: AuthCallbackSessionUserLike | null;
}

export interface AuthJwtCallbackParams<
  TToken extends AuthCallbackTokenLike,
  TUser extends AuthCallbackUserLike,
> {
  token: TToken;
  user?: TUser | null;
}

export interface AuthSessionCallbackParams<
  TSession extends AuthCallbackSessionLike,
  TToken extends AuthCallbackTokenLike,
> {
  session: TSession;
  token: TToken;
}

export interface CreateAuthCallbacksOptions<TPersistedUserRecord> {
  userPersistenceClient?: GoogleUserPersistenceClient<TPersistedUserRecord>;
}

export interface AuthCallbacks<
  TPersistedUserRecord,
  TSession extends AuthCallbackSessionLike = AuthCallbackSessionLike,
  TToken extends AuthCallbackTokenLike = AuthCallbackTokenLike,
  TUser extends AuthCallbackUserLike = AuthCallbackUserLike,
> {
  jwt(
    params: AuthJwtCallbackParams<TToken, TUser>,
  ): Promise<
    Omit<TToken, "sub" | "userId"> & {
      id: string;
      sub: string;
      userId: string;
    }
  >;
  session(
    params: AuthSessionCallbackParams<TSession, TToken>,
  ): Promise<
    Omit<TSession, "user" | "userId"> & {
      user: Omit<NonNullable<TSession["user"]>, "id"> & {
        id: string;
      };
      userId: string;
    }
  >;
}

interface PersistedAuthUserRecord {
  email: string;
  googleSubject: string;
  id: string;
  image: string | null;
  name: string | null;
}

function hasOwnProperty(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalizedValue = value.trim();

  return normalizedValue.length > 0 ? normalizedValue : null;
}

function readRequiredString(value: unknown, field: string): string {
  const normalizedValue = normalizeOptionalString(value);

  if (normalizedValue === null) {
    throw new Error(`Auth callback user is missing required field: ${field}`);
  }

  return normalizedValue;
}

function readPersistedUserId(value: unknown): string {
  if (typeof value !== "object" || value === null) {
    throw new Error("Auth callback could not resolve a persisted Neon user id");
  }

  const record = value as {
    id?: unknown;
  };

  return readRequiredString(record.id, "id");
}

function readPersistedAuthUserRecord(value: unknown): PersistedAuthUserRecord {
  if (typeof value !== "object" || value === null) {
    throw new Error("Auth callback could not read a persisted Neon user record");
  }

  const record = value as {
    email?: unknown;
    googleSubject?: unknown;
    id?: unknown;
    image?: unknown;
    name?: unknown;
  };

  return {
    email: readRequiredString(record.email, "email"),
    googleSubject: readRequiredString(record.googleSubject, "googleSubject"),
    id: readRequiredString(record.id, "id"),
    image: normalizeOptionalString(record.image),
    name: normalizeOptionalString(record.name),
  };
}

function normalizeAuthUser(
  user: AuthCallbackUserLike,
): GoogleUserClaims {
  const googleSubject =
    normalizeOptionalString(user.googleSubject) ??
    normalizeOptionalString(user.id);

  if (googleSubject === null) {
    throw new Error(
      "Auth callback user is missing required field: googleSubject",
    );
  }

  return {
    id: googleSubject,
    email: readRequiredString(user.email, "email"),
    emailVerified: true,
    googleSubject,
    image:
      normalizeOptionalString(user.image) ??
      normalizeOptionalString(user.picture),
    name: normalizeOptionalString(user.name),
  };
}

function mergeAuthUserIntoToken<TToken extends AuthCallbackTokenLike>(
  token: TToken,
  user: AuthCallbackUserLike,
): TToken {
  const normalizedUser = normalizeAuthUser(user);

  return {
    ...token,
    email: normalizedUser.email,
    googleSubject: normalizedUser.googleSubject,
    image: normalizedUser.image,
    name: normalizedUser.name,
    picture: normalizedUser.image,
  };
}

function mergeTokenIntoSession<TSession extends AuthCallbackSessionLike>(
  session: TSession,
  token: AuthCallbackTokenLike,
): TSession {
  const sessionUser = {
    ...(session.user ?? {}),
  };

  if (hasOwnProperty(token, "email")) {
    sessionUser.email = normalizeOptionalString(token.email);
  }

  if (hasOwnProperty(token, "name")) {
    sessionUser.name = normalizeOptionalString(token.name);
  }

  if (hasOwnProperty(token, "googleSubject")) {
    sessionUser.googleSubject = normalizeOptionalString(token.googleSubject);
  }

  if (hasOwnProperty(token, "picture") || hasOwnProperty(token, "image")) {
    sessionUser.image =
      normalizeOptionalString(token.picture) ??
      normalizeOptionalString(token.image);
  }

  return {
    ...session,
    user: sessionUser,
  };
}

function buildPersistedUserSessionToken(
  user: PersistedAuthUserRecord,
): AuthCallbackTokenLike {
  return {
    email: user.email,
    googleSubject: user.googleSubject,
    image: user.image,
    name: user.name,
    picture: user.image,
  };
}

function createPersistedUserLookupCandidates(
  token: AuthCallbackTokenLike,
): Array<{
  field: "googleSubject";
  value: string;
}> {
  const candidates: Array<{
    field: "googleSubject";
    value: string;
  }> = [];
  const seenCandidates = new Set<string>();

  function addCandidate(
    field: "googleSubject",
    value: unknown,
  ): void {
    const normalizedValue = normalizeOptionalString(value);

    if (normalizedValue === null) {
      return;
    }

    const candidateKey = `${field}:${normalizedValue}`;

    if (seenCandidates.has(candidateKey)) {
      return;
    }

    seenCandidates.add(candidateKey);
    candidates.push({
      field,
      value: normalizedValue,
    });
  }

  addCandidate("googleSubject", token.googleSubject);
  addCandidate("googleSubject", token.sub);
  addCandidate("googleSubject", token.id);
  addCandidate("googleSubject", token.userId);

  return candidates;
}

function shouldHydrateSessionFromPersistedUser(
  token: AuthCallbackTokenLike,
): boolean {
  return (
    normalizeOptionalString(token.userId) === null ||
    normalizeOptionalString(token.email) === null ||
    normalizeOptionalString(token.googleSubject) === null
  );
}

async function readPersistedUserForSessionToken<TPersistedUserRecord>(
  token: AuthCallbackTokenLike,
  userPersistenceClient?: GoogleUserPersistenceClient<TPersistedUserRecord>,
): Promise<PersistedAuthUserRecord | null> {
  if (
    userPersistenceClient === undefined ||
    userPersistenceClient.user.findUnique === undefined ||
    !shouldHydrateSessionFromPersistedUser(token)
  ) {
    return null;
  }

  for (const candidate of createPersistedUserLookupCandidates(token)) {
    const persistedUser = await userPersistenceClient.user.findUnique({
      where: {
        googleSubject: candidate.value,
      },
    });

    if (persistedUser !== null) {
      return readPersistedAuthUserRecord(persistedUser);
    }
  }

  return null;
}

export function createAuthJwtCallback<
  TPersistedUserRecord,
  TToken extends AuthCallbackTokenLike = AuthCallbackTokenLike,
  TUser extends AuthCallbackUserLike = AuthCallbackUserLike,
>({
  userPersistenceClient,
}: CreateAuthCallbacksOptions<TPersistedUserRecord> = {}): (
  params: AuthJwtCallbackParams<TToken, TUser>,
) => Promise<
  Omit<TToken, "sub" | "userId"> & {
    id: string;
    sub: string;
    userId: string;
  }
> {
  return async function jwt({
    token,
    user,
  }: AuthJwtCallbackParams<TToken, TUser>) {
    const resolvedToken =
      user === null || user === undefined
        ? token
        : mergeAuthUserIntoToken(token, user);

    const fallbackResolvedUserId =
      normalizeOptionalString(resolvedToken.userId) ??
      normalizeOptionalString(resolvedToken.sub) ??
      (user === null || user === undefined
        ? null
        : normalizeAuthUser(user).googleSubject);

    const persistedUserId =
      user === null || user === undefined || userPersistenceClient === undefined
        ? fallbackResolvedUserId
        : readPersistedUserId(
            await persistGoogleUser(
              userPersistenceClient,
              mapGoogleUserClaimsToUserModelPayload(normalizeAuthUser(user)),
            ),
          );

    if (persistedUserId === null) {
      throw new Error(
        "Auth callback could not resolve a Neon user id for token hydration",
      );
    }

    const normalizedToken = applyResolvedUserIdToAuthToken(
      resolvedToken,
      persistedUserId,
    );

    return {
      ...normalizedToken,
      id: persistedUserId,
    };
  };
}

export function createAuthSessionCallback<
  TPersistedUserRecord,
  TSession extends AuthCallbackSessionLike = AuthCallbackSessionLike,
  TToken extends AuthCallbackTokenLike = AuthCallbackTokenLike,
>({
  userPersistenceClient,
}: CreateAuthCallbacksOptions<TPersistedUserRecord> = {}): (
  params: AuthSessionCallbackParams<TSession, TToken>,
) => Promise<
  Omit<TSession, "user" | "userId"> & {
    user: Omit<NonNullable<TSession["user"]>, "id"> & {
      id: string;
    };
    userId: string;
  }
> {
  return async function session({
    session,
    token,
  }: AuthSessionCallbackParams<TSession, TToken>) {
    const persistedUser = await readPersistedUserForSessionToken(
      token,
      userPersistenceClient,
    );
    const hydratedSession = mergeTokenIntoSession(
      session,
      persistedUser === null
        ? token
        : {
            ...buildPersistedUserSessionToken(persistedUser),
            ...token,
          },
    );
    const resolvedUserId =
      normalizeOptionalString(token.userId) ??
      persistedUser?.id ??
      normalizeOptionalString(token.sub) ??
      normalizeOptionalString(token.id);

    if (resolvedUserId === null) {
      throw new Error(
        "Auth session callback could not resolve a Neon user id from the token",
      );
    }

    return applyResolvedUserIdToAuthSession(hydratedSession, resolvedUserId);
  };
}

export function createAuthCallbacks<
  TPersistedUserRecord,
  TSession extends AuthCallbackSessionLike = AuthCallbackSessionLike,
  TToken extends AuthCallbackTokenLike = AuthCallbackTokenLike,
  TUser extends AuthCallbackUserLike = AuthCallbackUserLike,
>(
  options: CreateAuthCallbacksOptions<TPersistedUserRecord> = {},
): AuthCallbacks<TPersistedUserRecord, TSession, TToken, TUser> {
  return {
    jwt: createAuthJwtCallback<TPersistedUserRecord, TToken, TUser>(options),
    session: createAuthSessionCallback<TPersistedUserRecord, TSession, TToken>(
      options,
    ),
  };
}
