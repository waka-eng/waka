import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  formatWorkspaceHomeDiscoveryClusterMovement,
  getWorkspaceHomeInitialSelectedRecordId,
  getWorkspaceHomeDiscoveryPreviewExcerpt,
  getWorkspaceHomeDiscoveryPreviewTitle,
  getWorkspaceHomeRecordDetail,
  getWorkspaceHomeScreenModel,
  WORKSPACE_HOME_CLUSTER_FEED_EMPTY_MESSAGE,
  WORKSPACE_HOME_CLUSTER_FEED_EMPTY_TITLE,
  WORKSPACE_HOME_SCREEN_ID,
} from "../apps/web/src/home/workspace-home-screen-model.ts";

const ROOT_PAGE_PATH = path.join(process.cwd(), "apps/web/app/page.tsx");
const AUTHENTICATED_APP_ROUTE_ROOT_PATH = path.join(
  process.cwd(),
  "apps/web/app/(app)",
);
const AUTH_SIGN_IN_PAGE_PATH = path.join(
  process.cwd(),
  "apps/web/app/auth/signin/page.tsx",
);
const LEGACY_INSIDE_SHELL_ROOT_PAGE_PATH = path.join(
  process.cwd(),
  "apps/web/app/(app)/page.tsx",
);
const DASHBOARD_PAGE_PATH = path.join(
  process.cwd(),
  "apps/web/app/(app)/dashboard/page.tsx",
);
const AUTHENTICATED_APP_LAYOUT_PATH = path.join(
  process.cwd(),
  "apps/web/app/(app)/layout.tsx",
);
const SETTINGS_PAGE_COMPONENT_PATH = path.join(
  process.cwd(),
  "apps/web/app/(app)/settings/settings-page.ts",
);
const AUTHENTICATED_APP_PAGE_OUTLET_PATH = path.join(
  process.cwd(),
  "apps/web/src/shell/authenticated-app-page-outlet.tsx",
);
const WORKSPACE_CAPTURE_BAR_COMPONENT_PATH = path.join(
  process.cwd(),
  "apps/web/src/home/workspace-capture-bar.tsx",
);
const WORKSPACE_HOME_SHELL_CONTEXT_PATH = path.join(
  process.cwd(),
  "apps/web/src/home/workspace-home-shell-context.tsx",
);
const WORKSPACE_HOME_SCREEN_COMPONENT_PATH = path.join(
  process.cwd(),
  "apps/web/src/home/workspace-home-screen.tsx",
);

function collectNamedFiles(
  directoryPath: string,
  fileName: string,
): string[] {
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

function collectRouteSourceFiles(directoryPath: string): string[] {
  const sourceFilePaths: string[] = [];

  for (const entry of readdirSync(directoryPath, { withFileTypes: true })) {
    const entryPath = path.join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      sourceFilePaths.push(...collectRouteSourceFiles(entryPath));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (
      entry.name.endsWith(".ts") === false &&
      entry.name.endsWith(".tsx") === false
    ) {
      continue;
    }

    sourceFilePaths.push(entryPath);
  }

  return sourceFilePaths.sort();
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

test("workspace launch screen model stays capture-first", () => {
  const model = getWorkspaceHomeScreenModel();

  assert.equal(model.screenId, WORKSPACE_HOME_SCREEN_ID);
  assert.match(model.title, /Pick up the idea/i);
  assert.match(model.description, /Capture quickly now/i);
  assert.ok(model.captureModes.includes("Text"));
  assert.ok(model.captureModes.includes("AI chat"));
  assert.equal(model.clusterPreviews.length > 0, true);
  assert.equal(model.discoveryPreviews.length > 0, true);
});

test("workspace launch screen model normalizes seeded cluster feed content when initial data is available", () => {
  const model = getWorkspaceHomeScreenModel({
    initialClusterData: [
      {
        id: "cluster-seeded",
        label: "Ambient inputs",
        description: "Ideas arriving from voice, CLI, and quick text capture.",
        inspirations: [
          {
            id: "insp-voice",
            title: "Voice memo about capture reliability",
            summary: "A note on keeping offline capture durable.",
            rawContent: "Capture must never silently drop a draft.",
            sourceType: "VOICE_NOTE",
          },
          {
            id: "insp-cli",
            rawContent: "CLI paste on linking related thoughts together",
            sourceType: "CLI_CONVERSATION",
            sourceParentId: "insp-voice",
          },
        ],
      },
    ],
  });

  assert.equal(model.clusterPreviews.length, 1);
  assert.deepEqual(model.clusterPreviews[0], {
    id: "cluster-seeded",
    itemCount: 2,
    items: [
      {
        id: "insp-voice",
        rawContent: "Capture must never silently drop a draft.",
        sourceType: "VOICE_NOTE",
        summary: "A note on keeping offline capture durable.",
        title: "Voice memo about capture reliability",
      },
      {
        id: "insp-cli",
        rawContent: "CLI paste on linking related thoughts together",
        sourceType: "CLI_CONVERSATION",
        sourceParentId: "insp-voice",
        title: "CLI paste on linking related thoughts together",
      },
    ],
    name: "Ambient inputs",
    summary: "Ideas arriving from voice, CLI, and quick text capture.",
  });
});

test("workspace launch screen model normalizes seeded discovery events into cluster movement cards", () => {
  const model = getWorkspaceHomeScreenModel({
    initialDiscoveries: [
      {
        createdAt: "2026-04-11T05:30:00.000Z",
        eventType: "CLUSTER_REASSIGNED",
        id: "evt-reassignment",
        inspiration: {
          id: "insp-1",
          rawContent: "Offline queues should survive reconnects without dropping text.",
          sourceType: "TEXT_NOTE",
          summary: "A reliable capture note moved into the resilience cluster.",
          title: "Offline durability",
        },
        newCluster: {
          description: "Fresh notes about durable queueing and retry behavior.",
          id: "cluster-resilience",
          label: "Capture resilience",
        },
        previousCluster: {
          description: "Older AI implementation notes.",
          id: "cluster-ai",
          label: "AI research",
        },
      },
    ],
  });

  assert.deepEqual(model.discoveryPreviews, [
    {
      createdAt: "2026-04-11T05:30:00.000Z",
      eventType: "CLUSTER_REASSIGNED",
      id: "evt-reassignment",
      inspiration: {
        id: "insp-1",
        rawContent: "Offline queues should survive reconnects without dropping text.",
        sourceType: "TEXT_NOTE",
        summary: "A reliable capture note moved into the resilience cluster.",
        title: "Offline durability",
      },
      newCluster: {
        description: "Fresh notes about durable queueing and retry behavior.",
        id: "cluster-resilience",
        label: "Capture resilience",
      },
      previousCluster: {
        description: "Older AI implementation notes.",
        id: "cluster-ai",
        label: "AI research",
      },
    },
  ]);
  assert.equal(
    getWorkspaceHomeDiscoveryPreviewTitle(model.discoveryPreviews[0]!),
    "Offline durability",
  );
  assert.equal(
    getWorkspaceHomeDiscoveryPreviewExcerpt(model.discoveryPreviews[0]!),
    "A reliable capture note moved into the resilience cluster.",
  );
  assert.equal(
    formatWorkspaceHomeDiscoveryClusterMovement(model.discoveryPreviews[0]!),
    "Now grouped with Capture resilience instead of AI research.",
  );
});

test("workspace launch discovery helpers fall back to cluster ids and raw content when labels or titles are missing", () => {
  const model = getWorkspaceHomeScreenModel({
    initialDiscoveries: [
      {
        createdAt: "2026-04-11T05:30:00.000Z",
        id: "evt-retired-cluster",
        inspiration: {
          id: "insp-2",
          rawContent: "A note that outgrew its original cluster.",
          sourceType: "TEXT_NOTE",
        },
        newCluster: {
          id: "cluster-active",
          label: "Active cluster",
        },
        previousCluster: {
          id: "cluster-retired",
        },
      },
    ],
  });

  assert.equal(
    getWorkspaceHomeDiscoveryPreviewTitle(model.discoveryPreviews[0]!),
    "A note that outgrew its original cluster.",
  );
  assert.equal(
    formatWorkspaceHomeDiscoveryClusterMovement(model.discoveryPreviews[0]!),
    "Now grouped with Active cluster instead of cluster-retired.",
  );
});

test("workspace launch screen detail helpers prefer a child record and resolve its source parent preview", () => {
  const model = getWorkspaceHomeScreenModel({
    initialClusterData: [
      {
        id: "cluster-lineage",
        label: "Lineage",
        inspirations: [
          {
            id: "insp-parent",
            title: "Original note",
            summary: "The first capture that started the thread.",
            rawContent: "Source parent content.",
            sourceType: "TEXT_NOTE",
          },
          {
            id: "insp-child",
            title: "Expanded note",
            summary: "A deepened follow-up.",
            rawContent: "Child content.",
            reflectionPrompt:
              "What did this follow-up clarify that the original capture missed?",
            reflectionStatus: "PROMPTED",
            sourceParentId: "insp-parent",
            sourceType: "TEXT_NOTE",
            tags: ["detail", "lineage"],
          },
        ],
      },
    ],
  });

  assert.equal(
    getWorkspaceHomeInitialSelectedRecordId(model.clusterPreviews),
    "insp-child",
  );
  assert.deepEqual(
    getWorkspaceHomeRecordDetail(model.clusterPreviews, "insp-child"),
    {
      id: "insp-child",
      rawContent: "Child content.",
      reflectionPrompt:
        "What did this follow-up clarify that the original capture missed?",
      reflectionStatus: "PROMPTED",
      sourceParent: {
        id: "insp-parent",
        summary: "The first capture that started the thread.",
        title: "Original note",
      },
      sourceType: "TEXT_NOTE",
      summary: "A deepened follow-up.",
      tags: ["detail", "lineage"],
      title: "Expanded note",
    },
  );
});

test("workspace launch screen model preserves an explicit empty cluster feed", () => {
  const model = getWorkspaceHomeScreenModel({
    initialClusterData: [],
  });

  assert.deepEqual(model.clusterPreviews, []);
});

test("root launch route renders a public landing page outside the authenticated shell", () => {
  const source = readFileSync(ROOT_PAGE_PATH, "utf8");

  assert.equal(existsSync(LEGACY_INSIDE_SHELL_ROOT_PAGE_PATH), false);
  assert.match(source, /PublicAuthShell/);
  assert.match(source, /Sign in with Google/);
  assert.doesNotMatch(
    source,
    /WorkspaceHomeScreen|WorkspaceCaptureBar|WorkspaceHomeShellProvider|authenticated-app-shell/u,
  );
});

test("dashboard route reuses the same workspace home screen", () => {
  const source = readFileSync(DASHBOARD_PAGE_PATH, "utf8");

  assert.match(source, /WorkspaceHomeScreen/);
  assert.doesNotMatch(source, /WorkspaceCaptureBar|min-h-screen|authenticated-app-shell/u);
});

test("authenticated routes keep the capture bar in the shared app layout only", () => {
  const authenticatedRouteLayoutPaths = collectNamedFiles(
    AUTHENTICATED_APP_ROUTE_ROOT_PATH,
    "layout.tsx",
  );
  const authenticatedRoutePagePaths = collectNamedFiles(
    AUTHENTICATED_APP_ROUTE_ROOT_PATH,
    "page.tsx",
  );
  const authenticatedRouteSourcePaths = collectRouteSourceFiles(
    AUTHENTICATED_APP_ROUTE_ROOT_PATH,
  );
  const captureBarOwnerPaths = authenticatedRouteSourcePaths
    .filter((sourcePath) =>
      readFileSync(sourcePath, "utf8").includes("WorkspaceCaptureBar"),
    )
    .map(toRepoRelativePath);
  const resolvedViewPaths = Array.from(
    new Set(authenticatedRoutePagePaths.map(resolveAuthenticatedRouteViewPath)),
  ).sort();

  assert.deepEqual(
    authenticatedRouteLayoutPaths.map(toRepoRelativePath),
    ["apps/web/app/(app)/layout.tsx"],
  );
  assert.deepEqual(captureBarOwnerPaths, ["apps/web/app/(app)/layout.tsx"]);
  assert.deepEqual(
    authenticatedRoutePagePaths.map(toRepoRelativePath),
    [
      "apps/web/app/(app)/dashboard/page.tsx",
      "apps/web/app/(app)/settings/page.tsx",
    ],
  );

  for (const viewPath of resolvedViewPaths) {
    const source = readFileSync(viewPath, "utf8");
    const relativeViewPath = toRepoRelativePath(viewPath);

    assert.match(
      source,
      /AuthenticatedAppPageOutlet|SettingsPage/u,
      `${relativeViewPath} should resolve into the shared authenticated page outlet.`,
    );
    assert.doesNotMatch(
      source,
      /WorkspaceCaptureBar|WorkspaceHomeShellProvider|AuthenticatedAppNavigation|data-layout="authenticated-app-shell"|data-layout="authenticated-app-content"/u,
      `${relativeViewPath} must rely on the shared authenticated app shell for capture-bar ownership.`,
    );
  }
});

test("authenticated app shell owns the shared capture bar and page content slot", () => {
  const layoutSource = readFileSync(AUTHENTICATED_APP_LAYOUT_PATH, "utf8");
  const settingsSource = readFileSync(SETTINGS_PAGE_COMPONENT_PATH, "utf8");
  const pageOutletSource = readFileSync(
    AUTHENTICATED_APP_PAGE_OUTLET_PATH,
    "utf8",
  );
  const captureBarSource = readFileSync(
    WORKSPACE_CAPTURE_BAR_COMPONENT_PATH,
    "utf8",
  );
  const shellContextSource = readFileSync(
    WORKSPACE_HOME_SHELL_CONTEXT_PATH,
    "utf8",
  );
  const screenSource = readFileSync(WORKSPACE_HOME_SCREEN_COMPONENT_PATH, "utf8");
  const shellIndex = layoutSource.indexOf('data-layout="authenticated-app-shell"');
  const captureBarLayoutIndex = layoutSource.indexOf("<WorkspaceCaptureBar");
  const contentSlotIndex = layoutSource.indexOf(
    'data-layout="authenticated-app-content"',
  );
  const childrenIndex = layoutSource.indexOf("{children}");
  const workspaceContentIndex = screenSource.indexOf(
    'data-layout="workspace-home-content"',
  );
  const captureStackIndex = screenSource.indexOf('data-layout="capture-feed-stack"');
  const clusterFeedSectionIndex = screenSource.indexOf('data-section="cluster-feed"');
  const clusterFeedIndex = screenSource.indexOf("Cluster Feed");
  const asideIndex = screenSource.indexOf("<aside");

  assert.notEqual(shellIndex, -1);
  assert.notEqual(captureBarLayoutIndex, -1);
  assert.notEqual(contentSlotIndex, -1);
  assert.notEqual(childrenIndex, -1);
  assert.ok(captureBarLayoutIndex < childrenIndex);
  assert.ok(contentSlotIndex < childrenIndex);
  assert.match(layoutSource, /WorkspaceHomeShellProvider/);
  assert.match(layoutSource, /AuthenticatedAppNavigation/);
  assert.doesNotMatch(layoutSource, /h-dvh|pt-10|mt-10/u);
  assert.match(captureBarSource, /id="workspace-capture"/);
  assert.match(captureBarSource, /<textarea/);
  assert.match(captureBarSource, /autoFocus/);
  assert.match(captureBarSource, /aria-label="Capture note"/);
  assert.match(captureBarSource, /useWorkspaceHomeShellState/);
  assert.doesNotMatch(
    captureBarSource,
    /captureModes\?:|capturePlaceholder\?:|capturePromises\?:|description\?:|eyebrow\?:|setClusterPreviews\?:|setSelectedRecordId\?:|title\?:/u,
  );
  assert.doesNotMatch(
    captureBarSource,
    /requires workspace shell state or explicit handlers/u,
  );
  assert.doesNotMatch(captureBarSource, /shellState\?\./u);
  assert.doesNotMatch(shellContextSource, /modelOptions/u);
  assert.doesNotMatch(
    shellContextSource,
    /captureModes|capturePlaceholder|capturePromises|description|discoveryPreviews|screenId|title/u,
  );
  assert.match(
    shellContextSource,
    /WorkspaceHomeShellProvider is required for authenticated workspace views\./u,
  );
  assert.match(screenSource, /useWorkspaceHomeShellState/);
  assert.doesNotMatch(
    screenSource,
    /localClusterPreviews|localSelectedRecordId|shellState\?\./u,
  );
  assert.doesNotMatch(
    screenSource,
    /WorkspaceCaptureBar|AuthenticatedAppPageOutlet|AuthenticatedAppShellFrame/u,
  );
  assert.doesNotMatch(pageOutletSource, /overflow-y-auto|scrollClassName|py-10/u);
  assert.notEqual(workspaceContentIndex, -1);
  assert.notEqual(captureStackIndex, -1);
  assert.notEqual(clusterFeedSectionIndex, -1);
  assert.notEqual(asideIndex, -1);
  assert.match(settingsSource, /"data-layout": "settings-content"/u);
  assert.doesNotMatch(settingsSource, /WorkspaceCaptureBar|min-h-screen|mx-auto|max-w-5xl/u);
  assert.ok(captureStackIndex < clusterFeedSectionIndex);
  assert.ok(clusterFeedSectionIndex < asideIndex);
});

test("public auth routes never import the authenticated capture shell", () => {
  const rootSource = readFileSync(ROOT_PAGE_PATH, "utf8");
  const signInSource = readFileSync(AUTH_SIGN_IN_PAGE_PATH, "utf8");

  assert.match(signInSource, /PublicAuthShell/);
  assert.match(signInSource, /Continue with Google/);

  for (const source of [rootSource, signInSource]) {
    assert.doesNotMatch(
      source,
      /WorkspaceCaptureBar|WorkspaceHomeShellProvider|AuthenticatedAppPageOutlet|authenticated-app-shell/u,
    );
  }
});

test("authenticated app shell provider owns the shared capture draft state", () => {
  const captureBarSource = readFileSync(
    WORKSPACE_CAPTURE_BAR_COMPONENT_PATH,
    "utf8",
  );
  const shellContextSource = readFileSync(
    WORKSPACE_HOME_SHELL_CONTEXT_PATH,
    "utf8",
  );

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
    /const \{\s*captureDraft,\s*setCaptureDraft,\s*setClusterPreviews: resolvedSetClusterPreviews,\s*setSelectedRecordId: resolvedSetSelectedRecordId,\s*\} = useWorkspaceHomeShellState\(\);/u,
  );
  assert.doesNotMatch(
    captureBarSource,
    /const \[captureDraft, setCaptureDraft\] = useState\(/u,
  );
  assert.match(captureBarSource, /setCaptureDraft\(""\);/u);
});

test("workspace shell boots with an empty feed and only hydrates seeded clusters when explicit data is provided", () => {
  const shellContextSource = readFileSync(
    WORKSPACE_HOME_SHELL_CONTEXT_PATH,
    "utf8",
  );
  const screenSource = readFileSync(WORKSPACE_HOME_SCREEN_COMPONENT_PATH, "utf8");

  assert.match(
    shellContextSource,
    /const \[clusterPreviews, setClusterPreviews\] = useState<[\s\S]*>\(\[\]\);/u,
  );
  assert.match(
    shellContextSource,
    /const \[selectedRecordId, setSelectedRecordId\] = useState<string \| undefined>\(\);/u,
  );
  assert.doesNotMatch(shellContextSource, /WORKSPACE_HOME_CLUSTER_PREVIEWS/u);
  assert.match(
    screenSource,
    /props\.initialClusterData !== undefined \|\|[\s\S]*props\.initialClusterFeed !== undefined \|\|[\s\S]*props\.initialClusterPreviews !== undefined/u,
  );
  assert.match(screenSource, /setClusterPreviews\(model\.clusterPreviews\);/u);
  assert.doesNotMatch(
    screenSource,
    /getWorkspaceHomeInitialSelectedRecordId\(model\.clusterPreviews\)/u,
  );
});

test("workspace launch screen includes seeded cluster feed entry rendering hooks", () => {
  const source = readFileSync(WORKSPACE_HOME_SCREEN_COMPONENT_PATH, "utf8");

  assert.match(source, /data-cluster-content="seeded"/);
  assert.match(source, /cluster\.items \?\? \[\]/);
  assert.match(source, /recentRecords\.map/);
  assert.match(source, /formatClusterItemSource/);
  assert.match(source, /data-cluster-item-id/);
  assert.match(source, /data-selected-record-id/);
  assert.match(source, /handleRecordDetailSelection\(item\.id!\)/);
});

test("workspace launch screen includes discovery feed hooks for cluster reassignment entries", () => {
  const source = readFileSync(WORKSPACE_HOME_SCREEN_COMPONENT_PATH, "utf8");

  assert.match(source, /data-discovery-event-type=\{item\.eventType\}/u);
  assert.match(source, /Cluster reassigned/u);
  assert.match(source, /formatWorkspaceHomeDiscoveryClusterMovement\(item\)/u);
  assert.match(source, /getWorkspaceHomeDiscoveryPreviewTitle\(item\)/u);
  assert.match(source, /getWorkspaceHomeDiscoveryPreviewExcerpt\(item\)/u);
});

test("workspace launch screen includes a cluster feed empty state placeholder", () => {
  const source = readFileSync(WORKSPACE_HOME_SCREEN_COMPONENT_PATH, "utf8");

  assert.match(source, /data-cluster-feed-empty-state="true"/);
  assert.match(source, /clusterPreviews\.length > 0/);
  assert.match(source, /WORKSPACE_HOME_CLUSTER_FEED_EMPTY_TITLE/);
  assert.match(source, /WORKSPACE_HOME_CLUSTER_FEED_EMPTY_MESSAGE/);
  assert.equal(WORKSPACE_HOME_CLUSTER_FEED_EMPTY_TITLE, "Nothing saved yet");
  assert.match(
    WORKSPACE_HOME_CLUSTER_FEED_EMPTY_MESSAGE,
    /Save one thought and it will land here first/i,
  );
});

test("workspace launch screen renders a record detail panel with source parent navigation hooks", () => {
  const source = readFileSync(WORKSPACE_HOME_SCREEN_COMPONENT_PATH, "utf8");

  assert.match(source, /data-section="record-detail"/);
  assert.match(source, /data-record-detail-reflection=/);
  assert.match(source, /Something to think about/);
  assert.match(source, /Open earlier note/);
  assert.match(source, /data-source-parent-id/);
  assert.match(
    source,
    /handleRecordDetailSelection\(selectedRecordDetail\.sourceParent!\.id\)/,
  );
});
