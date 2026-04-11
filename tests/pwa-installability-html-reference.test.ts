import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  WAKA_INSTALLABILITY_ASSET_PATHS,
  WAKA_MANIFEST_PATH,
  WAKA_ROOT_METADATA_ICON_PATHS,
  WAKA_SERVICE_WORKER_PRECACHE_PATHS,
} from "../apps/web/src/pwa/install-metadata.ts";
import { WAKA_ROOT_METADATA_CONFIG } from "../apps/web/src/pwa/root-metadata.ts";
import { createWakaWebManifest } from "../apps/web/src/pwa/web-manifest.ts";
import { WEB_MANIFEST_OUTPUT_PATH } from "../scripts/prepare-web-manifest.ts";

const WEB_APP_ROOT = path.join(process.cwd(), "apps", "web");
const GENERATED_SERVICE_WORKER_PATH = path.join(WEB_APP_ROOT, "public", "sw.js");
const PUBLIC_MANIFEST_PATH = path.join(WEB_APP_ROOT, WEB_MANIFEST_OUTPUT_PATH);
const INSTALLABILITY_ASSET_PATH_SET = new Set<string>(
  WAKA_INSTALLABILITY_ASSET_PATHS,
);
const SERVICE_WORKER_PRECACHE_PATH_SET = new Set<string>(
  WAKA_SERVICE_WORKER_PRECACHE_PATHS,
);

function resolvePublicAssetPath(publicPath: string): string {
  return path.join(WEB_APP_ROOT, "public", publicPath.slice(1));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("Next root metadata that becomes the production HTML head points at final installability assets", () => {
  const headAssetPaths = [
    WAKA_ROOT_METADATA_CONFIG.manifest,
    ...WAKA_ROOT_METADATA_ICON_PATHS,
  ];

  assert.equal(WAKA_ROOT_METADATA_CONFIG.manifest, WAKA_MANIFEST_PATH);

  for (const assetPath of headAssetPaths) {
    assert.equal(assetPath.startsWith("/"), true, `${assetPath} should be root-relative`);
    assert.equal(
      existsSync(resolvePublicAssetPath(assetPath)),
      true,
      `${assetPath} should resolve to a public production asset`,
    );
    assert.equal(
      INSTALLABILITY_ASSET_PATH_SET.has(assetPath),
      true,
      `${assetPath} should be tracked as an installability asset`,
    );
    assert.equal(
      SERVICE_WORKER_PRECACHE_PATH_SET.has(assetPath),
      true,
      `${assetPath} should stay under service-worker control`,
    );
  }
});

test("public manifest installability assets resolve to final production paths covered by the service worker", () => {
  const manifest = JSON.parse(readFileSync(PUBLIC_MANIFEST_PATH, "utf8")) as {
    icons?: Array<{
      src: string;
    }>;
    start_url: string;
  };
  const expectedManifest = createWakaWebManifest();
  const manifestIconPaths = manifest.icons?.map(({ src }) => src) ?? [];

  assert.equal(manifest.start_url, expectedManifest.start_url);
  assert.deepEqual(
    manifestIconPaths,
    expectedManifest.icons.map(({ src }) => src),
  );

  for (const assetPath of manifestIconPaths) {
    assert.equal(assetPath.startsWith("/"), true, `${assetPath} should be root-relative`);
    assert.equal(
      existsSync(resolvePublicAssetPath(assetPath)),
      true,
      `${assetPath} should resolve to a public production asset`,
    );
    assert.equal(
      INSTALLABILITY_ASSET_PATH_SET.has(assetPath),
      true,
      `${assetPath} should be tracked as an installability asset`,
    );
    assert.equal(
      SERVICE_WORKER_PRECACHE_PATH_SET.has(assetPath),
      true,
      `${assetPath} should stay under service-worker control`,
    );
  }
});

test("generated service worker precaches every installability asset referenced by the HTML head or manifest", () => {
  const serviceWorkerSource = readFileSync(GENERATED_SERVICE_WORKER_PATH, "utf8");
  const installabilityAssetPaths = new Set<string>([
    WAKA_ROOT_METADATA_CONFIG.manifest,
    ...WAKA_ROOT_METADATA_ICON_PATHS,
    ...createWakaWebManifest().icons.map(({ src }) => src),
  ]);

  for (const assetPath of installabilityAssetPaths) {
    assert.equal(
      SERVICE_WORKER_PRECACHE_PATH_SET.has(assetPath),
      true,
      `${assetPath} should be part of the service worker precache list`,
    );
    assert.match(
      serviceWorkerSource,
      new RegExp(escapeRegExp(assetPath), "u"),
    );
  }
});
