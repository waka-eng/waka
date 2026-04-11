import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  WEB_MANIFEST_OUTPUT_PATH,
  prepareWebManifest,
  prepareWebManifestSource,
} from "../scripts/prepare-web-manifest.ts";

test("web build preparation emits manifest.webmanifest into the public directory", async () => {
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "waka-web-manifest-"));
  const webAppRoot = path.join(temporaryRoot, "apps", "web");
  const outputPath = path.join(webAppRoot, WEB_MANIFEST_OUTPUT_PATH);

  mkdirSync(path.dirname(outputPath), {
    recursive: true,
  });

  const preparedPath = await prepareWebManifest(webAppRoot);

  assert.equal(preparedPath, outputPath);
  assert.equal(readFileSync(outputPath, "utf8"), prepareWebManifestSource());
});

test("web workspace build prepares the manifest before next build", () => {
  const manifest = JSON.parse(
    readFileSync("apps/web/package.json", "utf8"),
  ) as {
    scripts?: Record<string, string>;
  };

  assert.equal(
    manifest.scripts?.build,
    "node ../../scripts/prepare-web-icons.ts && node ../../scripts/prepare-web-manifest.ts && node ../../scripts/prepare-web-service-worker.ts && next build",
  );
});
