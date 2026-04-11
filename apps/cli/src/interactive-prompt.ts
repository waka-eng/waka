import { createInterface } from "node:readline/promises";

import type { CliAuthCommandOutput } from "./commands/auth.ts";

export interface CliReadableInput
  extends AsyncIterable<string | Buffer> {
  isTTY?: boolean;
  setEncoding?(encoding: BufferEncoding): void;
}

export interface CliWritableOutput extends CliAuthCommandOutput {}

export interface CliInteractivePrompt {
  close(): void | Promise<void>;
  question(prompt: string): Promise<string>;
}

export interface CreateCliInteractivePromptOptions {
  input: CliReadableInput;
  output: CliWritableOutput;
}

export type CreateCliInteractivePrompt = (
  options: CreateCliInteractivePromptOptions,
) => CliInteractivePrompt;

export function createCliInteractivePrompt(
  options: CreateCliInteractivePromptOptions,
): CliInteractivePrompt {
  const prompt = createInterface({
    input: options.input as NodeJS.ReadableStream,
    output: options.output as NodeJS.WritableStream,
    terminal: options.input.isTTY === true,
  });

  return {
    close() {
      prompt.close();
    },
    question(message) {
      return prompt.question(message);
    },
  };
}
