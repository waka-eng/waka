import { readFile } from "node:fs/promises";

import {
  createCliApiClient,
  type CliSaveInspirationResponse,
} from "../api-client.ts";
import { resolveCliAppUrl } from "./auth.ts";
import {
  createCliInteractivePrompt,
  type CliInteractivePrompt,
  type CliReadableInput,
  type CliWritableOutput,
  type CreateCliInteractivePrompt,
  type CreateCliInteractivePromptOptions,
} from "../interactive-prompt.ts";
import { handleCliPostSaveReflection } from "../reflection.ts";

export const CLI_SAVE_EMPTY_STDIN_ERROR =
  "Piped input must include at least 1 character.";
export const CLI_SAVE_NO_INPUT_ERROR =
  "No piped input detected. Pipe text into waka-cli save.";
export const CLI_SAVE_EMPTY_PROMPT_ERROR =
  "Interactive input must include at least 1 character.";
export const CLI_SAVE_INTERACTIVE_PROMPT =
  "Type your thought: ";
export const CLI_SAVE_EMPTY_FILE_ERROR =
  "File input must include at least 1 character.";
export const CLI_SAVE_FILE_PATH_REQUIRED_ERROR =
  "The --file flag requires a path.";
export const CLI_SAVE_URL_REQUIRED_ERROR =
  "The --url flag requires an absolute URL.";
export const CLI_SAVE_URL_INVALID_ERROR =
  "The --url flag requires a valid absolute URL.";

export interface RunCliSaveCommandOptions {
  args?: readonly string[];
  createPrompt?: CreateCliInteractivePrompt;
  env?: NodeJS.ProcessEnv;
  fetchImplementation?: typeof fetch;
  input?: CliReadableInput;
  output?: CliWritableOutput;
  reflectionPollIntervalMs?: number;
  reflectionPollTimeoutMs?: number;
  reflectionPromptTimeoutMs?: number;
  sleep?: (delayMs: number) => Promise<void>;
  clearTimeoutImplementation?: typeof clearTimeout;
  setTimeoutImplementation?: typeof setTimeout;
}

interface ResolvedCliSaveContentInput {
  rawContent: string;
  sourceType: "CLI_CONVERSATION" | "URL_IMPORT";
  sourceUrl?: string;
}

export function canReadCliSaveInputFromStdin(
  input: CliReadableInput,
): boolean {
  return input.isTTY !== true;
}

export async function readCliSaveInputFromStdin(
  input: CliReadableInput,
): Promise<string> {
  input.setEncoding?.("utf8");

  let capturedInput = "";

  for await (const chunk of input) {
    capturedInput += typeof chunk === "string" ? chunk : chunk.toString("utf8");
  }

  if (capturedInput.length === 0) {
    throw new Error(CLI_SAVE_EMPTY_STDIN_ERROR);
  }

  return capturedInput;
}

export async function readCliSaveInputFromFile(
  filePath: string,
): Promise<string> {
  const capturedInput = await readFile(filePath, "utf8");

  if (capturedInput.length === 0) {
    throw new Error(CLI_SAVE_EMPTY_FILE_ERROR);
  }

  return capturedInput;
}

function resolveCliSaveFilePath(
  args: readonly string[] | undefined,
): string | null {
  if (args === undefined) {
    return null;
  }

  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== "--file") {
      continue;
    }

    const filePath = args[index + 1];

    if (typeof filePath !== "string" || filePath.length === 0) {
      throw new Error(CLI_SAVE_FILE_PATH_REQUIRED_ERROR);
    }

    return filePath;
  }

  return null;
}

function resolveCliSaveUrl(
  args: readonly string[] | undefined,
): string | null {
  if (args === undefined) {
    return null;
  }

  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== "--url") {
      continue;
    }

    const urlValue = args[index + 1];

    if (typeof urlValue !== "string" || urlValue.length === 0) {
      throw new Error(CLI_SAVE_URL_REQUIRED_ERROR);
    }

    try {
      return new URL(urlValue).toString();
    } catch {
      throw new Error(CLI_SAVE_URL_INVALID_ERROR);
    }
  }

  return null;
}

export async function readCliSaveInputInteractively(
  options: CreateCliInteractivePromptOptions & {
    createPrompt?: CreateCliInteractivePrompt;
  },
): Promise<string> {
  const promptFactory = options.createPrompt ?? createCliInteractivePrompt;
  const prompt = promptFactory({
    input: options.input,
    output: options.output,
  });

  try {
    const capturedInput = await prompt.question(CLI_SAVE_INTERACTIVE_PROMPT);

    if (capturedInput.length === 0) {
      throw new Error(CLI_SAVE_EMPTY_PROMPT_ERROR);
    }

    return capturedInput;
  } finally {
    await prompt.close();
  }
}

function buildSaveConfirmation(
  result: CliSaveInspirationResponse,
  env: NodeJS.ProcessEnv,
): string {
  const viewUrl = new URL(
    `/inspiration/${encodeURIComponent(result.id)}`,
    resolveCliAppUrl(env),
  ).toString();

  return `Saved inspiration ${result.id}\n  View: ${viewUrl}`;
}

async function resolveCliSaveInput(
  options: RunCliSaveCommandOptions,
): Promise<ResolvedCliSaveContentInput> {
  const sourceUrl = resolveCliSaveUrl(options.args);

  if (sourceUrl !== null) {
    return {
      rawContent: sourceUrl,
      sourceType: "URL_IMPORT",
      sourceUrl,
    };
  }

  const filePath = resolveCliSaveFilePath(options.args);

  if (filePath !== null) {
    return {
      rawContent: await readCliSaveInputFromFile(filePath),
      sourceType: "CLI_CONVERSATION",
    };
  }

  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;

  const rawContent = canReadCliSaveInputFromStdin(input)
    ? await readCliSaveInputFromStdin(input)
    : await readCliSaveInputInteractively({
        createPrompt: options.createPrompt,
        input,
        output,
      });

  return {
    rawContent,
    sourceType: "CLI_CONVERSATION",
  };
}

export async function runCliSaveCommand(
  options: RunCliSaveCommandOptions = {},
): Promise<CliSaveInspirationResponse> {
  const output = options.output ?? process.stdout;
  const input = options.input ?? process.stdin;
  const env = options.env ?? process.env;
  const saveInput = await resolveCliSaveInput(options);

  const apiClient = createCliApiClient({
    env,
    fetchImplementation: options.fetchImplementation,
  });
  const result = await apiClient.saveInspiration(saveInput);

  output.write(`${buildSaveConfirmation(result, env)}\n`);

  if (result.processingState !== undefined) {
    try {
      const reflectionResult = await handleCliPostSaveReflection({
        apiClient,
        clearTimeoutImplementation: options.clearTimeoutImplementation,
        createPrompt: options.createPrompt ?? createCliInteractivePrompt,
        input,
        inspirationId: result.id,
        output,
        pollIntervalMs: options.reflectionPollIntervalMs,
        pollTimeoutMs: options.reflectionPollTimeoutMs,
        promptTimeoutMs: options.reflectionPromptTimeoutMs,
        setTimeoutImplementation: options.setTimeoutImplementation,
        sleep: options.sleep,
      });

      if (reflectionResult?.kind === "answered") {
        await apiClient.answerReflection(result.id, reflectionResult.answer);
      }
    } catch {
      // Reflection is post-save and must never turn a successful capture into a failure.
    }
  }

  return result;
}

export type {
  CliInteractivePrompt,
  CliReadableInput,
  CliWritableOutput,
  CreateCliInteractivePrompt,
  CreateCliInteractivePromptOptions,
} from "../interactive-prompt.ts";
