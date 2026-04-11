import { resolveCliAppUrl } from "./commands/auth.ts";
import { resolveCliAuthToken } from "./config/auth-store.ts";

export const CLI_INSPIRATIONS_API_PATH = "/api/inspirations";
export const CLI_API_UNAUTHENTICATED_ERROR =
  "Please run waka-cli auth first or set WAKA_API_KEY.";
export const CLI_SAVE_REQUEST_FAILED_ERROR = "Waka CLI save request failed.";

export type CliReflectionStatus =
  | "PENDING"
  | "PROMPTED"
  | "ANSWERED"
  | "SKIPPED"
  | "NOT_NEEDED";

export interface CreateCliApiClientOptions {
  env?: NodeJS.ProcessEnv;
  fetchImplementation?: typeof fetch;
}

export interface CliSaveInspirationInput {
  rawContent: string;
  sourceType: "CLI_CONVERSATION" | "URL_IMPORT";
  sourceUrl?: string;
}

export interface CliSaveInspirationResponse {
  id: string;
  processingState?: Record<string, unknown>;
  rawContent: string;
  sourceType: string;
}

export interface CliReadInspirationResponse {
  id: string;
  reflectionPrompt?: string;
  reflectionStatus?: CliReflectionStatus;
}

export interface CliApiClient {
  answerReflection(
    inspirationId: string,
    answer: string,
  ): Promise<void>;
  readInspiration(
    inspirationId: string,
  ): Promise<CliReadInspirationResponse>;
  saveInspiration(
    input: CliSaveInspirationInput,
  ): Promise<CliSaveInspirationResponse>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readCliApiErrorMessage(
  response: Response,
): Promise<string> {
  let parsedBody: unknown;

  try {
    parsedBody = await response.json();
  } catch {
    parsedBody = null;
  }

  if (isRecord(parsedBody) && typeof parsedBody.error === "string") {
    return parsedBody.error;
  }

  return `${CLI_SAVE_REQUEST_FAILED_ERROR} ${response.status} ${response.statusText}`.trim();
}

async function resolveCliApiToken(
  env: NodeJS.ProcessEnv,
): Promise<string> {
  const resolvedToken = await resolveCliAuthToken({ env });

  if (resolvedToken === null) {
    throw new Error(CLI_API_UNAUTHENTICATED_ERROR);
  }

  return resolvedToken.token;
}

function parseSaveInspirationResponse(
  payload: unknown,
): CliSaveInspirationResponse {
  if (!isRecord(payload)) {
    throw new Error("Waka CLI save response must be a JSON object.");
  }

  const id = typeof payload.id === "string" ? payload.id : null;
  const rawContent =
    typeof payload.rawContent === "string" ? payload.rawContent : null;
  const sourceType =
    typeof payload.sourceType === "string" ? payload.sourceType : null;
  const processingState = isRecord(payload.processingState)
    ? payload.processingState
    : undefined;

  if (id === null || rawContent === null || sourceType === null) {
    throw new Error("Waka CLI save response was missing required fields.");
  }

  return {
    id,
    ...(processingState === undefined ? {} : { processingState }),
    rawContent,
    sourceType,
  };
}

function parseReadInspirationResponse(
  payload: unknown,
): CliReadInspirationResponse {
  if (!isRecord(payload)) {
    throw new Error("Waka CLI read response must be a JSON object.");
  }

  const id = typeof payload.id === "string" ? payload.id : null;
  const reflectionPrompt =
    typeof payload.reflectionPrompt === "string"
      ? payload.reflectionPrompt
      : undefined;
  const reflectionStatus =
    typeof payload.reflectionStatus === "string" &&
    [
      "PENDING",
      "PROMPTED",
      "ANSWERED",
      "SKIPPED",
      "NOT_NEEDED",
    ].includes(payload.reflectionStatus)
      ? (payload.reflectionStatus as CliReflectionStatus)
      : undefined;

  if (id === null) {
    throw new Error("Waka CLI read response was missing required fields.");
  }

  return {
    id,
    ...(reflectionPrompt === undefined ? {} : { reflectionPrompt }),
    ...(reflectionStatus === undefined ? {} : { reflectionStatus }),
  };
}

export function createCliApiClient(
  options: CreateCliApiClientOptions = {},
): CliApiClient {
  const env = options.env ?? process.env;
  const fetchImplementation = options.fetchImplementation ?? globalThis.fetch;

  if (typeof fetchImplementation !== "function") {
    throw new Error("Fetch is not available in this Node.js runtime.");
  }

  return {
    async answerReflection(
      inspirationId: string,
      answer: string,
    ): Promise<void> {
      const token = await resolveCliApiToken(env);
      const requestUrl = new URL(
        `${CLI_INSPIRATIONS_API_PATH}/${encodeURIComponent(inspirationId)}`,
        resolveCliAppUrl(env),
      );
      const response = await fetchImplementation(requestUrl, {
        body: JSON.stringify({
          reflectionAnswer: answer,
        }),
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        method: "PUT",
      });

      if (!response.ok) {
        throw new Error(await readCliApiErrorMessage(response));
      }
    },
    async readInspiration(
      inspirationId: string,
    ): Promise<CliReadInspirationResponse> {
      const token = await resolveCliApiToken(env);
      const requestUrl = new URL(
        `${CLI_INSPIRATIONS_API_PATH}/${encodeURIComponent(inspirationId)}`,
        resolveCliAppUrl(env),
      );
      const response = await fetchImplementation(requestUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        method: "GET",
      });

      if (!response.ok) {
        throw new Error(await readCliApiErrorMessage(response));
      }

      return parseReadInspirationResponse(await response.json());
    },
    async saveInspiration(
      input: CliSaveInspirationInput,
    ): Promise<CliSaveInspirationResponse> {
      const token = await resolveCliApiToken(env);
      const requestUrl = new URL(
        CLI_INSPIRATIONS_API_PATH,
        resolveCliAppUrl(env),
      );
      const response = await fetchImplementation(requestUrl, {
        body: JSON.stringify(input),
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      });

      if (!response.ok) {
        throw new Error(await readCliApiErrorMessage(response));
      }

      return parseSaveInspirationResponse(await response.json());
    },
  };
}
