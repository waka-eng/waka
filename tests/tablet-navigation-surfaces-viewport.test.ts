import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  RESPONSIVE_REGRESSION_VIEWPORT_PRESETS,
  buildResponsiveRegressionBaselineSnapshotConfig,
} from "./helpers/responsive-regression-harness.ts";

const WEB_APP_ROOT = path.join(process.cwd(), "apps/web");
const GLOBAL_STYLES_PATH = path.join(WEB_APP_ROOT, "app/globals.css");
const AUTHENTICATED_APP_PAGE_OUTLET_PATH = path.join(
  WEB_APP_ROOT,
  "src/shell/authenticated-app-page-outlet.tsx",
);
const AUTHENTICATED_APP_NAVIGATION_PATH = path.join(
  WEB_APP_ROOT,
  "src/shell/authenticated-app-navigation.tsx",
);
const WORKSPACE_HOME_SCREEN_PATH = path.join(
  WEB_APP_ROOT,
  "src/home/workspace-home-screen.tsx",
);

test("tablet responsive regression scenarios still allocate a dedicated drawer baseline", () => {
  const tabletViewport = RESPONSIVE_REGRESSION_VIEWPORT_PRESETS.tablet;
  const baseline = buildResponsiveRegressionBaselineSnapshotConfig(
    "workspace-record-detail-drawer",
    "tablet",
  );

  assert.deepEqual(baseline.viewport, tabletViewport);
  assert.equal(
    baseline.fileName,
    `workspace-record-detail-drawer--${tabletViewport.snapshotSlug}.png`,
  );
});

test("tablet layout keeps the page stack vertical and uses wrapped top navigation instead of an overlay sidebar", () => {
  const globalStylesSource = readFileSync(GLOBAL_STYLES_PATH, "utf8");
  const pageOutletSource = readFileSync(
    AUTHENTICATED_APP_PAGE_OUTLET_PATH,
    "utf8",
  );
  const navigationSource = readFileSync(
    AUTHENTICATED_APP_NAVIGATION_PATH,
    "utf8",
  );
  const workspaceHomeSource = readFileSync(WORKSPACE_HOME_SCREEN_PATH, "utf8");

  assert.match(
    pageOutletSource,
    /className="max-w-3xl break-words text-3xl font-semibold tracking-tight text-stone-950 min-\[56rem\]:text-4xl"/u,
  );
  assert.match(
    globalStylesSource,
    /@media\s*\(min-width:\s*56rem\)\s*\{[\s\S]*\.waka-authenticated-shell-body\s*\{[\s\S]*align-items:\s*stretch;/u,
  );
  assert.match(
    globalStylesSource,
    /\.waka-authenticated-shell-navigation-list\s*\{[\s\S]*display:\s*flex;[\s\S]*flex-wrap:\s*wrap;/u,
  );
  assert.match(navigationSource, /Workspace[\s\S]*Settings/u);
  assert.match(
    workspaceHomeSource,
    /const WORKSPACE_HOME_CONTENT_GRID_CLASS_NAME =\s*"grid gap-6 xl:items-start xl:grid-cols-\[minmax\(0,1fr\)_minmax\(18rem,20rem\)\]";/u,
  );
  assert.match(
    workspaceHomeSource,
    /className="hidden min-\[56rem\]:block waka-primary-section/u,
  );
  assert.match(
    workspaceHomeSource,
    /className="fixed inset-0 z-30 min-\[56rem\]:hidden"/u,
  );
});
