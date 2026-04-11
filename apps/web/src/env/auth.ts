export interface AuthEnv {
  NEXTAUTH_SECRET: string;
  NEXTAUTH_URL: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
}

function readRequiredEnv(
  env: NodeJS.ProcessEnv,
  key: keyof AuthEnv,
): string {
  const value = env[key];

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value;
}

export function getAuthEnv(env: NodeJS.ProcessEnv = process.env): AuthEnv {
  return {
    NEXTAUTH_SECRET: readRequiredEnv(env, "NEXTAUTH_SECRET"),
    NEXTAUTH_URL: readRequiredEnv(env, "NEXTAUTH_URL"),
    GOOGLE_CLIENT_ID: readRequiredEnv(env, "GOOGLE_CLIENT_ID"),
    GOOGLE_CLIENT_SECRET: readRequiredEnv(env, "GOOGLE_CLIENT_SECRET"),
  };
}
