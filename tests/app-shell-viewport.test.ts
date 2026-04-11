import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const WEB_APP_ROOT = path.join(process.cwd(), "apps/web");
const ROOT_LAYOUT_PATH = path.join(WEB_APP_ROOT, "app/layout.tsx");
const ROOT_METADATA_PATH = path.join(
  WEB_APP_ROOT,
  "src/pwa/root-metadata.ts",
);
const GLOBAL_STYLES_PATH = path.join(WEB_APP_ROOT, "app/globals.css");
const AUTHENTICATED_APP_LAYOUT_PATH = path.join(
  WEB_APP_ROOT,
  "app/(app)/layout.tsx",
);
const PUBLIC_AUTH_SHELL_PATH = path.join(
  WEB_APP_ROOT,
  "src/auth/public-auth-shell.tsx",
);
const AUTHENTICATED_APP_PAGE_OUTLET_PATH = path.join(
  WEB_APP_ROOT,
  "src/shell/authenticated-app-page-outlet.tsx",
);
const AUTHENTICATED_APP_NAVIGATION_PATH = path.join(
  WEB_APP_ROOT,
  "src/shell/authenticated-app-navigation.tsx",
);
const SETTINGS_PAGE_PATH = path.join(
  WEB_APP_ROOT,
  "app/(app)/settings/settings-page.ts",
);
const SETTINGS_API_KEYS_CLIENT_PATH = path.join(
  WEB_APP_ROOT,
  "app/(app)/settings/settings-api-keys-client.tsx",
);
const WORKSPACE_CAPTURE_BAR_PATH = path.join(
  WEB_APP_ROOT,
  "src/home/workspace-capture-bar.tsx",
);
const WORKSPACE_HOME_SCREEN_PATH = path.join(
  WEB_APP_ROOT,
  "src/home/workspace-home-screen.tsx",
);

test("root viewport metadata and app chrome stay pinned to the mobile viewport", () => {
  const layoutSource = readFileSync(ROOT_LAYOUT_PATH, "utf8");
  const rootMetadataSource = readFileSync(ROOT_METADATA_PATH, "utf8");
  const stylesSource = readFileSync(GLOBAL_STYLES_PATH, "utf8");

  assert.match(
    layoutSource,
    /export const viewport: Viewport = WAKA_ROOT_VIEWPORT_CONFIG;/u,
  );
  assert.match(
    rootMetadataSource,
    /export const WAKA_ROOT_VIEWPORT_CONFIG = \{[\s\S]*width:\s*"device-width",[\s\S]*initialScale:\s*1,[\s\S]*colorScheme:\s*"dark",/u,
  );
  assert.match(layoutSource, /<html lang="en" className="h-full bg-stone-950">/u);
  assert.match(
    layoutSource,
    /<body className="min-h-screen w-full max-w-full overflow-x-hidden bg-stone-950 text-stone-50 antialiased">/u,
  );
  assert.match(
    stylesSource,
    /body\s*\{[\s\S]*min-height:\s*100vh;[\s\S]*min-height:\s*100dvh;[\s\S]*width:\s*100%;[\s\S]*max-width:\s*100%;[\s\S]*overflow-x:\s*hidden;/u,
  );
});

test("authenticated shell now uses a light top-nav canvas while public auth stays centered", () => {
  const authenticatedLayoutSource = readFileSync(
    AUTHENTICATED_APP_LAYOUT_PATH,
    "utf8",
  );
  const globalStylesSource = readFileSync(GLOBAL_STYLES_PATH, "utf8");
  const publicAuthShellSource = readFileSync(PUBLIC_AUTH_SHELL_PATH, "utf8");
  const pageOutletSource = readFileSync(
    AUTHENTICATED_APP_PAGE_OUTLET_PATH,
    "utf8",
  );
  const navigationSource = readFileSync(
    AUTHENTICATED_APP_NAVIGATION_PATH,
    "utf8",
  );

  assert.match(authenticatedLayoutSource, /AuthenticatedAppShellProvider/u);
  assert.match(authenticatedLayoutSource, /WorkspaceHomeShellProvider/u);
  assert.match(
    authenticatedLayoutSource,
    /className="min-h-screen w-full max-w-full overflow-x-hidden bg-\[linear-gradient\(180deg,_#faf7f1_0%,_#f3ecdf_100%\)\] text-stone-900"/u,
  );
  assert.match(
    authenticatedLayoutSource,
    /<AuthenticatedAppNavigation \/>[\s\S]*<WorkspaceCaptureBar \/>[\s\S]*data-layout="authenticated-app-content"/u,
  );
  assert.match(
    globalStylesSource,
    /\.waka-authenticated-shell-body\s*\{[\s\S]*flex-direction:\s*column;[\s\S]*margin-top:\s*0;[\s\S]*isolation:\s*isolate;/u,
  );
  assert.match(
    globalStylesSource,
    /\.waka-authenticated-shell-navigation-panel\s*\{[\s\S]*border:\s*1px solid rgba\(214, 211, 209, 0\.9\);[\s\S]*border-radius:\s*1\.5rem;[\s\S]*background:\s*rgba\(255, 253, 249, 0\.82\);[\s\S]*backdrop-filter:\s*blur\(18px\);/u,
  );
  assert.match(
    globalStylesSource,
    /\.waka-authenticated-shell-navigation-list\s*\{[\s\S]*display:\s*flex;[\s\S]*flex-wrap:\s*wrap;[\s\S]*align-items:\s*stretch;/u,
  );
  assert.match(
    pageOutletSource,
    /"waka-page-stack text-stone-900"/u,
  );
  assert.match(
    navigationSource,
    /aria-label="Workspace navigation"/u,
  );
  assert.match(
    navigationSource,
    /Capture, revisit, and regroup the notes you keep\./u,
  );

  assert.match(
    publicAuthShellSource,
    /className="min-h-screen w-full max-w-full overflow-x-hidden bg-\[radial-gradient/u,
  );
  assert.match(
    publicAuthShellSource,
    /className="waka-shell-container waka-public-shell-container"/u,
  );
});

test("desktop shell tightens to an 80rem workspace and keeps the header/action row flexible", () => {
  const globalStylesSource = readFileSync(GLOBAL_STYLES_PATH, "utf8");
  const pageOutletSource = readFileSync(
    AUTHENTICATED_APP_PAGE_OUTLET_PATH,
    "utf8",
  );

  assert.match(globalStylesSource, /--waka-shell-max-width:\s*90rem;/u);
  assert.match(
    globalStylesSource,
    /@media\s*\(min-width:\s*80rem\)\s*\{[\s\S]*:root\s*\{[\s\S]*--waka-shell-max-width:\s*80rem;[\s\S]*--waka-authenticated-shell-navigation-width:\s*100%;/u,
  );
  assert.match(
    globalStylesSource,
    /@media\s*\(min-width:\s*80rem\)\s*\{[\s\S]*\.waka-authenticated-shell-body\s*\{[\s\S]*flex-direction:\s*column;[\s\S]*align-items:\s*stretch;[\s\S]*\.waka-authenticated-shell-navigation-list\s*\{[\s\S]*flex-wrap:\s*nowrap;/u,
  );
  assert.match(
    globalStylesSource,
    /@media\s*\(min-width:\s*80rem\)\s*\{[\s\S]*\.waka-page-header\s*\{[\s\S]*flex-direction:\s*row;[\s\S]*justify-content:\s*space-between;[\s\S]*\.waka-page-header-action\s*\{[\s\S]*width:\s*auto;[\s\S]*justify-content:\s*flex-end;/u,
  );
  assert.match(
    pageOutletSource,
    /joinClassNames\(\s*"flex w-full min-w-0 max-w-full flex-col waka-primary-section-stack",\s*bodyClassName,\s*\)/u,
  );
});

test("capture, workspace, and settings surfaces all use the new light-card contract", () => {
  const captureBarSource = readFileSync(WORKSPACE_CAPTURE_BAR_PATH, "utf8");
  const workspaceHomeSource = readFileSync(WORKSPACE_HOME_SCREEN_PATH, "utf8");
  const settingsPageSource = readFileSync(SETTINGS_PAGE_PATH, "utf8");
  const settingsApiKeysSource = readFileSync(
    SETTINGS_API_KEYS_CLIENT_PATH,
    "utf8",
  );

  assert.match(
    captureBarSource,
    /className="sticky top-4 z-20 overflow-hidden rounded-\[2rem\] border border-stone-200 bg-\[linear-gradient/u,
  );
  assert.match(captureBarSource, /aria-label="Capture note"/u);
  assert.match(
    captureBarSource,
    /Capture stays private until you share it/u,
  );

  assert.match(workspaceHomeSource, /data-section="recent-records"/u);
  assert.match(workspaceHomeSource, /data-section="record-detail"/u);
  assert.match(
    workspaceHomeSource,
    /className="hidden min-\[56rem\]:block waka-primary-section/u,
  );
  assert.match(workspaceHomeSource, /data-section="cluster-feed"/u);
  assert.match(workspaceHomeSource, /What changed/u);
  assert.doesNotMatch(workspaceHomeSource, /Always safe|Start rough/u);

  assert.match(
    settingsPageSource,
    /settingsCardClassName =\s*"waka-primary-section rounded-3xl border border-stone-200 bg-white/u,
  );
  assert.match(
    settingsApiKeysSource,
    /createApiKeyFormClassName =\s*"rounded-3xl border border-stone-200 bg-\[#fcfaf6\] p-5"/u,
  );
  assert.match(
    settingsApiKeysSource,
    /createApiKeySubmitButtonClassName =\s*"inline-flex min-h-11 w-full items-center justify-center rounded-full bg-stone-950/u,
  );
});
