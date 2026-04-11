import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const AUTHENTICATED_APP_ROUTE_ROOT_PATH = path.join(
  process.cwd(),
  "apps/web/app/(app)",
);
const AUTHENTICATED_APP_LAYOUT_PATH = path.join(
  process.cwd(),
  "apps/web/app/(app)/layout.tsx",
);
const WORKSPACE_CAPTURE_BAR_COMPONENT_PATH = path.join(
  process.cwd(),
  "apps/web/src/home/workspace-capture-bar.tsx",
);
const WORKSPACE_HOME_SHELL_CONTEXT_PATH = path.join(
  process.cwd(),
  "apps/web/src/home/workspace-home-shell-context.tsx",
);

function collectNamedFiles(directoryPath: string, fileName: string): string[] {
  const filePaths: string[] = [];

  for (const entry of readdirSync(directoryPath, { withFileTypes: true })) {
    const entryPath = path.join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      filePaths.push(...collectNamedFiles(entryPath, fileName));
      continue;
    }

    if (entry.isFile() && entry.name === fileName) {
      filePaths.push(entryPath);
    }
  }

  return filePaths.sort();
}

function toRepoRelativePath(filePath: string): string {
  return path.relative(process.cwd(), filePath).split(path.sep).join("/");
}

function resolveAuthenticatedRouteViewPath(pagePath: string): string {
  const source = readFileSync(pagePath, "utf8");
  const reExportMatch = source.match(
    /export\s+\{\s*[\w$]+\s+as\s+default\s*\}\s+from\s+["'](.+?)["'];?/u,
  );

  if (reExportMatch === null) {
    return pagePath;
  }

  return path.resolve(path.dirname(pagePath), reExportMatch[1]);
}

test("authenticated route navigation keeps partial capture drafts visible in the shared shell", () => {
  const authenticatedRouteLayoutPaths = collectNamedFiles(
    AUTHENTICATED_APP_ROUTE_ROOT_PATH,
    "layout.tsx",
  ).map(toRepoRelativePath);
  const authenticatedRoutePagePaths = collectNamedFiles(
    AUTHENTICATED_APP_ROUTE_ROOT_PATH,
    "page.tsx",
  );
  const resolvedViewPaths = Array.from(
    new Set(authenticatedRoutePagePaths.map(resolveAuthenticatedRouteViewPath)),
  ).sort();
  const layoutSource = readFileSync(AUTHENTICATED_APP_LAYOUT_PATH, "utf8");
  const captureBarSource = readFileSync(
    WORKSPACE_CAPTURE_BAR_COMPONENT_PATH,
    "utf8",
  );
  const shellContextSource = readFileSync(
    WORKSPACE_HOME_SHELL_CONTEXT_PATH,
    "utf8",
  );
  const providerIndex = layoutSource.indexOf("<WorkspaceHomeShellProvider>");
  const captureBarIndex = layoutSource.indexOf("<WorkspaceCaptureBar />");
  const mainIndex = layoutSource.indexOf("<main");
  const childrenIndex = layoutSource.indexOf("{children}");
  const createRequestIndex = captureBarSource.indexOf(
    "await createWorkspaceHomeTextCapture(submittedRawContent)",
  );
  const clearDraftIndex = captureBarSource.indexOf('setCaptureDraft("")');
  const catchIndex = captureBarSource.indexOf("} catch {");
  const draftResetMatches = captureBarSource.match(/setCaptureDraft\(""\)/gu) ?? [];

  assert.deepEqual(authenticatedRouteLayoutPaths, [
    "apps/web/app/(app)/layout.tsx",
  ]);
  assert.deepEqual(
    authenticatedRoutePagePaths.map(toRepoRelativePath),
    [
      "apps/web/app/(app)/dashboard/page.tsx",
      "apps/web/app/(app)/settings/page.tsx",
    ],
  );

  assert.notEqual(providerIndex, -1);
  assert.notEqual(captureBarIndex, -1);
  assert.notEqual(mainIndex, -1);
  assert.notEqual(childrenIndex, -1);
  assert.ok(providerIndex < captureBarIndex);
  assert.ok(captureBarIndex < mainIndex);
  assert.ok(mainIndex < childrenIndex);

  assert.match(
    shellContextSource,
    /const \[captureDraft, setCaptureDraft\] = useState\(""\);/u,
  );
  assert.match(
    shellContextSource,
    /captureDraft,[\s\S]*setCaptureDraft,[\s\S]*setClusterPreviews,[\s\S]*setSelectedRecordId,/u,
  );
  assert.match(
    captureBarSource,
    /onChange=\{\(event\) => setCaptureDraft\(event\.target\.value\)\}/u,
  );
  assert.match(captureBarSource, /value=\{captureDraft\}/u);
  assert.doesNotMatch(
    captureBarSource,
    /const \[captureDraft, setCaptureDraft\] = useState\(/u,
  );

  assert.equal(draftResetMatches.length, 1);
  assert.notEqual(createRequestIndex, -1);
  assert.notEqual(clearDraftIndex, -1);
  assert.notEqual(catchIndex, -1);
  assert.ok(createRequestIndex < clearDraftIndex);
  assert.ok(clearDraftIndex < catchIndex);

  for (const viewPath of resolvedViewPaths) {
    const viewSource = readFileSync(viewPath, "utf8");
    const relativeViewPath = toRepoRelativePath(viewPath);

    assert.match(
      viewSource,
      /AuthenticatedAppPageOutlet|<SettingsPage \/>/u,
      `${relativeViewPath} should stay inside the shared authenticated shell during route changes.`,
    );
    assert.doesNotMatch(
      viewSource,
      /const \[captureDraft, setCaptureDraft\] = useState\(|setCaptureDraft\(""\)|WorkspaceCaptureBar|WorkspaceHomeShellProvider/u,
      `${relativeViewPath} must not own or reset the shared capture draft.`,
    );
  }
});
