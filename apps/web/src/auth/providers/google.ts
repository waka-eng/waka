import { getAuthEnv } from "../../env/auth.ts";

export interface GoogleProfile {
  sub?: string | null;
  email?: string | null;
  email_verified?: boolean | null;
  name?: string | null;
  picture?: string | null;
}

export interface GoogleUserClaims {
  id: string;
  email: string;
  emailVerified: true;
  name: string | null;
  image: string | null;
  googleSubject: string;
}

export interface GoogleUserModelPayload {
  googleSubject: string;
  email: string;
  name: string | null;
  image: string | null;
}

export interface GoogleProviderConfig {
  clientId: string;
  clientSecret: string;
  authorization: {
    params: {
      scope: string;
    };
  };
  profile: (profile: GoogleProfile) => GoogleUserClaims;
}

export const GOOGLE_IDENTITY_SCOPES = [
  "openid",
  "email",
  "profile",
] as const;

function readRequiredGoogleStringClaim(
  profile: GoogleProfile,
  key: "sub" | "email",
): string {
  const value = profile[key];

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Google profile is missing required claim: ${key}`);
  }

  return value.trim();
}

function normalizeOptionalGoogleStringClaim(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalizedValue = value.trim();

  return normalizedValue.length > 0 ? normalizedValue : null;
}

function mapGoogleProfileToNormalizedIdentity(
  profile: GoogleProfile,
): GoogleUserModelPayload {
  const googleSubject = readRequiredGoogleStringClaim(profile, "sub");
  const email = readRequiredGoogleStringClaim(profile, "email");

  if (profile.email_verified !== true) {
    throw new Error(
      "Google profile email must be verified before creating a user identity",
    );
  }

  return {
    email,
    name: normalizeOptionalGoogleStringClaim(profile.name),
    image: normalizeOptionalGoogleStringClaim(profile.picture),
    googleSubject,
  };
}

export function mapGoogleProfileToUserModelPayload(
  profile: GoogleProfile,
): GoogleUserModelPayload {
  return mapGoogleProfileToNormalizedIdentity(profile);
}

export function mapGoogleUserClaimsToUserModelPayload(
  claims: Pick<GoogleUserClaims, "googleSubject" | "email" | "name" | "image">,
): GoogleUserModelPayload {
  return {
    googleSubject: claims.googleSubject,
    email: claims.email,
    name: claims.name,
    image: claims.image,
  };
}

export function mapGoogleProfileToUserClaims(
  profile: GoogleProfile,
): GoogleUserClaims {
  const user = mapGoogleProfileToUserModelPayload(profile);

  return {
    id: user.googleSubject,
    email: user.email,
    emailVerified: true,
    name: user.name,
    image: user.image,
    googleSubject: user.googleSubject,
  };
}

export function getGoogleProviderConfig(
  env: NodeJS.ProcessEnv = process.env,
): GoogleProviderConfig {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = getAuthEnv(env);

  return {
    clientId: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    authorization: {
      params: {
        scope: GOOGLE_IDENTITY_SCOPES.join(" "),
      },
    },
    profile: mapGoogleProfileToUserClaims,
  };
}
