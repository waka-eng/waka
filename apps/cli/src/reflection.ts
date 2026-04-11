import type { CliApiClient, CliReadInspirationResponse } from "./api-client.ts";
import type {
  CliReadableInput,
  CliWritableOutput,
  CreateCliInteractivePrompt,
} from "./interactive-prompt.ts";

export const CLI_REFLECTION_INPUT_PROMPT =
  "Reflection (optional, press Enter to skip): ";
export const CLI_REFLECTION_POLL_INTERVAL_MS = 1_000;
export const CLI_REFLECTION_POLL_TIMEOUT_MS = 15_000;
export const CLI_REFLECTION_PROMPT_TIMEOUT_MS = 60_000;

export type CliReflectionPromptResult =
  | {
      kind: "answered";
      answer: string;
    }
  | {
      kind: "skipped";
    }
  | {
      kind: "timed_out";
    };

export interface WaitForCliReflectionResolutionOptions {
  apiClient: Pick<CliApiClient, "readInspiration">;
  inspirationId: string;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
  sleep?: (delayMs: number) => Promise<void>;
}

export interface PromptCliReflectionQuestionOptions {
  createPrompt: CreateCliInteractivePrompt;
  input: CliReadableInput;
  output: CliWritableOutput;
  prompt: string;
  timeoutMs?: number;
  clearTimeoutImplementation?: typeof clearTimeout;
  setTimeoutImplementation?: typeof setTimeout;
}

export interface HandleCliPostSaveReflectionOptions
  extends WaitForCliReflectionResolutionOptions,
    Pick<
      PromptCliReflectionQuestionOptions,
      | "clearTimeoutImplementation"
      | "createPrompt"
      | "input"
      | "output"
      | "setTimeoutImplementation"
    > {
  promptTimeoutMs?: number;
}

function isReflectionResolved(
  inspiration: CliReadInspirationResponse,
): boolean {
  return (
    inspiration.reflectionStatus !== undefined &&
    inspiration.reflectionStatus !== "PENDING"
  );
}

function defaultSleep(
  delayMs: number,
): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

export async function waitForCliReflectionResolution(
  options: WaitForCliReflectionResolutionOptions,
): Promise<CliReadInspirationResponse | null> {
  const pollIntervalMs =
    options.pollIntervalMs ?? CLI_REFLECTION_POLL_INTERVAL_MS;
  const pollTimeoutMs =
    options.pollTimeoutMs ?? CLI_REFLECTION_POLL_TIMEOUT_MS;
  const sleep = options.sleep ?? defaultSleep;
  const startedAt = Date.now();

  while (Date.now() - startedAt <= pollTimeoutMs) {
    const inspiration = await options.apiClient.readInspiration(
      options.inspirationId,
    );

    if (isReflectionResolved(inspiration)) {
      return inspiration;
    }

    if (Date.now() - startedAt >= pollTimeoutMs) {
      break;
    }

    await sleep(pollIntervalMs);
  }

  return null;
}

export async function promptCliReflectionQuestion(
  options: PromptCliReflectionQuestionOptions,
): Promise<CliReflectionPromptResult> {
  const prompt = options.createPrompt({
    input: options.input,
    output: options.output,
  });
  const timeoutMs = options.timeoutMs ?? CLI_REFLECTION_PROMPT_TIMEOUT_MS;
  const setTimeoutImplementation =
    options.setTimeoutImplementation ?? setTimeout;
  const clearTimeoutImplementation =
    options.clearTimeoutImplementation ?? clearTimeout;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  options.output.write(`💭 ${options.prompt}\n`);

  const rawQuestionPromise = prompt.question(CLI_REFLECTION_INPUT_PROMPT);
  const questionPromise = rawQuestionPromise.then((answer) => ({
    answer,
    kind: "input" as const,
  }));

  try {
    const result = await Promise.race([
      questionPromise,
      new Promise<{ kind: "timeout" }>((resolve) => {
        timeoutId = setTimeoutImplementation(() => {
          resolve({
            kind: "timeout",
          });
        }, timeoutMs);
      }),
    ]);

    if (result.kind === "timeout") {
      options.output.write("\n");
      return {
        kind: "timed_out",
      };
    }

    const normalizedAnswer = result.answer.trim();

    if (normalizedAnswer.length === 0) {
      return {
        kind: "skipped",
      };
    }

    return {
      answer: normalizedAnswer,
      kind: "answered",
    };
  } finally {
    if (timeoutId !== undefined) {
      clearTimeoutImplementation(timeoutId);
    }

    await prompt.close();
    await rawQuestionPromise.catch(() => undefined);
  }
}

export async function handleCliPostSaveReflection(
  options: HandleCliPostSaveReflectionOptions,
): Promise<CliReflectionPromptResult | null> {
  if (options.input.isTTY !== true) {
    return null;
  }

  const inspiration = await waitForCliReflectionResolution(options);

  if (
    inspiration === null ||
    inspiration.reflectionStatus !== "PROMPTED" ||
    typeof inspiration.reflectionPrompt !== "string" ||
    inspiration.reflectionPrompt.length === 0
  ) {
    return null;
  }

  return promptCliReflectionQuestion({
    clearTimeoutImplementation: options.clearTimeoutImplementation,
    createPrompt: options.createPrompt,
    input: options.input,
    output: options.output,
    prompt: inspiration.reflectionPrompt,
    timeoutMs: options.promptTimeoutMs,
    setTimeoutImplementation: options.setTimeoutImplementation,
  });
}
