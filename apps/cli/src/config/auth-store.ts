import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const WAKA_CLI_CONFIG_DIRECTORY_NAME = ".waka";
export const WAKA_CLI_CONFIG_FILE_NAME = "config.json";
export const WAKA_API_KEY_ENV_VAR = "WAKA_API_KEY";

export interface ResolveCliAuthStorePathOptions {
  env?: NodeJS.ProcessEnv;
  homeDirectory?: string;
}

export interface CliAuthConfig {
  apiKey: string;
}

export interface CliAuthTokenResolution {
  source: "config" | "env";
  token: string;
}

function normalizeToken(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalizedValue = value.trim();

  return normalizedValue.length > 0 ? normalizedValue : null;
}

function resolveCliHomeDirectory(
  options: ResolveCliAuthStorePathOptions,
): string {
  const overriddenHomeDirectory = normalizeToken(options.homeDirectory);

  if (overriddenHomeDirectory !== null) {
    return overriddenHomeDirectory;
  }

  const env = options.env ?? process.env;
  const envHomeDirectory =
    normalizeToken(env.HOME) ??
    normalizeToken(env.USERPROFILE) ??
    homedir().trim();

  if (envHomeDirectory.length === 0) {
    throw new Error("Unable to determine the Waka CLI home directory");
  }

  return envHomeDirectory;
}

function parseCliAuthConfig(
  rawConfig: string,
  configPath: string,
): CliAuthConfig {
  let parsedConfig: unknown;

  try {
    parsedConfig = JSON.parse(rawConfig);
  } catch (error) {
    throw new Error(
      `Waka CLI config at "${configPath}" contains invalid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (
    parsedConfig === null ||
    typeof parsedConfig !== "object" ||
    Array.isArray(parsedConfig)
  ) {
    throw new Error(`Waka CLI config at "${configPath}" must be a JSON object`);
  }

  const configRecord = parsedConfig as Record<string, unknown>;
  const apiKey =
    normalizeToken(
      typeof configRecord.apiKey === "string" ? configRecord.apiKey : null,
    ) ??
    normalizeToken(
      typeof configRecord.token === "string" ? configRecord.token : null,
    );

  if (apiKey === null) {
    throw new Error(
      `Waka CLI config at "${configPath}" must include a non-empty "apiKey"`,
    );
  }

  return { apiKey };
}

async function setPrivateConfigPermissions(
  configPath: string,
): Promise<void> {
  try {
    await chmod(configPath, 0o600);
  } catch (error) {
    const errorCode = (error as NodeJS.ErrnoException).code;

    if (errorCode === "ENOSYS" || errorCode === "EPERM") {
      return;
    }

    throw error;
  }
}

export function resolveCliAuthStorePath(
  options: ResolveCliAuthStorePathOptions = {},
): string {
  return join(
    resolveCliHomeDirectory(options),
    WAKA_CLI_CONFIG_DIRECTORY_NAME,
    WAKA_CLI_CONFIG_FILE_NAME,
  );
}

export async function persistCliAuthToken(
  token: string,
  options: ResolveCliAuthStorePathOptions = {},
): Promise<string> {
  const apiKey = normalizeToken(token);

  if (apiKey === null) {
    throw new Error("Waka CLI auth token must be a non-empty string");
  }

  const configPath = resolveCliAuthStorePath(options);

  await mkdir(dirname(configPath), {
    mode: 0o700,
    recursive: true,
  });
  await writeFile(
    configPath,
    `${JSON.stringify({ apiKey }, null, 2)}\n`,
    {
      encoding: "utf8",
      mode: 0o600,
    },
  );
  await setPrivateConfigPermissions(configPath);

  return configPath;
}

export async function readCliAuthConfig(
  options: ResolveCliAuthStorePathOptions = {},
): Promise<CliAuthConfig | null> {
  const configPath = resolveCliAuthStorePath(options);

  try {
    return parseCliAuthConfig(await readFile(configPath, "utf8"), configPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

export async function resolveCliAuthToken(
  options: ResolveCliAuthStorePathOptions = {},
): Promise<CliAuthTokenResolution | null> {
  const envApiKey = normalizeToken(
    (options.env ?? process.env)[WAKA_API_KEY_ENV_VAR],
  );

  try {
    const persistedConfig = await readCliAuthConfig(options);

    if (persistedConfig !== null) {
      return {
        source: "config",
        token: persistedConfig.apiKey,
      };
    }
  } catch (error) {
    if (envApiKey === null) {
      throw error;
    }

    return {
      source: "env",
      token: envApiKey,
    };
  }

  if (envApiKey === null) {
    return null;
  }

  return {
    source: "env",
    token: envApiKey,
  };
}
