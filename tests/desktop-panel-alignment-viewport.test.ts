import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const WEB_APP_ROOT = path.join(process.cwd(), "apps/web");
const GLOBAL_STYLES_PATH = path.join(WEB_APP_ROOT, "app/globals.css");
const AUTHENTICATED_APP_LAYOUT_PATH = path.join(
  WEB_APP_ROOT,
  "app/(app)/layout.tsx",
);
const AUTHENTICATED_APP_NAVIGATION_PATH = path.join(
  WEB_APP_ROOT,
  "src/shell/authenticated-app-navigation.tsx",
);
const WORKSPACE_HOME_SCREEN_PATH = path.join(
  WEB_APP_ROOT,
  "src/home/workspace-home-screen.tsx",
);
const SETTINGS_API_KEYS_CLIENT_PATH = path.join(
  WEB_APP_ROOT,
  "app/(app)/settings/settings-api-keys-client.tsx",
);

test("desktop shell now keeps a top navigation bar and an inline detail surface instead of permanent side columns", () => {
  const globalStylesSource = readFileSync(GLOBAL_STYLES_PATH, "utf8");
  const authenticatedLayoutSource = readFileSync(
    AUTHENTICATED_APP_LAYOUT_PATH,
    "utf8",
  );
  const navigationSource = readFileSync(
    AUTHENTICATED_APP_NAVIGATION_PATH,
    "utf8",
  );
  const workspaceHomeSource = readFileSync(WORKSPACE_HOME_SCREEN_PATH, "utf8");

  assert.match(
    authenticatedLayoutSource,
    /className="waka-shell-container waka-authenticated-shell-container"/u,
  );
  assert.match(
    authenticatedLayoutSource,
    /<AuthenticatedAppNavigation \/>[\s\S]*<WorkspaceCaptureBar \/>/u,
  );
  assert.match(
    navigationSource,
    /Waka[\s\S]*Keep the rough thought\. Let the workspace organize it later\./u,
  );
  assert.match(
    globalStylesSource,
    /@media\s*\(min-width:\s*80rem\)\s*\{[\s\S]*\.waka-authenticated-shell-body\s*\{[\s\S]*flex-direction:\s*column;/u,
  );
  assert.match(
    workspaceHomeSource,
    /const WORKSPACE_HOME_CONTENT_GRID_CLASS_NAME =\s*"grid gap-6 xl:items-start xl:grid-cols-\[minmax\(0,1fr\)_minmax\(18rem,20rem\)\]";/u,
  );
  assert.match(
    workspaceHomeSource,
    /data-section="record-detail"[\s\S]*className="hidden min-\[56rem\]:block waka-primary-section/u,
  );
  assert.doesNotMatch(
    workspaceHomeSource,
    /<div className="hidden xl:block">[\s\S]*data-section="record-detail"/u,
  );
  assert.doesNotMatch(workspaceHomeSource, /Always safe|Start rough/u);
});

test("desktop workspace and settings cards both use lighter auto-fit grids", () => {
  const settingsSource = readFileSync(SETTINGS_API_KEYS_CLIENT_PATH, "utf8");
  const workspaceHomeSource = readFileSync(WORKSPACE_HOME_SCREEN_PATH, "utf8");

  assert.match(
    settingsSource,
    /const apiKeysListClassName =\s*"grid min-w-0 gap-4 min-\[56rem\]:grid-cols-\[repeat\(auto-fit,minmax\(22rem,1fr\)\)\] xl:grid-cols-\[repeat\(auto-fit,minmax\(19rem,1fr\)\)\]";/u,
  );
  assert.match(
    workspaceHomeSource,
    /const WORKSPACE_HOME_RECENT_RECORDS_GRID_CLASS_NAME =\s*"mt-6 grid min-w-0 gap-4 min-\[56rem\]:grid-cols-\[repeat\(auto-fit,minmax\(16rem,1fr\)\)\]";/u,
  );
  assert.match(
    workspaceHomeSource,
    /const WORKSPACE_HOME_CLUSTER_GRID_CLASS_NAME =\s*"mt-6 grid min-w-0 gap-4 min-\[56rem\]:grid-cols-\[repeat\(auto-fit,minmax\(18rem,1fr\)\)\]";/u,
  );
});
