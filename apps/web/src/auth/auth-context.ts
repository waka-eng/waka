export interface AuthUserLike {
  id?: unknown;
  [key: string]: unknown;
}

export interface AuthTokenLike {
  sub?: unknown;
  userId?: unknown;
  [key: string]: unknown;
}

export interface AuthSessionUserLike {
  id?: unknown;
  [key: string]: unknown;
}

export interface AuthSessionLike {
  user?: AuthSessionUserLike | null;
  userId?: unknown;
  [key: string]: unknown;
}

export interface CarryResolvedUserIdThroughAuthFlowInput<
  TUser extends AuthUserLike,
  TToken extends AuthTokenLike,
  TSession extends AuthSessionLike,
> {
  resolvedUserId: string;
  session?: TSession | null;
  token?: TToken | null;
  user?: TUser | null;
}

function readResolvedUserId(
  value: string,
): string {
  const resolvedUserId = value.trim();

  if (resolvedUserId.length === 0) {
    throw new Error("Resolved auth user id must be a non-empty string");
  }

  return resolvedUserId;
}

export function applyResolvedUserIdToAuthUser<TUser extends AuthUserLike>(
  user: TUser,
  resolvedUserId: string,
): Omit<TUser, "id"> & {
  id: string;
} {
  return {
    ...user,
    id: readResolvedUserId(resolvedUserId),
  };
}

export function applyResolvedUserIdToAuthToken<TToken extends AuthTokenLike>(
  token: TToken,
  resolvedUserId: string,
): Omit<TToken, "sub" | "userId"> & {
  sub: string;
  userId: string;
} {
  const normalizedUserId = readResolvedUserId(resolvedUserId);

  return {
    ...token,
    sub: normalizedUserId,
    userId: normalizedUserId,
  };
}

export function applyResolvedUserIdToAuthSession<
  TSession extends AuthSessionLike,
>(
  session: TSession,
  resolvedUserId: string,
): Omit<TSession, "user" | "userId"> & {
  user: Omit<NonNullable<TSession["user"]>, "id"> & {
    id: string;
  };
  userId: string;
} {
  const normalizedUserId = readResolvedUserId(resolvedUserId);
  const sessionUser = (session.user ?? {}) as NonNullable<TSession["user"]>;
  const nextSession = {
    ...session,
    user: {
      ...sessionUser,
      id: normalizedUserId,
    },
    userId: normalizedUserId,
  };

  return nextSession as Omit<TSession, "user" | "userId"> & {
    user: Omit<NonNullable<TSession["user"]>, "id"> & {
      id: string;
    };
    userId: string;
  };
}

export function carryResolvedUserIdThroughAuthFlow<
  TUser extends AuthUserLike,
  TToken extends AuthTokenLike,
  TSession extends AuthSessionLike,
>({
  resolvedUserId,
  session,
  token,
  user,
}: CarryResolvedUserIdThroughAuthFlowInput<TUser, TToken, TSession>): {
  resolvedUserId: string;
  session: (Omit<TSession, "user" | "userId"> & {
    user: Omit<NonNullable<TSession["user"]>, "id"> & {
      id: string;
    };
    userId: string;
  }) | null;
  token: (Omit<TToken, "sub" | "userId"> & {
    sub: string;
    userId: string;
  }) | null;
  user: (Omit<TUser, "id"> & {
    id: string;
  }) | null;
} {
  const normalizedUserId = readResolvedUserId(resolvedUserId);

  return {
    resolvedUserId: normalizedUserId,
    session:
      session === null || session === undefined
        ? null
        : applyResolvedUserIdToAuthSession(session, normalizedUserId),
    token:
      token === null || token === undefined
        ? null
        : applyResolvedUserIdToAuthToken(token, normalizedUserId),
    user:
      user === null || user === undefined
        ? null
        : applyResolvedUserIdToAuthUser(user, normalizedUserId),
  };
}
