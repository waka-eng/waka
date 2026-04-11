import {
  createAuthCallbacks,
  type AuthCallbacks,
  type AuthCallbackSessionLike,
  type AuthCallbackTokenLike,
  type AuthCallbackUserLike,
  type CreateAuthCallbacksOptions,
} from "./auth/callbacks.ts";
import {
  getGoogleProviderConfig,
  type GoogleProviderConfig,
} from "./auth/providers/google.ts";

export interface WakaAuthConfig<
  TPersistedUserRecord,
  TSession extends AuthCallbackSessionLike = AuthCallbackSessionLike,
  TToken extends AuthCallbackTokenLike = AuthCallbackTokenLike,
  TUser extends AuthCallbackUserLike = AuthCallbackUserLike,
> {
  callbacks: AuthCallbacks<TPersistedUserRecord, TSession, TToken, TUser>;
  providers: [GoogleProviderConfig];
  session: {
    strategy: "jwt";
  };
}

export interface CreateWakaAuthConfigOptions<TPersistedUserRecord>
  extends CreateAuthCallbacksOptions<TPersistedUserRecord> {
  env?: NodeJS.ProcessEnv;
}

export function createWakaAuthConfig<
  TPersistedUserRecord,
  TSession extends AuthCallbackSessionLike = AuthCallbackSessionLike,
  TToken extends AuthCallbackTokenLike = AuthCallbackTokenLike,
  TUser extends AuthCallbackUserLike = AuthCallbackUserLike,
>({
  env,
  userPersistenceClient,
}: CreateWakaAuthConfigOptions<TPersistedUserRecord> = {}): WakaAuthConfig<
  TPersistedUserRecord,
  TSession,
  TToken,
  TUser
> {
  return {
    callbacks: createAuthCallbacks<
      TPersistedUserRecord,
      TSession,
      TToken,
      TUser
    >({
      userPersistenceClient,
    }),
    providers: [getGoogleProviderConfig(env)],
    session: {
      strategy: "jwt",
    },
  };
}

export type {
  AuthCallbackSessionLike,
  AuthCallbackTokenLike,
  AuthCallbackUserLike,
  CreateAuthCallbacksOptions,
};
