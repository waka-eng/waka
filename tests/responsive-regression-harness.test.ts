import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  RESPONSIVE_REGRESSION_BASELINE_SNAPSHOT_ROOT,
  RESPONSIVE_REGRESSION_VIEWPORT_PRESET_ORDER,
  RESPONSIVE_REGRESSION_VIEWPORT_PRESETS,
  buildResponsiveRegressionBaselineSnapshotConfig,
  buildResponsiveRegressionBaselineSnapshotMatrix,
  sanitizeResponsiveRegressionBaselineName,
} from "./helpers/responsive-regression-harness.ts";

test("responsive regression harness defines the 375, 768, and 1440 viewport presets from the spec", () => {
  assert.deepEqual(RESPONSIVE_REGRESSION_VIEWPORT_PRESET_ORDER, [
    "mobile",
    "tablet",
    "desktop",
  ]);
  assert.equal(
    RESPONSIVE_REGRESSION_BASELINE_SNAPSHOT_ROOT,
    path.join("tests", "__snapshots__", "responsive"),
  );
  assert.deepEqual(RESPONSIVE_REGRESSION_VIEWPORT_PRESETS.mobile, {
    baselineDirectory: path.join("tests", "__snapshots__", "responsive", "mobile"),
    displayName: "Mobile 375px",
    height: 812,
    name: "mobile",
    snapshotSlug: "mobile-375w",
    width: 375,
  });
  assert.deepEqual(RESPONSIVE_REGRESSION_VIEWPORT_PRESETS.tablet, {
    baselineDirectory: path.join("tests", "__snapshots__", "responsive", "tablet"),
    displayName: "Tablet 768px",
    height: 1024,
    name: "tablet",
    snapshotSlug: "tablet-768w",
    width: 768,
  });
  assert.deepEqual(RESPONSIVE_REGRESSION_VIEWPORT_PRESETS.desktop, {
    baselineDirectory: path.join("tests", "__snapshots__", "responsive", "desktop"),
    displayName: "Desktop 1440px",
    height: 900,
    name: "desktop",
    snapshotSlug: "desktop-1440w",
    width: 1440,
  });
});

test("responsive regression baseline config gives tablet captures a dedicated baseline directory and file name", () => {
  const baseline = buildResponsiveRegressionBaselineSnapshotConfig(
    "Workspace Home",
    "tablet",
  );

  assert.deepEqual(baseline, {
    baselineDirectory: path.join("tests", "__snapshots__", "responsive", "tablet"),
    baselineName: "workspace-home",
    fileName: "workspace-home--tablet-768w.png",
    path: path.join(
      "tests",
      "__snapshots__",
      "responsive",
      "tablet",
      "workspace-home--tablet-768w.png",
    ),
    viewport: RESPONSIVE_REGRESSION_VIEWPORT_PRESETS.tablet,
  });
});

test("responsive regression baseline matrix produces ordered mobile, tablet, and desktop snapshots", () => {
  const matrix = buildResponsiveRegressionBaselineSnapshotMatrix("Settings API Keys");

  assert.deepEqual(
    matrix.map((entry) => ({
      fileName: entry.fileName,
      viewport: entry.viewport.name,
      width: entry.viewport.width,
    })),
    [
      {
        fileName: "settings-api-keys--mobile-375w.png",
        viewport: "mobile",
        width: 375,
      },
      {
        fileName: "settings-api-keys--tablet-768w.png",
        viewport: "tablet",
        width: 768,
      },
      {
        fileName: "settings-api-keys--desktop-1440w.png",
        viewport: "desktop",
        width: 1440,
      },
    ],
  );
});

test("responsive regression baseline names are sanitized and reject empty values", () => {
  assert.equal(
    sanitizeResponsiveRegressionBaselineName("  Landing Page / Auth Shell  "),
    "landing-page-auth-shell",
  );
  assert.throws(
    () => sanitizeResponsiveRegressionBaselineName("!@#$%^&*()"),
    /must include at least one letter or number/u,
  );
});
