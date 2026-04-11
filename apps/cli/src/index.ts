#!/usr/bin/env node

import { pathToFileURL } from "node:url";

import {
  runCliAuthCommand,
  type CliAuthCommandOutput,
  type RunCliAuthCommandOptions,
} from "./commands/auth.ts";
import {
  runCliSaveCommand,
  type CreateCliInteractivePrompt,
  type CliReadableInput,
} from "./commands/save.ts";

export const WAKA_CLI_HELP = "Usage: waka-cli <auth|save>";

export interface ExecuteWakaCliOptions
  extends Pick<RunCliAuthCommandOptions, "createServer" | "env" | "openBrowser"> {
  createPrompt?: CreateCliInteractivePrompt;
  fetchImplementation?: typeof fetch;
  reflectionPollIntervalMs?: number;
  reflectionPollTimeoutMs?: number;
  reflectionPromptTimeoutMs?: number;
  sleep?: (delayMs: number) => Promise<void>;
  clearTimeoutImplementation?: typeof clearTimeout;
  setTimeoutImplementation?: typeof setTimeout;
  stderr?: CliAuthCommandOutput;
  stdin?: CliReadableInput;
  stdout?: CliAuthCommandOutput;
}

function writeLine(
  output: CliAuthCommandOutput | undefined,
  line: string,
): void {
  output?.write(`${line}\n`);
}

export async function executeWakaCli(
  argv: readonly string[] = process.argv.slice(2),
  options: ExecuteWakaCliOptions = {},
): Promise<number> {
  const [command] = argv;

  if (command === "auth") {
    await runCliAuthCommand({
      createServer: options.createServer,
      env: options.env,
      openBrowser: options.openBrowser,
      output: options.stdout,
    });

    return 0;
  }

  if (command === "save") {
    await runCliSaveCommand({
      args: argv.slice(1),
      createPrompt: options.createPrompt,
      env: options.env,
      fetchImplementation: options.fetchImplementation,
      input: options.stdin,
      output: options.stdout,
      reflectionPollIntervalMs: options.reflectionPollIntervalMs,
      reflectionPollTimeoutMs: options.reflectionPollTimeoutMs,
      reflectionPromptTimeoutMs: options.reflectionPromptTimeoutMs,
      sleep: options.sleep,
      clearTimeoutImplementation: options.clearTimeoutImplementation,
      setTimeoutImplementation: options.setTimeoutImplementation,
    });

    return 0;
  }

  if (command === undefined) {
    writeLine(options.stderr, WAKA_CLI_HELP);
    return 1;
  }

  writeLine(options.stderr, `Unknown command: ${command}`);
  writeLine(options.stderr, WAKA_CLI_HELP);

  return 1;
}

export async function main(): Promise<void> {
  try {
    process.exitCode = await executeWakaCli();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}

if (
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
