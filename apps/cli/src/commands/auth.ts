import {
  createServer as createHttpServer,
} from "node:http";
import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";

import { persistCliAuthToken } from "../config/auth-store.ts";

export const CLI_AUTH_SIGN_IN_PATH = "/api/auth/signin/google";
export const CLI_AUTH_REDIRECT_URI_QUERY_KEY = "cli_redirect_uri";
export const CLI_AUTH_CALLBACK_TOKEN_QUERY_KEY = "token";
export const CLI_AUTH_CALLBACK_API_KEY_QUERY_KEY = "api_key";
export const CLI_AUTH_CALLBACK_LEGACY_API_KEY_QUERY_KEY = "apiKey";
export const CLI_AUTH_CALLBACK_PLAIN_KEY_QUERY_KEY = "plainKey";
export const CLI_AUTH_CALLBACK_ERROR_QUERY_KEY = "error";
export const CLI_AUTH_CALLBACK_ERROR_DESCRIPTION_QUERY_KEY = "error_description";
export const DEFAULT_CLI_APP_URL = "http://localhost:3000";
export const DEFAULT_CLI_AUTH_CALLBACK_HOST = "localhost";
export const DEFAULT_CLI_AUTH_CALLBACK_PATH = "/callback";
export const DEFAULT_CLI_AUTH_CALLBACK_PORT = 45_873;
export const CLI_AUTH_CALLBACK_MISSING_TOKEN_ERROR =
  "CLI auth callback did not include a usable token";
export const CLI_AUTH_CALLBACK_SUCCESS_MESSAGE =
  "Waka CLI authentication complete. You can return to the terminal.";

export interface CliAuthCommandResult {
  authUrl: string;
  configPath: string;
  redirectUri: string;
  token: string;
}

export interface CliAuthCommandOutput {
  write(chunk: string): void;
}

export interface BuildCliLocalhostRedirectUriOptions {
  host?: string;
  path?: string;
  port?: number;
}

export interface BrowserOpenInvocation {
  args: string[];
  command: string;
  options?: SpawnOptions;
}

export interface CliAuthCallbackResolution {
  queryKey:
    | typeof CLI_AUTH_CALLBACK_PLAIN_KEY_QUERY_KEY
    | typeof CLI_AUTH_CALLBACK_API_KEY_QUERY_KEY
    | typeof CLI_AUTH_CALLBACK_LEGACY_API_KEY_QUERY_KEY
    | typeof CLI_AUTH_CALLBACK_TOKEN_QUERY_KEY;
  token: string;
}

export interface CliAuthCallbackRequest {
  method?: string;
  url?: string;
}

export interface CliAuthCallbackResponse {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body: string): void;
}

export interface CliAuthCallbackServer {
  close(callback: (error?: Error | null) => void): void;
  listen(port: number, host: string): void;
  off(event: "error" | "listening", listener: (...args: unknown[]) => void): void;
  on(event: "error", listener: (error: Error) => void): void;
  once(event: "error", listener: (error: Error) => void): void;
  once(event: "listening", listener: () => void): void;
}

export type CreateCliAuthCallbackServer = (
  handler: (
    request: CliAuthCallbackRequest,
    response: CliAuthCallbackResponse,
  ) => void,
) => CliAuthCallbackServer;

export interface WaitForCliAuthCallbackOptions {
  createServer?: CreateCliAuthCallbackServer;
  redirectUri?: string;
  responseContentType?: string;
  successMessage?: string;
}

interface CliAuthCallbackListener {
  close(): Promise<void>;
  waitForResolution: Promise<CliAuthCallbackResolution>;
}

export interface RunCliAuthCommandOptions {
  createServer?: CreateCliAuthCallbackServer;
  env?: NodeJS.ProcessEnv;
  openBrowser?: (url: string) => Promise<void>;
  output?: CliAuthCommandOutput;
  redirectUri?: string;
}

export interface OpenUrlInBrowserOptions {
  platform?: NodeJS.Platform;
  spawn?: (
    command: string,
    args: readonly string[],
    options?: SpawnOptions,
  ) => ChildProcess;
}

function readConfiguredAppUrl(
  env: NodeJS.ProcessEnv,
): string {
  if (typeof env.APP_URL !== "string") {
    return DEFAULT_CLI_APP_URL;
  }

  const normalizedValue = env.APP_URL.trim();

  return normalizedValue.length > 0 ? normalizedValue : DEFAULT_CLI_APP_URL;
}

function normalizeQueryParam(
  value: string | null,
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalizedValue = value.trim();

  return normalizedValue.length > 0 ? normalizedValue : null;
}

function normalizeCallbackPath(pathname: string): string {
  const normalizedPath = pathname.trim();

  if (normalizedPath.length === 0) {
    throw new Error("CLI auth callback path must be a non-empty string");
  }

  return normalizedPath.startsWith("/") ? normalizedPath : `/${normalizedPath}`;
}

function normalizeCallbackPort(port: number): number {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("CLI auth callback port must be an integer between 1 and 65535");
  }

  return port;
}

function writeCallbackResponse(
  response: CliAuthCallbackResponse,
  body: string,
  statusCode: number,
  contentType = "text/plain; charset=utf-8",
): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", contentType);
  response.end(body);
}

function buildCliAuthCallbackErrorMessage(
  searchParams: URLSearchParams,
): string | null {
  const error = normalizeQueryParam(
    searchParams.get(CLI_AUTH_CALLBACK_ERROR_QUERY_KEY),
  );
  const errorDescription = normalizeQueryParam(
    searchParams.get(CLI_AUTH_CALLBACK_ERROR_DESCRIPTION_QUERY_KEY),
  );

  if (error === null && errorDescription === null) {
    return null;
  }

  if (error !== null && errorDescription !== null) {
    return `CLI auth callback failed: ${error}: ${errorDescription}`;
  }

  return `CLI auth callback failed: ${error ?? errorDescription}`;
}

function parseCliAuthCallbackRedirectUri(
  redirectUri: string,
): {
  host: string;
  origin: string;
  path: string;
  port: number;
} {
  let parsedRedirectUri: URL;

  try {
    parsedRedirectUri = new URL(redirectUri);
  } catch {
    throw new Error(`CLI auth redirect URI "${redirectUri}" must be a valid absolute URL`);
  }

  if (parsedRedirectUri.protocol !== "http:") {
    throw new Error(`CLI auth redirect URI "${redirectUri}" must use http`);
  }

  if (parsedRedirectUri.search.length > 0 || parsedRedirectUri.hash.length > 0) {
    throw new Error(
      `CLI auth redirect URI "${redirectUri}" must not include a query string or hash`,
    );
  }

  if (parsedRedirectUri.port.length === 0) {
    throw new Error(`CLI auth redirect URI "${redirectUri}" must include an explicit port`);
  }

  return {
    host: parsedRedirectUri.hostname,
    origin: parsedRedirectUri.origin,
    path: normalizeCallbackPath(parsedRedirectUri.pathname),
    port: normalizeCallbackPort(Number(parsedRedirectUri.port)),
  };
}

function closeHttpServer(
  server: CliAuthCallbackServer,
): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

export function resolveCliAppUrl(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const appUrl = readConfiguredAppUrl(env);

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

  return parsedUrl.origin;
}

export function buildCliLocalhostRedirectUri(
  options: BuildCliLocalhostRedirectUriOptions = {},
): string {
  const host = options.host?.trim() || DEFAULT_CLI_AUTH_CALLBACK_HOST;
  const port = normalizeCallbackPort(
    options.port ?? DEFAULT_CLI_AUTH_CALLBACK_PORT,
  );
  const path = normalizeCallbackPath(
    options.path ?? DEFAULT_CLI_AUTH_CALLBACK_PATH,
  );

  return new URL(path, `http://${host}:${port}`).toString();
}

export function buildCliAuthUrl(
  env: NodeJS.ProcessEnv = process.env,
  redirectUri = buildCliLocalhostRedirectUri(),
): string {
  const url = new URL(CLI_AUTH_SIGN_IN_PATH, resolveCliAppUrl(env));

  url.searchParams.set(CLI_AUTH_REDIRECT_URI_QUERY_KEY, redirectUri);

  return url.toString();
}

export function resolveCliAuthCallbackToken(
  searchParams: URLSearchParams,
): CliAuthCallbackResolution {
  const callbackErrorMessage = buildCliAuthCallbackErrorMessage(searchParams);

  if (callbackErrorMessage !== null) {
    throw new Error(callbackErrorMessage);
  }

  const tokenCandidates = [
    CLI_AUTH_CALLBACK_PLAIN_KEY_QUERY_KEY,
    CLI_AUTH_CALLBACK_API_KEY_QUERY_KEY,
    CLI_AUTH_CALLBACK_LEGACY_API_KEY_QUERY_KEY,
    CLI_AUTH_CALLBACK_TOKEN_QUERY_KEY,
  ] as const;

  for (const queryKey of tokenCandidates) {
    const token = normalizeQueryParam(searchParams.get(queryKey));

    if (token !== null) {
      return {
        queryKey,
        token,
      };
    }
  }

  throw new Error(CLI_AUTH_CALLBACK_MISSING_TOKEN_ERROR);
}

async function startCliAuthCallbackListener(
  options: WaitForCliAuthCallbackOptions = {},
): Promise<CliAuthCallbackListener> {
  const redirectUri = options.redirectUri ?? buildCliLocalhostRedirectUri();
  const callbackServerTarget = parseCliAuthCallbackRedirectUri(redirectUri);
  const successMessage = options.successMessage ?? CLI_AUTH_CALLBACK_SUCCESS_MESSAGE;
  const responseContentType =
    options.responseContentType ?? "text/plain; charset=utf-8";
  const createCallbackServer =
    options.createServer ??
    ((handler) =>
      createHttpServer((request, response) => handler(request, response)));

  let settled = false;

  let resolveResolution!: (value: CliAuthCallbackResolution) => void;
  let rejectResolution!: (reason?: unknown) => void;

  const waitForResolution = new Promise<CliAuthCallbackResolution>((resolve, reject) => {
    resolveResolution = resolve;
    rejectResolution = reject;
  });

  let closed = false;

  const closeListener = async (): Promise<void> => {
    if (closed) {
      return;
    }

    closed = true;
    server.off("error", handleServerError);
    await closeHttpServer(server).catch(() => {});
  };

  const handleServerError = (error: Error): void => {
    if (settled) {
      return;
    }

    settled = true;
    void closeListener();
    rejectResolution(error);
  };

  const server = createCallbackServer((request, response) => {
    const requestUrl =
      typeof request.url === "string"
        ? new URL(request.url, callbackServerTarget.origin)
        : null;

    if (request.method !== "GET") {
      writeCallbackResponse(
        response,
        "Waka CLI auth callback only accepts GET requests.",
        405,
        responseContentType,
      );
      return;
    }

    if (requestUrl === null || requestUrl.pathname !== callbackServerTarget.path) {
      writeCallbackResponse(
        response,
        "Waka CLI auth callback route was not found.",
        404,
        responseContentType,
      );
      return;
    }

    try {
      const resolution = resolveCliAuthCallbackToken(requestUrl.searchParams);

      writeCallbackResponse(
        response,
        successMessage,
        200,
        responseContentType,
      );

      if (!settled) {
        settled = true;
        void closeListener();
        resolveResolution(resolution);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      writeCallbackResponse(
        response,
        message,
        400,
        responseContentType,
      );

      if (!settled) {
        settled = true;
        void closeListener();
        rejectResolution(error);
      }
    }
  });

  await new Promise<void>((resolve, reject) => {
    const handleListenError = (error: Error): void => {
      server.off("listening", handleListening);
      reject(error);
    };

    const handleListening = (): void => {
      server.off("error", handleListenError);
      server.on("error", handleServerError);
      resolve();
    };

    server.once("error", handleListenError);
    server.once("listening", handleListening);
    server.listen(
      callbackServerTarget.port,
      callbackServerTarget.host,
    );
  });

  return {
    close: closeListener,
    waitForResolution,
  };
}

export async function waitForCliAuthCallback(
  options: WaitForCliAuthCallbackOptions = {},
): Promise<CliAuthCallbackResolution> {
  const listener = await startCliAuthCallbackListener(options);

  return await listener.waitForResolution;
}

export function createBrowserOpenInvocation(
  url: string,
  platform: NodeJS.Platform = process.platform,
): BrowserOpenInvocation {
  switch (platform) {
    case "darwin":
      return {
        command: "open",
        args: [url],
      };
    case "win32":
      return {
        command: "cmd",
        args: ["/c", "start", "", url],
        options: {
          windowsVerbatimArguments: false,
        },
      };
    default:
      return {
        command: "xdg-open",
        args: [url],
      };
  }
}

export async function openUrlInDefaultBrowser(
  url: string,
  options: OpenUrlInBrowserOptions = {},
): Promise<void> {
  const invocation = createBrowserOpenInvocation(
    url,
    options.platform,
  );
  const spawnProcess = options.spawn ?? spawn;

  await new Promise<void>((resolve, reject) => {
    const child = spawnProcess(invocation.command, invocation.args, {
      stdio: "ignore",
      ...invocation.options,
    });

    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

export async function runCliAuthCommand(
  options: RunCliAuthCommandOptions = {},
): Promise<CliAuthCommandResult> {
  const env = options.env ?? process.env;
  const redirectUri = options.redirectUri ?? buildCliLocalhostRedirectUri();
  const callbackListener = await startCliAuthCallbackListener({
    createServer: options.createServer,
    redirectUri,
  });
  const authUrl = buildCliAuthUrl(env, redirectUri);
  const openBrowser = options.openBrowser ?? openUrlInDefaultBrowser;

  try {
    await openBrowser(authUrl);
  } catch (error) {
    await callbackListener.close();
    throw error;
  }

  options.output?.write(`Opening browser for Waka authentication...\n${authUrl}\n`);
  const callbackResolution = await callbackListener.waitForResolution;
  const configPath = await persistCliAuthToken(callbackResolution.token, {
    env,
  });

  options.output?.write(
    `Waka authentication completed in the browser.\nSaved CLI API key to ${configPath}\n`,
  );

  return {
    authUrl,
    configPath,
    redirectUri,
    token: callbackResolution.token,
  };
}
