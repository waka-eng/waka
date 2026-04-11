import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  WAKA_APPLE_TOUCH_ICON_120_PATH,
  WAKA_APPLE_TOUCH_ICON_152_PATH,
  WAKA_APPLE_TOUCH_ICON_167_PATH,
  WAKA_APPLE_TOUCH_ICON_PATH,
  WAKA_APP_SHELL_DEFAULT_NAVIGATION_PATH,
  WAKA_ICON_16_PATH,
  WAKA_ICON_192_PATH,
  WAKA_ICON_32_PATH,
  WAKA_ICON_512_PATH,
  WAKA_ICON_MASKABLE_512_PATH,
  WAKA_MANIFEST_PATH,
  WAKA_SERVICE_WORKER_SCOPE,
  WAKA_THEME_COLOR,
} from "../apps/web/src/pwa/install-metadata.ts";
import {
  WAKA_ROOT_METADATA_APPLE_WEB_APP,
  WAKA_ROOT_METADATA_APPLE_ICONS,
  WAKA_ROOT_METADATA_CONFIG,
  WAKA_ROOT_METADATA_ICONS,
  WAKA_ROOT_METADATA_SHORTCUT_ICONS,
  WAKA_ROOT_VIEWPORT_CONFIG,
} from "../apps/web/src/pwa/root-metadata.ts";
import {
  createWakaWebManifest,
  serializeWakaWebManifest,
} from "../apps/web/src/pwa/web-manifest.ts";
import {
  WEB_MANIFEST_OUTPUT_PATH,
  prepareWebManifestSource,
} from "../scripts/prepare-web-manifest.ts";

const WEB_APP_ROOT = path.join(process.cwd(), "apps/web");
const LAYOUT_PATH = path.join(WEB_APP_ROOT, "app/layout.tsx");
const PUBLIC_MANIFEST_PATH = path.join(WEB_APP_ROOT, WEB_MANIFEST_OUTPUT_PATH);
const REQUIRED_ICON_PATHS = [
  path.join("public", WAKA_ICON_16_PATH.slice(1)),
  path.join("public", WAKA_ICON_32_PATH.slice(1)),
  path.join("public", WAKA_APPLE_TOUCH_ICON_PATH.slice(1)),
  path.join("public", WAKA_APPLE_TOUCH_ICON_167_PATH.slice(1)),
  path.join("public", WAKA_APPLE_TOUCH_ICON_152_PATH.slice(1)),
  path.join("public", WAKA_APPLE_TOUCH_ICON_120_PATH.slice(1)),
  path.join("public", WAKA_ICON_192_PATH.slice(1)),
  path.join("public", WAKA_ICON_512_PATH.slice(1)),
  path.join("public", WAKA_ICON_MASKABLE_512_PATH.slice(1)),
  path.join("public", WAKA_MANIFEST_PATH.slice(1)),
] as const;

test("web manifest advertises standard launcher icons and a Chrome maskable variant", () => {
  const webManifest = createWakaWebManifest();
  const icons = webManifest.icons ?? [];

  assert.equal(webManifest.start_url, WAKA_APP_SHELL_DEFAULT_NAVIGATION_PATH);
  assert.equal(webManifest.scope, WAKA_SERVICE_WORKER_SCOPE);
  assert.deepEqual(
    icons,
    [
      {
        src: WAKA_ICON_192_PATH,
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: WAKA_ICON_512_PATH,
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: WAKA_ICON_MASKABLE_512_PATH,
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  );
});

test("public web manifest matches the generated production artifact", () => {
  const source = readFileSync(PUBLIC_MANIFEST_PATH, "utf8");

  assert.equal(source, serializeWakaWebManifest(createWakaWebManifest()));
  assert.equal(source, prepareWebManifestSource());
});

test("required installable icon assets are present in the web app", () => {
  for (const relativePath of REQUIRED_ICON_PATHS) {
    assert.equal(
      existsSync(path.join(WEB_APP_ROOT, relativePath)),
      true,
      `${relativePath} should exist`,
    );
  }
});

test("manifest icon URLs resolve to public production assets", () => {
  const manifest = JSON.parse(
    readFileSync(PUBLIC_MANIFEST_PATH, "utf8"),
  ) as {
    icons?: Array<{
      src: string;
    }>;
  };

  for (const icon of manifest.icons ?? []) {
    assert.equal(icon.src.startsWith("/"), true, `${icon.src} should be root-relative`);

    const productionAssetPath = path.join(
      WEB_APP_ROOT,
      "public",
      icon.src.slice(1),
    );

    assert.equal(
      existsSync(productionAssetPath),
      true,
      `${icon.src} should resolve to ${path.relative(WEB_APP_ROOT, productionAssetPath)}`,
    );
  }
});

test("root metadata links the manifest, install icons, and theme metadata", () => {
  assert.equal(WAKA_ROOT_METADATA_CONFIG.manifest, WAKA_MANIFEST_PATH);
  assert.deepEqual(
    WAKA_ROOT_METADATA_CONFIG.appleWebApp,
    WAKA_ROOT_METADATA_APPLE_WEB_APP,
  );
  assert.deepEqual(WAKA_ROOT_METADATA_APPLE_ICONS, [
    {
      url: WAKA_APPLE_TOUCH_ICON_PATH,
      sizes: "180x180",
      type: "image/png",
    },
    {
      url: WAKA_APPLE_TOUCH_ICON_167_PATH,
      sizes: "167x167",
      type: "image/png",
    },
    {
      url: WAKA_APPLE_TOUCH_ICON_152_PATH,
      sizes: "152x152",
      type: "image/png",
    },
    {
      url: WAKA_APPLE_TOUCH_ICON_120_PATH,
      sizes: "120x120",
      type: "image/png",
    },
  ]);
  assert.deepEqual(
    WAKA_ROOT_METADATA_CONFIG.icons.apple,
    WAKA_ROOT_METADATA_APPLE_ICONS,
  );
  assert.deepEqual(
    WAKA_ROOT_METADATA_CONFIG.icons.icon,
    WAKA_ROOT_METADATA_ICONS,
  );
  assert.deepEqual(
    WAKA_ROOT_METADATA_CONFIG.icons.shortcut,
    WAKA_ROOT_METADATA_SHORTCUT_ICONS,
  );
  assert.equal(WAKA_ROOT_VIEWPORT_CONFIG.themeColor, WAKA_THEME_COLOR);
  assert.equal(WAKA_ROOT_METADATA_CONFIG.appleWebApp.capable, true);
  assert.equal(WAKA_ROOT_METADATA_CONFIG.appleWebApp.title, "Waka");
  assert.equal(
    WAKA_ROOT_METADATA_CONFIG.appleWebApp.statusBarStyle,
    "black-translucent",
  );
});

test("root layout exports the shared installability metadata into the Next production document", () => {
  const source = readFileSync(LAYOUT_PATH, "utf8");

  assert.match(source, /WAKA_ROOT_VIEWPORT_CONFIG/u);
  assert.match(source, /WAKA_ROOT_METADATA_CONFIG/u);
  assert.match(source, /export const viewport:\s*Viewport = WAKA_ROOT_VIEWPORT_CONFIG;/u);
  assert.match(source, /export const metadata:\s*Metadata = WAKA_ROOT_METADATA_CONFIG;/u);
  assert.match(source, /ServiceWorkerRegistration/u);
});
