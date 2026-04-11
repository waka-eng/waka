import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const WEB_ICON_OUTPUT_DIRECTORY = path.join("public", "icons");
export const REQUIRED_WEB_ICON_FILE_NAMES = [
  "icon-16.png",
  "icon-32.png",
  "apple-touch-icon.png",
  "apple-touch-icon-167.png",
  "apple-touch-icon-152.png",
  "apple-touch-icon-120.png",
  "icon-192.png",
  "icon-512.png",
  "icon-maskable-512.png",
] as const;

const PYTHON_CANDIDATES = ["python3", "python"] as const;
const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIRECTORY, "..");
const WEB_ICON_GENERATOR_PATH = path.join(
  REPO_ROOT,
  "scripts",
  "generate-web-app-icons.py",
);
export const DEFAULT_WEB_APP_ROOT = path.join(REPO_ROOT, "apps", "web");
const DEFAULT_WEB_ICON_SOURCE_DIRECTORY = path.join(
  DEFAULT_WEB_APP_ROOT,
  WEB_ICON_OUTPUT_DIRECTORY,
);

function getWebIconOutputDirectory(webAppRoot: string = DEFAULT_WEB_APP_ROOT): string {
  return path.join(webAppRoot, WEB_ICON_OUTPUT_DIRECTORY);
}

export function getRequiredWebIconOutputPaths(
  webAppRoot: string = DEFAULT_WEB_APP_ROOT,
): string[] {
  const outputDirectory = getWebIconOutputDirectory(webAppRoot);

  return REQUIRED_WEB_ICON_FILE_NAMES.map((fileName) =>
    path.join(outputDirectory, fileName),
  );
}

async function pathExists(pathToCheck: string): Promise<boolean> {
  try {
    await access(pathToCheck, constants.F_OK);

    return true;
  } catch {
    return false;
  }
}

async function hasRequiredWebIconOutputs(
  webAppRoot: string = DEFAULT_WEB_APP_ROOT,
): Promise<boolean> {
  for (const outputPath of getRequiredWebIconOutputPaths(webAppRoot)) {
    if (!(await pathExists(outputPath))) {
      return false;
    }
  }

  return true;
}

async function copyBundledWebIcons(webAppRoot: string): Promise<boolean> {
  if (path.resolve(webAppRoot) === DEFAULT_WEB_APP_ROOT) {
    return false;
  }

  if (!(await hasRequiredWebIconOutputs(DEFAULT_WEB_APP_ROOT))) {
    return false;
  }

  const outputDirectory = getWebIconOutputDirectory(webAppRoot);

  await mkdir(outputDirectory, {
    recursive: true,
  });

  for (const fileName of REQUIRED_WEB_ICON_FILE_NAMES) {
    await copyFile(
      path.join(DEFAULT_WEB_ICON_SOURCE_DIRECTORY, fileName),
      path.join(outputDirectory, fileName),
    );
  }

  return true;
}

async function runWebIconGenerator(
  pythonCommand: string,
  outputDirectory: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      pythonCommand,
      [WEB_ICON_GENERATOR_PATH, "--output-dir", outputDirectory],
      {
        cwd: REPO_ROOT,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stderr = "";
    let stdout = "";

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      reject(error);
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve();

        return;
      }

      reject(
        new Error(
          [
            `Generating web icons with ${pythonCommand} exited with code ${code}.`,
            stderr.trim() || stdout.trim(),
          ]
            .filter(Boolean)
            .join("\n"),
        ),
      );
    });
  });
}

async function generateWebIcons(outputDirectory: string): Promise<void> {
  const generationErrors: string[] = [];

  for (const pythonCommand of PYTHON_CANDIDATES) {
    try {
      await runWebIconGenerator(pythonCommand, outputDirectory);

      return;
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        continue;
      }

      generationErrors.push(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  throw new Error(
    [
      "Unable to prepare the Waka PWA icons.",
      "No usable Python runtime was found and the required icon files were not already available.",
      ...generationErrors,
    ].join("\n"),
  );
}

export async function prepareWebIcons(
  webAppRoot: string = DEFAULT_WEB_APP_ROOT,
): Promise<string[]> {
  const outputDirectory = getWebIconOutputDirectory(webAppRoot);

  await mkdir(outputDirectory, {
    recursive: true,
  });

  if (!(await hasRequiredWebIconOutputs(webAppRoot))) {
    const copiedBundledIcons = await copyBundledWebIcons(webAppRoot);

    if (!copiedBundledIcons) {
      await generateWebIcons(outputDirectory);
    }
  }

  const outputPaths = getRequiredWebIconOutputPaths(webAppRoot);

  for (const outputPath of outputPaths) {
    await access(outputPath, constants.R_OK);
  }

  return outputPaths;
}

export async function main(): Promise<void> {
  const outputPaths = await prepareWebIcons();

  for (const outputPath of outputPaths) {
    console.log(`Prepared ${path.relative(REPO_ROOT, outputPath)}`);
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
const modulePath = fileURLToPath(import.meta.url);

if (invokedPath === modulePath) {
  void main();
}
