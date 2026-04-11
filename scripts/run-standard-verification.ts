import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_END_TO_END_ENRICHMENT_LOAD_REPORT_PATH = path.join(
  "reports",
  "end-to-end-enrichment-load-verification.json",
);

export interface StandardVerificationCliOptions {
  skipTypecheck: boolean;
}

export interface StandardVerificationStep {
  args: string[];
  command: string;
  name: "expected-load" | "node-tests" | "typecheck";
}

export interface StandardVerificationFailure {
  errorMessage?: string;
  exitCode: number | null;
  name: StandardVerificationStep["name"];
}

export interface StandardVerificationRunResult {
  failures: StandardVerificationFailure[];
  passed: boolean;
}

function readTrimmedString(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmedValue = value.trim();

  return trimmedValue.length > 0 ? trimmedValue : undefined;
}

export function resolvePackageManagerExecutable(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return (
    readTrimmedString(env.PNPM_EXECUTABLE) ??
    (process.platform === "win32" ? "pnpm.cmd" : "pnpm")
  );
}

export function parseStandardVerificationArgs(
  argv: readonly string[],
): StandardVerificationCliOptions {
  const options: StandardVerificationCliOptions = {
    skipTypecheck: false,
  };

  for (const argument of argv) {
    if (!argument || argument === "--") {
      continue;
    }

    if (argument === "--skip-typecheck") {
      options.skipTypecheck = true;
      continue;
    }

    throw new Error(`Unknown argument: ${argument}`);
  }

  return options;
}

export function buildStandardVerificationSteps(
  options: StandardVerificationCliOptions = {
    skipTypecheck: false,
  },
  env: NodeJS.ProcessEnv = process.env,
): StandardVerificationStep[] {
  const packageManagerExecutable = resolvePackageManagerExecutable(env);
  const steps: StandardVerificationStep[] = [];

  if (!options.skipTypecheck) {
    steps.push({
      args: ["run", "typecheck"],
      command: packageManagerExecutable,
      name: "typecheck",
    });
  }

  steps.push(
    {
      args: ["--test", "tests/*.test.ts"],
      command: process.execPath,
      name: "node-tests",
    },
    {
      args: [
        "scripts/verify-end-to-end-enrichment-load.ts",
        "--output",
        DEFAULT_END_TO_END_ENRICHMENT_LOAD_REPORT_PATH,
      ],
      command: process.execPath,
      name: "expected-load",
    },
  );

  return steps;
}

function formatStepCommand(step: StandardVerificationStep): string {
  return [step.command, ...step.args].join(" ");
}

export function runStandardVerification(
  steps: readonly StandardVerificationStep[],
): StandardVerificationRunResult {
  const failures: StandardVerificationFailure[] = [];

  for (const step of steps) {
    console.log(`\n==> ${step.name}: ${formatStepCommand(step)}`);

    const result = spawnSync(step.command, step.args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    });

    if (result.error) {
      failures.push({
        errorMessage: result.error.message,
        exitCode: null,
        name: step.name,
      });
      continue;
    }

    if (result.status !== 0) {
      failures.push({
        exitCode: result.status,
        name: step.name,
      });
    }
  }

  return {
    failures,
    passed: failures.length === 0,
  };
}

export async function main(
  argv: readonly string[] = process.argv.slice(2),
): Promise<number> {
  let options: StandardVerificationCliOptions;

  try {
    options = parseStandardVerificationArgs(argv);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown verification argument error.";

    console.error(`FAIL: ${message}`);
    return 1;
  }

  const result = runStandardVerification(buildStandardVerificationSteps(options));

  if (result.passed) {
    console.log("\nPASS: standard verification completed.");
    return 0;
  }

  console.error(
    `\nFAIL: standard verification failed for steps: ${result.failures
      .map((failure) =>
        failure.errorMessage
          ? `${failure.name} (${failure.errorMessage})`
          : failure.name,
      )
      .join(", ")}`,
  );

  return 1;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
const modulePath = fileURLToPath(import.meta.url);

if (invokedPath === modulePath) {
  void main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
