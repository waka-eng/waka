import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  REQUIRED_WEB_ICON_FILE_NAMES,
  WEB_ICON_OUTPUT_DIRECTORY,
  prepareWebIcons,
} from "../scripts/prepare-web-icons.ts";

test("web build preparation emits the PWA icon set into the public icons directory", async () => {
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "waka-web-icons-"));
  const webAppRoot = path.join(temporaryRoot, "apps", "web");
  const outputDirectory = path.join(webAppRoot, WEB_ICON_OUTPUT_DIRECTORY);

  const preparedPaths = await prepareWebIcons(webAppRoot);

  assert.deepEqual(
    preparedPaths,
    REQUIRED_WEB_ICON_FILE_NAMES.map((fileName) =>
      path.join(outputDirectory, fileName),
    ),
  );

  for (const preparedPath of preparedPaths) {
    assert.equal(existsSync(preparedPath), true, `${preparedPath} should exist`);
    assert.equal(
      statSync(preparedPath).size > 0,
      true,
      `${preparedPath} should not be empty`,
    );
  }
});

test("web workspace build prepares icons before next build", () => {
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
