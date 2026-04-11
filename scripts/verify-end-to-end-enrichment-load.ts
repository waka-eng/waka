import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type {
  EndToEndEnrichmentLoadLatencyReport,
  EndToEndEnrichmentLoadRunReport,
  EndToEndEnrichmentLoadRunResult,
  ExpectedEnrichmentLoadMissingRequiredRequestFieldDiagnostic,
} from "../tests/helpers/end-to-end-enrichment-load-fixture.ts";
import {
  EndToEndEnrichmentLoadLatencyReportError as EndToEndEnrichmentLoadLatencyReportErrorClass,
  ExpectedEnrichmentLoadMissingRequiredRequestFieldsError,
  runEndToEndEnrichmentLoadFixture,
} from "../tests/helpers/end-to-end-enrichment-load-fixture.ts";
import type {
  ExpectedEnrichmentLoadFixture,
  ExpectedEnrichmentLoadFixtureOptions,
} from "../tests/helpers/expected-enrichment-load-fixture.ts";
import { createExpectedEnrichmentLoadFixture } from "../tests/helpers/expected-enrichment-load-fixture.ts";

export const END_TO_END_EXPECTED_LOAD_VERIFICATION_SCENARIO =
  "end_to_end_expected_load";

export interface VerifyEndToEndEnrichmentLoadCliOptions
  extends ExpectedEnrichmentLoadFixtureOptions {
  outputPath?: string;
}

export type EndToEndEnrichmentLoadVerificationErrorDetails =
  | ({
      kind: "missing_required_request_fields";
    } & ExpectedEnrichmentLoadMissingRequiredRequestFieldDiagnostic);

export interface EndToEndEnrichmentLoadVerificationOutput {
  error: {
    details?: EndToEndEnrichmentLoadVerificationErrorDetails;
    message: string;
    stack?: string;
  } | null;
  fixture: {
    options: ExpectedEnrichmentLoadFixture["options"];
    summary: ExpectedEnrichmentLoadFixture["summary"];
  } | null;
  generatedAt: string;
  message: string;
  passed: boolean;
  requestedOptions: {
    captureVolume?: number;
    outputPath?: string;
    userId?: string;
  };
  scenario: typeof END_TO_END_EXPECTED_LOAD_VERIFICATION_SCENARIO;
  status: "PASS" | "FAIL";
  verification: {
    latencyReport: EndToEndEnrichmentLoadLatencyReport | null;
    runReport: EndToEndEnrichmentLoadRunReport | null;
  };
}

interface VerifyEndToEndEnrichmentLoadIo {
  stderr: Pick<NodeJS.WriteStream, "write">;
  stdout: Pick<NodeJS.WriteStream, "write">;
}

function parsePositiveInteger(value: string, flagName: string): number {
  const parsedValue = Number(value);

  if (!Number.isInteger(parsedValue) || parsedValue < 1) {
    throw new RangeError(`${flagName} must be a positive integer.`);
  }

  return parsedValue;
}

function serializeVerificationOutput(
  output: EndToEndEnrichmentLoadVerificationOutput,
): string {
  return `${JSON.stringify(output, null, 2)}\n`;
}

function normalizeErrorDetails(
  error: unknown,
): EndToEndEnrichmentLoadVerificationErrorDetails | undefined {
  if (error instanceof ExpectedEnrichmentLoadMissingRequiredRequestFieldsError) {
    return {
      kind: "missing_required_request_fields",
      ...error.diagnostic,
    };
  }

  return undefined;
}

function normalizeError(error: unknown): {
  details?: EndToEndEnrichmentLoadVerificationErrorDetails;
  message: string;
  stack?: string;
} {
  const details = normalizeErrorDetails(error);

  if (error instanceof Error) {
    return {
      ...(details === undefined ? {} : { details }),
      message: error.message,
      ...(typeof error.stack === "string" && error.stack.length > 0
        ? {
            stack: error.stack,
          }
        : {}),
    };
  }

  return {
    ...(details === undefined ? {} : { details }),
    message: typeof error === "string" ? error : "Unknown verification failure.",
  };
}

function extractVerificationFailureArtifacts(
  error: unknown,
): EndToEndEnrichmentLoadVerificationOutput["verification"] {
  if (error instanceof EndToEndEnrichmentLoadLatencyReportErrorClass) {
    return {
      latencyReport: error.latencyReport,
      runReport: error.runReport,
    };
  }

  return {
    latencyReport: null,
    runReport: null,
  };
}

function buildFixtureSummary(
  fixture: ExpectedEnrichmentLoadFixture | null,
): EndToEndEnrichmentLoadVerificationOutput["fixture"] {
  if (!fixture) {
    return null;
  }

  return {
    options: fixture.options,
    summary: fixture.summary,
  };
}

function buildRequestedOptions(
  options: VerifyEndToEndEnrichmentLoadCliOptions,
): EndToEndEnrichmentLoadVerificationOutput["requestedOptions"] {
  return {
    ...(options.captureVolume === undefined
      ? {}
      : {
          captureVolume: options.captureVolume,
        }),
    ...(options.outputPath === undefined
      ? {}
      : {
          outputPath: options.outputPath,
        }),
    ...(options.userId === undefined
      ? {}
      : {
          userId: options.userId,
        }),
  };
}

export function parseVerifyEndToEndEnrichmentLoadArgs(
  argv: readonly string[],
): VerifyEndToEndEnrichmentLoadCliOptions {
  const options: VerifyEndToEndEnrichmentLoadCliOptions = {};

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (!argument) {
      continue;
    }

    if (argument === "--") {
      continue;
    }

    if (argument === "--capture-volume") {
      const value = argv[index + 1];

      if (!value) {
        throw new Error("--capture-volume requires a value.");
      }

      options.captureVolume = parsePositiveInteger(value, "captureVolume");
      index += 1;
      continue;
    }

    if (argument.startsWith("--capture-volume=")) {
      options.captureVolume = parsePositiveInteger(
        argument.slice("--capture-volume=".length),
        "captureVolume",
      );
      continue;
    }

    if (argument === "--user-id") {
      const value = argv[index + 1];

      if (!value) {
        throw new Error("--user-id requires a value.");
      }

      options.userId = value;
      index += 1;
      continue;
    }

    if (argument.startsWith("--user-id=")) {
      options.userId = argument.slice("--user-id=".length);
      continue;
    }

    if (argument === "--output") {
      const value = argv[index + 1];

      if (!value) {
        throw new Error("--output requires a value.");
      }

      options.outputPath = value;
      index += 1;
      continue;
    }

    if (argument.startsWith("--output=")) {
      options.outputPath = argument.slice("--output=".length);
      continue;
    }

    throw new Error(`Unknown argument: ${argument}`);
  }

  return options;
}

export function createSuccessfulEndToEndEnrichmentLoadVerificationOutput(args: {
  generatedAt?: string;
  options: VerifyEndToEndEnrichmentLoadCliOptions;
  result: EndToEndEnrichmentLoadRunResult;
}): EndToEndEnrichmentLoadVerificationOutput {
  const generatedAt = args.generatedAt ?? new Date().toISOString();
  const captureVolume = args.result.fixture.summary.captureVolume;
  const failedItemCount = args.result.latencyReport.summary.failedItemCount;

  return {
    error: null,
    fixture: buildFixtureSummary(args.result.fixture),
    generatedAt,
    message: `PASS: end-to-end expected-load verification completed for ${captureVolume} captures with ${failedItemCount} failures.`,
    passed: true,
    requestedOptions: buildRequestedOptions(args.options),
    scenario: END_TO_END_EXPECTED_LOAD_VERIFICATION_SCENARIO,
    status: "PASS",
    verification: {
      latencyReport: args.result.latencyReport,
      runReport: args.result.report,
    },
  };
}

export function createFailedEndToEndEnrichmentLoadVerificationOutput(args: {
  error: unknown;
  fixture: ExpectedEnrichmentLoadFixture | null;
  generatedAt?: string;
  options: VerifyEndToEndEnrichmentLoadCliOptions;
}): EndToEndEnrichmentLoadVerificationOutput {
  const generatedAt = args.generatedAt ?? new Date().toISOString();
  const normalizedError = normalizeError(args.error);

  return {
    error: normalizedError,
    fixture: buildFixtureSummary(args.fixture),
    generatedAt,
    message: `FAIL: end-to-end expected-load verification failed: ${normalizedError.message}`,
    passed: false,
    requestedOptions: buildRequestedOptions(args.options),
    scenario: END_TO_END_EXPECTED_LOAD_VERIFICATION_SCENARIO,
    status: "FAIL",
    verification: extractVerificationFailureArtifacts(args.error),
  };
}

export async function runEndToEndEnrichmentLoadVerification(
  options: VerifyEndToEndEnrichmentLoadCliOptions = {},
): Promise<EndToEndEnrichmentLoadVerificationOutput> {
  let fixture: ExpectedEnrichmentLoadFixture | null = null;

  try {
    fixture = createExpectedEnrichmentLoadFixture({
      ...(options.captureVolume === undefined
        ? {}
        : {
            captureVolume: options.captureVolume,
          }),
      ...(options.userId === undefined
        ? {}
        : {
            userId: options.userId,
          }),
    });

    const result = await runEndToEndEnrichmentLoadFixture({
      fixture,
    });

    return createSuccessfulEndToEndEnrichmentLoadVerificationOutput({
      options,
      result,
    });
  } catch (error) {
    return createFailedEndToEndEnrichmentLoadVerificationOutput({
      error,
      fixture,
      options,
    });
  }
}

export function writeEndToEndEnrichmentLoadVerificationOutput(
  output: EndToEndEnrichmentLoadVerificationOutput,
  io: VerifyEndToEndEnrichmentLoadIo = {
    stderr: process.stderr,
    stdout: process.stdout,
  },
) {
  const serializedOutput = serializeVerificationOutput(output);

  io.stdout.write(serializedOutput);
  io.stderr.write(`${output.message}\n`);

  const outputPath = output.requestedOptions.outputPath;

  if (!outputPath) {
    return;
  }

  const resolvedOutputPath = path.resolve(outputPath);

  mkdirSync(path.dirname(resolvedOutputPath), {
    recursive: true,
  });
  writeFileSync(resolvedOutputPath, serializedOutput, "utf8");
}

export async function main(
  argv: readonly string[] = process.argv.slice(2),
): Promise<number> {
  const options = (() => {
    try {
      return parseVerifyEndToEndEnrichmentLoadArgs(argv);
    } catch (error) {
      const output = createFailedEndToEndEnrichmentLoadVerificationOutput({
        error,
        fixture: null,
        options: {},
      });

      writeEndToEndEnrichmentLoadVerificationOutput(output);
      return null;
    }
  })();

  if (options === null) {
    return 1;
  }

  const output = await runEndToEndEnrichmentLoadVerification(options);

  writeEndToEndEnrichmentLoadVerificationOutput(output);
  return output.passed ? 0 : 1;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
const modulePath = fileURLToPath(import.meta.url);

if (invokedPath === modulePath) {
  void main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
