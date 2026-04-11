import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  WAKA_APP_SHELL_DEFAULT_NAVIGATION_PATH,
  WAKA_APP_SHELL_ROUTE_PATHS,
  WAKA_SERVICE_WORKER_PRECACHE_PATHS,
} from "../apps/web/src/pwa/install-metadata.ts";

export const WEB_SERVICE_WORKER_TEMPLATE_PATH = path.join(
  "src",
  "pwa",
  "service-worker-template.js",
);
export const WEB_SERVICE_WORKER_OUTPUT_PATH = path.join("public", "sw.js");
export const WEB_SERVICE_WORKER_CACHE_VERSION_PLACEHOLDER =
  "__WAKA_APP_SHELL_CACHE_VERSION__";
export const WEB_SERVICE_WORKER_DEFAULT_NAVIGATION_PATH_PLACEHOLDER =
  "__WAKA_APP_SHELL_DEFAULT_NAVIGATION_PATH__";
export const WEB_SERVICE_WORKER_ROUTE_PATHS_PLACEHOLDER =
  "__WAKA_APP_SHELL_ROUTE_PATHS__";
export const WEB_SERVICE_WORKER_PRECACHED_PATHS_PLACEHOLDER =
  "__WAKA_APP_SHELL_PRECACHED_PATHS__";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIRECTORY, "..");
export const DEFAULT_WEB_APP_ROOT = path.join(REPO_ROOT, "apps", "web");

export function createWebServiceWorkerCacheVersion(
  serviceWorkerTemplateSource: string,
): string {
  return createHash("sha256")
    .update(serviceWorkerTemplateSource)
    .digest("hex")
    .slice(0, 12);
}

export function prepareWebServiceWorkerSource(
  serviceWorkerTemplateSource: string,
): string {
  return [
    [
      WEB_SERVICE_WORKER_CACHE_VERSION_PLACEHOLDER,
      createWebServiceWorkerCacheVersion(serviceWorkerTemplateSource),
    ],
    [
      WEB_SERVICE_WORKER_DEFAULT_NAVIGATION_PATH_PLACEHOLDER,
      JSON.stringify(WAKA_APP_SHELL_DEFAULT_NAVIGATION_PATH),
    ],
    [
      WEB_SERVICE_WORKER_ROUTE_PATHS_PLACEHOLDER,
      JSON.stringify(WAKA_APP_SHELL_ROUTE_PATHS),
    ],
    [
      WEB_SERVICE_WORKER_PRECACHED_PATHS_PLACEHOLDER,
      JSON.stringify(WAKA_SERVICE_WORKER_PRECACHE_PATHS),
    ],
  ].reduce(
    (preparedSource, [placeholder, replacement]) =>
      preparedSource.replaceAll(placeholder, replacement),
    serviceWorkerTemplateSource,
  );
}

export async function prepareWebServiceWorker(
  webAppRoot: string = DEFAULT_WEB_APP_ROOT,
): Promise<string> {
  const templatePath = path.join(webAppRoot, WEB_SERVICE_WORKER_TEMPLATE_PATH);
  const outputPath = path.join(webAppRoot, WEB_SERVICE_WORKER_OUTPUT_PATH);
  const serviceWorkerTemplateSource = await readFile(templatePath, "utf8");
  const serviceWorkerSource = prepareWebServiceWorkerSource(
    serviceWorkerTemplateSource,
  );

  await mkdir(path.dirname(outputPath), {
    recursive: true,
  });
  await writeFile(outputPath, serviceWorkerSource, "utf8");

  return outputPath;
}

export async function main(): Promise<void> {
  const outputPath = await prepareWebServiceWorker();

  console.log(`Prepared ${path.relative(REPO_ROOT, outputPath)}`);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
const modulePath = fileURLToPath(import.meta.url);

if (invokedPath === modulePath) {
  void main();
}
