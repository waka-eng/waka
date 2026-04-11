import type { GoogleUserModelPayload } from "./providers/google.ts";

export interface GoogleUserUpsertArgs {
  where: {
    googleSubject: string;
  };
  create: GoogleUserModelPayload;
  update: Pick<GoogleUserModelPayload, "email" | "name" | "image">;
}

export type GoogleUserFindUniqueArgs =
  | {
      where: {
        id: string;
      };
    }
  | {
      where: {
        googleSubject: string;
      };
    };

export interface GoogleAccountModelPayload {
  accessToken: string;
  expiresAt: number;
  idToken: string;
  provider: "google";
  providerAccountId: string;
  refreshToken: string | null;
  scope: string | null;
  sessionState: string | null;
  tokenType: string;
  type: "oauth";
  userId: string;
}

export interface GoogleAccountUpsertArgs {
  where: {
    provider: "google";
    providerAccountId: string;
  };
  create: GoogleAccountModelPayload;
  update: Pick<
    GoogleAccountModelPayload,
    | "accessToken"
    | "expiresAt"
    | "idToken"
    | "refreshToken"
    | "scope"
    | "sessionState"
    | "tokenType"
    | "type"
    | "userId"
  >;
}

export interface GoogleUserPersistenceClient<TUserRecord> {
  user: {
    findUnique?(args: GoogleUserFindUniqueArgs): Promise<TUserRecord | null>;
    upsert(args: GoogleUserUpsertArgs): Promise<TUserRecord>;
  };
  account?: {
    upsert(args: GoogleAccountUpsertArgs): Promise<unknown>;
  };
}

export function buildGoogleUserUpsertArgs(
  payload: GoogleUserModelPayload,
): GoogleUserUpsertArgs {
  return {
    where: {
      googleSubject: payload.googleSubject,
    },
    create: { ...payload },
    update: {
      email: payload.email,
      name: payload.name,
      image: payload.image,
    },
  };
}

export async function persistGoogleUser<TUserRecord>(
  client: GoogleUserPersistenceClient<TUserRecord>,
  payload: GoogleUserModelPayload,
): Promise<TUserRecord> {
  return client.user.upsert(buildGoogleUserUpsertArgs(payload));
}

export function buildGoogleAccountUpsertArgs(
  payload: GoogleAccountModelPayload,
): GoogleAccountUpsertArgs {
  return {
    where: {
      provider: payload.provider,
      providerAccountId: payload.providerAccountId,
    },
    create: { ...payload },
    update: {
      accessToken: payload.accessToken,
      expiresAt: payload.expiresAt,
      idToken: payload.idToken,
      refreshToken: payload.refreshToken,
      scope: payload.scope,
      sessionState: payload.sessionState,
      tokenType: payload.tokenType,
      type: payload.type,
      userId: payload.userId,
    },
  };
}

export async function persistGoogleAccount(
  client: GoogleUserPersistenceClient<unknown>,
  payload: GoogleAccountModelPayload,
): Promise<void> {
  if (!client.account) {
    return;
  }

  await client.account.upsert(buildGoogleAccountUpsertArgs(payload));
}
