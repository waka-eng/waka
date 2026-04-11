export const WAKA_APP_NAME = "waka";
export const WAKA_APP_HOME = "aws";
export const DEFAULT_APP_STAGE = "dev";
export const DEFAULT_AWS_REGION = "us-east-1";
export const DEFAULT_APP_URL = "http://localhost:3000";
export const DEFAULT_LOCAL_DEV_BIND_HOST = "0.0.0.0";
export const DEFAULT_LOCAL_DEV_PORT = 3000;
export const PRODUCTION_STAGE = "production";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export interface WakaSstAppConfig {
  name: typeof WAKA_APP_NAME;
  home: typeof WAKA_APP_HOME;
  stage: string;
  region: string;
  appUrl: string;
  localDevUrl: string;
  localDevHost: string;
  localDevPort: number;
  removal: "retain" | "remove";
}

function readTrimmedString(
  value: string | undefined,
  field: string,
): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmedValue = value.trim();

  if (trimmedValue.length === 0) {
    throw new Error(`${field} must be a non-empty string when provided`);
  }

  return trimmedValue;
}

export function resolveAppStage(inputStage?: string): string {
  const stage = readTrimmedString(inputStage, "SST stage");

  if (stage === undefined) {
    return DEFAULT_APP_STAGE;
  }

  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(stage)) {
    throw new Error(
      `SST stage "${stage}" must contain only letters, numbers, and hyphens`,
    );
  }

  return stage;
}

export function resolveAwsRegion(env: NodeJS.ProcessEnv = process.env): string {
  const region = readTrimmedString(env.AWS_REGION, "AWS_REGION");

  if (region === undefined) {
    return DEFAULT_AWS_REGION;
  }

  if (!/^[a-z]{2}(?:-gov)?-[a-z0-9-]+-\d$/i.test(region)) {
    throw new Error(`AWS_REGION "${region}" is not a valid AWS region`);
  }

  return region;
}

export function resolveAppUrl(
  env: NodeJS.ProcessEnv = process.env,
  stage = DEFAULT_APP_STAGE,
): string {
  const configuredUrl = readTrimmedString(env.APP_URL, "APP_URL");
  const appUrl = configuredUrl ?? DEFAULT_APP_URL;

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(appUrl);
  } catch {
    throw new Error(`APP_URL "${appUrl}" must be a valid absolute URL`);
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error(`APP_URL "${appUrl}" must use http or https`);
  }

  if (parsedUrl.pathname !== "/" || parsedUrl.search.length > 0 || parsedUrl.hash.length > 0) {
    throw new Error(
      `APP_URL "${appUrl}" must be an origin without a path, query, or hash`,
    );
  }

  if (stage === PRODUCTION_STAGE && parsedUrl.protocol !== "https:") {
    throw new Error("APP_URL must use https for the production stage");
  }

  return parsedUrl.origin;
}

function formatOrigin(protocol: string, hostname: string, port: number): string {
  const defaultPort = protocol === "https:" ? 443 : 80;
  const normalizedPort = port === defaultPort ? "" : `:${port}`;

  return `${protocol}//${hostname}${normalizedPort}`;
}

function resolveValidatedPort(
  value: string | undefined,
  field: string,
): number | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmedValue = value.trim();

  if (trimmedValue.length === 0) {
    return undefined;
  }

  if (!/^\d+$/u.test(trimmedValue)) {
    throw new Error(`${field} must be an integer between 1 and 65535`);
  }

  const port = Number.parseInt(trimmedValue, 10);

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${field} must be an integer between 1 and 65535`);
  }

  return port;
}

export function resolveLocalDevPort(
  env: NodeJS.ProcessEnv = process.env,
  stage = DEFAULT_APP_STAGE,
): number {
  const configuredPort = resolveValidatedPort(env.PORT, "PORT");

  if (configuredPort !== undefined) {
    return configuredPort;
  }

  const parsedAppUrl = new URL(resolveAppUrl(env, stage));
  const urlPort = resolveValidatedPort(parsedAppUrl.port, "APP_URL port");

  if (urlPort !== undefined) {
    return urlPort;
  }

  return parsedAppUrl.protocol === "https:" ? 443 : DEFAULT_LOCAL_DEV_PORT;
}

export function resolveLocalDevHost(
  env: NodeJS.ProcessEnv = process.env,
  stage = DEFAULT_APP_STAGE,
): string {
  const configuredHost = readTrimmedString(env.HOST, "HOST");

  if (configuredHost !== undefined) {
    return configuredHost;
  }

  const parsedAppUrl = new URL(resolveAppUrl(env, stage));

  return LOOPBACK_HOSTS.has(parsedAppUrl.hostname)
    ? DEFAULT_LOCAL_DEV_BIND_HOST
    : parsedAppUrl.hostname;
}

export function resolveLocalDevUrl(
  env: NodeJS.ProcessEnv = process.env,
  stage = DEFAULT_APP_STAGE,
): string {
  const parsedAppUrl = new URL(resolveAppUrl(env, stage));
  const port = resolveLocalDevPort(env, stage);

  return formatOrigin(parsedAppUrl.protocol, parsedAppUrl.hostname, port);
}

export function resolveWakaSstAppConfig(
  env: NodeJS.ProcessEnv = process.env,
  inputStage?: string,
): WakaSstAppConfig {
  const stage = resolveAppStage(inputStage);

  return {
    name: WAKA_APP_NAME,
    home: WAKA_APP_HOME,
    stage,
    region: resolveAwsRegion(env),
    appUrl: resolveAppUrl(env, stage),
    localDevUrl: resolveLocalDevUrl(env, stage),
    localDevHost: resolveLocalDevHost(env, stage),
    localDevPort: resolveLocalDevPort(env, stage),
    removal: stage === PRODUCTION_STAGE ? "retain" : "remove",
  };
}
