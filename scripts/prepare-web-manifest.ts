import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createWakaWebManifest,
  serializeWakaWebManifest,
} from "../apps/web/src/pwa/web-manifest.ts";

export const WEB_MANIFEST_OUTPUT_PATH = path.join(
  "public",
  "manifest.webmanifest",
);

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIRECTORY, "..");
export const DEFAULT_WEB_APP_ROOT = path.join(REPO_ROOT, "apps", "web");

export function prepareWebManifestSource(): string {
  return serializeWakaWebManifest(createWakaWebManifest());
}

export async function prepareWebManifest(
  webAppRoot: string = DEFAULT_WEB_APP_ROOT,
): Promise<string> {
  const outputPath = path.join(webAppRoot, WEB_MANIFEST_OUTPUT_PATH);

  await mkdir(path.dirname(outputPath), {
    recursive: true,
  });
  await writeFile(outputPath, prepareWebManifestSource(), "utf8");

  return outputPath;
}

export async function main(): Promise<void> {
  const outputPath = await prepareWebManifest();

  console.log(`Prepared ${path.relative(REPO_ROOT, outputPath)}`);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
const modulePath = fileURLToPath(import.meta.url);

if (invokedPath === modulePath) {
  void main();
}
