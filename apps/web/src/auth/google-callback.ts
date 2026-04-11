import { DASHBOARD_SIGN_IN_PATH } from "./dashboard-redirect.ts";
import { applyResolvedUserIdToAuthUser } from "./auth-context.ts";
import {
  persistGoogleAccount,
  persistGoogleUser,
  type GoogleUserPersistenceClient,
} from "./google-user-persistence.ts";
import {
  mapGoogleProfileToUserClaims,
  mapGoogleUserClaimsToUserModelPayload,
  type GoogleUserClaims,
} from "./providers/google.ts";

export const GOOGLE_AUTH_CALLBACK_PATH = "/auth/callback/google";
export const GOOGLE_SIGN_IN_COMPLETION_PATH = "/api/auth/callback/google";
export const GOOGLE_CALLBACK_ERROR_PARAM = "error";
export const GOOGLE_CALLBACK_ERROR_DESCRIPTION_PARAM = "error_description";
export const GOOGLE_CALLBACK_CODE_PARAM = "code";
export const GOOGLE_CALLBACK_MISSING_CODE_ERROR = "missing_code";
export const GOOGLE_CALLBACK_MISSING_CODE_DESCRIPTION =
  "Google authorization callback did not include an authorization code.";
export const GOOGLE_OAUTH_TOKEN_ENDPOINT =
  "https://oauth2.googleapis.com/token";
export const GOOGLE_OAUTH_JWKS_ENDPOINT =
  "https://www.googleapis.com/oauth2/v3/certs";
export const GOOGLE_ID_TOKEN_ISSUERS = [
  "accounts.google.com",
  "https://accounts.google.com",
] as const;
const GOOGLE_ID_TOKEN_CLOCK_SKEW_SECONDS = 30;

export interface GoogleAuthorizationCallbackParams {
  code: string | null;
  error: string | null;
  errorDescription: string | null;
}

export interface GoogleOAuthTokenResponse {
  accessToken: string;
  expiresIn: number;
  idToken: string;
  refreshToken: string | null;
  scope: string | null;
  tokenType: string;
}

export interface GoogleIdentityTokenClaims {
  aud?: string | string[];
  azp?: string | null;
  email?: string | null;
  email_verified?: boolean | null;
  exp?: number;
  iat?: number;
  iss?: string | null;
  name?: string | null;
  nbf?: number;
  picture?: string | null;
  sub?: string | null;
}

export interface GoogleIdentityTokenHeader {
  alg?: string | null;
  kid?: string | null;
  typ?: string | null;
}

export interface VerifiedGoogleOAuthCallback {
  tokens: GoogleOAuthTokenResponse;
  claims: GoogleIdentityTokenClaims;
  user: GoogleUserClaims;
}

export interface ExchangeGoogleCallbackForTokensInput {
  clientId: string;
  clientSecret: string;
  code: string;
  codeVerifier?: string | null;
  fetch?: typeof fetch;
  now?: Date;
  redirectUri: string;
}

export interface VerifyGoogleIdentityClaimsInput {
  clientId: string;
  claims: GoogleIdentityTokenClaims;
  now?: Date;
}

export interface CompleteGoogleOAuthCallbackInput<TUserRecord = unknown> {
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  searchParams: URLSearchParams;
  userPersistenceClient?: GoogleUserPersistenceClient<TUserRecord>;
}

export interface GoogleOAuthCallbackCompletionResult {
  body:
    | {
        error: string;
        errorDescription: string;
      }
    | {
        provider: "google";
        user: GoogleUserClaims;
        claims: GoogleIdentityTokenClaims;
        tokens: {
          expiresIn: number;
          hasRefreshToken: boolean;
          scope: string | null;
          tokenType: string;
        };
      };
  status: number;
}

function normalizeCallbackParam(value: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalizedValue = value.trim();

  return normalizedValue.length > 0 ? normalizedValue : null;
}

function buildRedirectPath(
  pathname: string,
  searchParams: URLSearchParams,
): string {
  const search = searchParams.toString();

  return search.length > 0 ? `${pathname}?${search}` : pathname;
}

function readRequiredEnvValue(
  env: NodeJS.ProcessEnv,
  key: "NEXTAUTH_URL" | "GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET",
): string {
  const value = env[key];

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value.trim();
}

function readPersistedUserId(value: unknown): string {
  if (typeof value !== "object" || value === null) {
    throw new Error("Google user persistence did not return a persisted user id");
  }

  const record = value as {
    id?: unknown;
  };

  if (typeof record.id !== "string" || record.id.trim().length === 0) {
    throw new Error("Google user persistence did not return a persisted user id");
  }

  return record.id.trim();
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readRequiredString(
  value: unknown,
  field: string,
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Google token response is missing required field: ${field}`);
  }

  return value.trim();
}

function readOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalizedValue = value.trim();

  return normalizedValue.length > 0 ? normalizedValue : null;
}

function readRequiredPositiveInteger(
  value: unknown,
  field: string,
): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value <= 0
  ) {
    throw new Error(`Google token response is missing required field: ${field}`);
  }

  return value;
}

function decodeBase64UrlSegment(segment: string): string {
  const normalizedSegment = segment.replace(/-/g, "+").replace(/_/g, "/");
  const paddingLength = (4 - (normalizedSegment.length % 4)) % 4;

  return Buffer.from(
    `${normalizedSegment}${"=".repeat(paddingLength)}`,
    "base64",
  ).toString("utf8");
}

function decodeBase64UrlBytes(segment: string): Uint8Array {
  const normalizedSegment = segment.replace(/-/g, "+").replace(/_/g, "/");
  const paddingLength = (4 - (normalizedSegment.length % 4)) % 4;

  return Uint8Array.from(
    Buffer.from(
      `${normalizedSegment}${"=".repeat(paddingLength)}`,
      "base64",
    ),
  );
}

function parseJsonRecord(
  rawValue: string,
  errorMessage: string,
): Record<string, unknown> {
  try {
    const parsedValue: unknown = JSON.parse(rawValue);

    if (!isRecord(parsedValue)) {
      throw new Error(errorMessage);
    }

    return parsedValue;
  } catch (error) {
    if (error instanceof Error && error.message === errorMessage) {
      throw error;
    }

    throw new Error(errorMessage);
  }
}

function readGoogleTokenEndpointError(
  responseBody: Record<string, unknown>,
): string | null {
  const error = readOptionalString(responseBody.error);
  const errorDescription = readOptionalString(responseBody.error_description);

  if (error === null && errorDescription === null) {
    return null;
  }

  return [error, errorDescription].filter(Boolean).join(": ");
}

function normalizeAudience(
  aud: GoogleIdentityTokenClaims["aud"],
): string[] {
  if (typeof aud === "string" && aud.trim().length > 0) {
    return [aud.trim()];
  }

  if (Array.isArray(aud)) {
    return aud
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
  }

  return [];
}

function readRequiredTimestampClaim(
  value: unknown,
  field: "exp",
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value <= 0
  ) {
    throw new Error(`Google identity token is missing required claim: ${field}`);
  }

  return value;
}

function readOptionalTimestampClaim(
  value: unknown,
  field: "iat" | "nbf",
): number | null {
  if (typeof value === "undefined") {
    return null;
  }

  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value <= 0
  ) {
    throw new Error(`Google identity token has invalid claim: ${field}`);
  }

  return value;
}

export function readGoogleAuthorizationCallbackParams(
  searchParams: URLSearchParams,
): GoogleAuthorizationCallbackParams {
  return {
    code: normalizeCallbackParam(searchParams.get(GOOGLE_CALLBACK_CODE_PARAM)),
    error: normalizeCallbackParam(searchParams.get(GOOGLE_CALLBACK_ERROR_PARAM)),
    errorDescription: normalizeCallbackParam(
      searchParams.get(GOOGLE_CALLBACK_ERROR_DESCRIPTION_PARAM),
    ),
  };
}

export function hasSuccessfulGoogleAuthorization(
  params: GoogleAuthorizationCallbackParams,
): boolean {
  return params.error === null && params.code !== null;
}

export function getGoogleSignInCompletionPath(
  searchParams: URLSearchParams,
): string {
  return buildRedirectPath(
    GOOGLE_SIGN_IN_COMPLETION_PATH,
    new URLSearchParams(searchParams),
  );
}

export function getGoogleAuthorizationFailurePath(
  params: GoogleAuthorizationCallbackParams,
): string {
  const failureParams = new URLSearchParams();
  const error = params.error ?? GOOGLE_CALLBACK_MISSING_CODE_ERROR;

  failureParams.set(GOOGLE_CALLBACK_ERROR_PARAM, error);

  const errorDescription =
    params.errorDescription ?? GOOGLE_CALLBACK_MISSING_CODE_DESCRIPTION;

  failureParams.set(
    GOOGLE_CALLBACK_ERROR_DESCRIPTION_PARAM,
    errorDescription,
  );

  return buildRedirectPath(DASHBOARD_SIGN_IN_PATH, failureParams);
}

export function getGoogleCallbackRedirectPath(
  searchParams: URLSearchParams,
): string {
  const params = readGoogleAuthorizationCallbackParams(searchParams);

  if (hasSuccessfulGoogleAuthorization(params)) {
    return getGoogleSignInCompletionPath(searchParams);
  }

  return getGoogleAuthorizationFailurePath(params);
}

export function getGoogleAuthCallbackUrl(baseUrl: string): string {
  return new URL(GOOGLE_AUTH_CALLBACK_PATH, baseUrl).toString();
}

export function parseGoogleIdentityTokenClaims(
  idToken: string,
): GoogleIdentityTokenClaims {
  if (typeof idToken !== "string" || idToken.trim().length === 0) {
    throw new Error("Google token response is missing required field: id_token");
  }

  const segments = idToken.split(".");

  if (segments.length !== 3) {
    throw new Error("Google identity token has an invalid JWT format");
  }

  const payload = decodeBase64UrlSegment(segments[1]);
  const claims = parseJsonRecord(
    payload,
    "Google identity token payload must be a JSON object",
  );

  return claims as GoogleIdentityTokenClaims;
}

export function parseGoogleIdentityTokenHeader(
  idToken: string,
): GoogleIdentityTokenHeader {
  if (typeof idToken !== "string" || idToken.trim().length === 0) {
    throw new Error("Google token response is missing required field: id_token");
  }

  const segments = idToken.split(".");

  if (segments.length !== 3) {
    throw new Error("Google identity token has an invalid JWT format");
  }

  const header = decodeBase64UrlSegment(segments[0]);
  const parsedHeader = parseJsonRecord(
    header,
    "Google identity token header must be a JSON object",
  );

  return parsedHeader as GoogleIdentityTokenHeader;
}

export function verifyGoogleIdentityClaims({
  clientId,
  claims,
  now = new Date(),
}: VerifyGoogleIdentityClaimsInput): GoogleUserClaims {
  const issuer = readOptionalString(claims.iss);

  if (
    issuer === null ||
    !GOOGLE_ID_TOKEN_ISSUERS.some(
      (allowedIssuer) => allowedIssuer === issuer,
    )
  ) {
    throw new Error("Google identity token has an invalid issuer");
  }

  const audiences = normalizeAudience(claims.aud);

  if (!audiences.includes(clientId)) {
    throw new Error("Google identity token audience does not match the client");
  }

  const authorizedParty = readOptionalString(claims.azp);

  if (authorizedParty !== null && authorizedParty !== clientId) {
    throw new Error("Google identity token authorized party does not match the client");
  }

  const nowInSeconds = Math.floor(now.getTime() / 1000);
  const expiresAt = readRequiredTimestampClaim(claims.exp, "exp");

  if (nowInSeconds >= expiresAt + GOOGLE_ID_TOKEN_CLOCK_SKEW_SECONDS) {
    throw new Error("Google identity token has expired");
  }

  const issuedAt = readOptionalTimestampClaim(claims.iat, "iat");

  if (
    issuedAt !== null &&
    issuedAt > nowInSeconds + GOOGLE_ID_TOKEN_CLOCK_SKEW_SECONDS
  ) {
    throw new Error("Google identity token was issued in the future");
  }

  const notBefore = readOptionalTimestampClaim(claims.nbf, "nbf");

  if (
    notBefore !== null &&
    nowInSeconds + GOOGLE_ID_TOKEN_CLOCK_SKEW_SECONDS < notBefore
  ) {
    throw new Error("Google identity token is not active yet");
  }

  return mapGoogleProfileToUserClaims({
    sub: readOptionalString(claims.sub),
    email: readOptionalString(claims.email),
    email_verified: claims.email_verified ?? null,
    name: readOptionalString(claims.name),
    picture: readOptionalString(claims.picture),
  });
}

export async function verifyGoogleIdentityTokenSignature(
  idToken: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<void> {
  const header = parseGoogleIdentityTokenHeader(idToken);
  const algorithm = readOptionalString(header.alg);

  if (algorithm !== "RS256") {
    throw new Error("Google identity token uses an unsupported signing algorithm");
  }

  const keyId = readOptionalString(header.kid);

  if (keyId === null) {
    throw new Error("Google identity token is missing a signing key identifier");
  }

  const response = await fetchImplementation(GOOGLE_OAUTH_JWKS_ENDPOINT, {
    headers: {
      accept: "application/json",
    },
  });

  const rawBody = await response.text();
  const responseBody =
    rawBody.length > 0
      ? parseJsonRecord(rawBody, "Google JWKS endpoint returned invalid JSON")
      : {};

  if (!response.ok) {
    throw new Error(
      `Google JWKS fetch failed with status ${response.status}`,
    );
  }

  const jwkEntries = responseBody.keys;

  if (!Array.isArray(jwkEntries)) {
    throw new Error("Google JWKS endpoint did not return any signing keys");
  }

  const matchingKey = jwkEntries.find((value) => {
    if (!isRecord(value)) {
      return false;
    }

    return (
      readOptionalString(value.kid) === keyId &&
      readOptionalString(value.kty) === "RSA" &&
      readOptionalString(value.n) !== null &&
      readOptionalString(value.e) !== null
    );
  });

  if (!isRecord(matchingKey)) {
    throw new Error("Google JWKS response did not include the signing key for this token");
  }

  const modulus = readOptionalString(matchingKey.n);
  const exponent = readOptionalString(matchingKey.e);

  if (modulus === null || exponent === null) {
    throw new Error("Google signing key is missing required RSA parameters");
  }

  const importKey = crypto.subtle.importKey.bind(
    crypto.subtle,
  ) as typeof crypto.subtle.importKey;
  const verificationKey = await (importKey as any)(
    "jwk",
    {
      alg: "RS256",
      e: exponent,
      ext: true,
      key_ops: ["verify"],
      kid: keyId,
      kty: "RSA",
      n: modulus,
      use: "sig",
    } as JsonWebKey,
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
    },
    false,
    ["verify"],
  );

  const [encodedHeader, encodedPayload, encodedSignature] = idToken.split(".");
  const signatureBytes = decodeBase64UrlBytes(encodedSignature);
  const signatureBuffer = signatureBytes.buffer.slice(
    signatureBytes.byteOffset,
    signatureBytes.byteOffset + signatureBytes.byteLength,
  ) as ArrayBuffer;
  const verified = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    verificationKey,
    signatureBuffer,
    new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`),
  );

  if (!verified) {
    throw new Error("Google identity token signature verification failed");
  }
}

export async function exchangeGoogleCallbackForTokens({
  clientId,
  clientSecret,
  code,
  codeVerifier,
  fetch: fetchImplementation = fetch,
  redirectUri,
}: ExchangeGoogleCallbackForTokensInput): Promise<GoogleOAuthTokenResponse> {
  const requestBody = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });

  const normalizedCodeVerifier = readOptionalString(codeVerifier);

  if (normalizedCodeVerifier !== null) {
    requestBody.set("code_verifier", normalizedCodeVerifier);
  }

  const response = await fetchImplementation(GOOGLE_OAUTH_TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: requestBody.toString(),
  });

  const rawBody = await response.text();
  const responseBody =
    rawBody.length > 0
      ? parseJsonRecord(rawBody, "Google token endpoint returned invalid JSON")
      : {};

  if (!response.ok) {
    const endpointError = readGoogleTokenEndpointError(responseBody);
    const suffix = endpointError === null ? "" : `: ${endpointError}`;

    throw new Error(
      `Google token exchange failed with status ${response.status}${suffix}`,
    );
  }

  const tokenType = readRequiredString(responseBody.token_type, "token_type");

  if (tokenType.toLowerCase() !== "bearer") {
    throw new Error("Google token response returned an unsupported token type");
  }

  return {
    accessToken: readRequiredString(responseBody.access_token, "access_token"),
    expiresIn: readRequiredPositiveInteger(responseBody.expires_in, "expires_in"),
    idToken: readRequiredString(responseBody.id_token, "id_token"),
    refreshToken: readOptionalString(responseBody.refresh_token),
    scope: readOptionalString(responseBody.scope),
    tokenType,
  };
}

export async function exchangeGoogleCallbackForVerifiedIdentity(
  input: ExchangeGoogleCallbackForTokensInput,
): Promise<VerifiedGoogleOAuthCallback> {
  const tokens = await exchangeGoogleCallbackForTokens(input);
  await verifyGoogleIdentityTokenSignature(tokens.idToken, input.fetch);
  const claims = parseGoogleIdentityTokenClaims(tokens.idToken);
  const user = verifyGoogleIdentityClaims({
    clientId: input.clientId,
    claims,
    now: input.now,
  });

  return {
    tokens,
    claims,
    user,
  };
}

export async function completeGoogleOAuthCallback<TUserRecord = unknown>({
  env = process.env,
  fetch: fetchImplementation = fetch,
  searchParams,
  userPersistenceClient,
}: CompleteGoogleOAuthCallbackInput<TUserRecord>): Promise<GoogleOAuthCallbackCompletionResult> {
  const callbackParams = readGoogleAuthorizationCallbackParams(searchParams);

  if (!hasSuccessfulGoogleAuthorization(callbackParams)) {
    return {
      body: {
        error: callbackParams.error ?? GOOGLE_CALLBACK_MISSING_CODE_ERROR,
        errorDescription:
          callbackParams.errorDescription ??
          GOOGLE_CALLBACK_MISSING_CODE_DESCRIPTION,
      },
      status: 400,
    };
  }

  try {
    const authorizationCode = callbackParams.code as string;

    const nextAuthUrl = readRequiredEnvValue(env, "NEXTAUTH_URL");
    const googleClientId = readRequiredEnvValue(env, "GOOGLE_CLIENT_ID");
    const googleClientSecret = readRequiredEnvValue(env, "GOOGLE_CLIENT_SECRET");
    const verifiedCallback = await exchangeGoogleCallbackForVerifiedIdentity({
      clientId: googleClientId,
      clientSecret: googleClientSecret,
      code: authorizationCode,
      fetch: fetchImplementation,
      redirectUri: getGoogleAuthCallbackUrl(nextAuthUrl),
    });
    let resolvedUser = verifiedCallback.user;

    if (userPersistenceClient) {
      const persistedUser = await persistGoogleUser(
        userPersistenceClient,
        mapGoogleUserClaimsToUserModelPayload(verifiedCallback.user),
      );
      const persistedUserId = readPersistedUserId(persistedUser);

      resolvedUser = {
        ...verifiedCallback.user,
        id: persistedUserId,
      };

      await persistGoogleAccount(userPersistenceClient, {
        accessToken: verifiedCallback.tokens.accessToken,
        expiresAt:
          Math.floor(Date.now() / 1000) + verifiedCallback.tokens.expiresIn,
        idToken: verifiedCallback.tokens.idToken,
        provider: "google",
        providerAccountId: verifiedCallback.user.googleSubject,
        refreshToken: verifiedCallback.tokens.refreshToken,
        scope: verifiedCallback.tokens.scope,
        sessionState: null,
        tokenType: verifiedCallback.tokens.tokenType,
        type: "oauth",
        userId: persistedUserId,
      });
    }

    return {
      body: {
        provider: "google",
        user: resolvedUser,
        claims: verifiedCallback.claims,
        tokens: {
          expiresIn: verifiedCallback.tokens.expiresIn,
          scope: verifiedCallback.tokens.scope,
          tokenType: verifiedCallback.tokens.tokenType,
          hasRefreshToken: verifiedCallback.tokens.refreshToken !== null,
        },
      },
      status: 200,
    };
  } catch (error) {
    return {
      body: {
        error: "google_callback_exchange_failed",
        errorDescription:
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : "Google OAuth callback exchange failed unexpectedly.",
      },
      status: 502,
    };
  }
}
