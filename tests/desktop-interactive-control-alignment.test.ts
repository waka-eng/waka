import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const WEB_APP_ROOT = path.join(process.cwd(), "apps/web");
const WORKSPACE_CAPTURE_BAR_PATH = path.join(
  WEB_APP_ROOT,
  "src/home/workspace-capture-bar.tsx",
);
const WORKSPACE_HOME_SCREEN_PATH = path.join(
  WEB_APP_ROOT,
  "src/home/workspace-home-screen.tsx",
);
const SETTINGS_API_KEYS_CLIENT_PATH = path.join(
  WEB_APP_ROOT,
  "app/(app)/settings/settings-api-keys-client.tsx",
);
const AUTHENTICATED_APP_NAVIGATION_PATH = path.join(
  WEB_APP_ROOT,
  "src/shell/authenticated-app-navigation.tsx",
);
const STABLE_CONTROL_LABEL_PATH = path.join(
  WEB_APP_ROOT,
  "src/ui/stable-control-label.tsx",
);

const STATE_GEOMETRY_MUTATOR_PATTERN =
  /\b(?:hover|focus|focus-visible|active|disabled|aria-[^:\s]+|data-[^:\s]+):(?:border(?=\s|$)|border-[02468]\b|min-h-[^\s]+|h-[^\s]+|w-[^\s]+|max-w-[^\s]+|min-w-[^\s]+|px-[^\s]+|py-[^\s]+|p[trblxy]?-[^\s]+|m[trblxy]?-[^\s]+|gap-[^\s]+|justify-[^\s]+|items-[^\s]+|rounded[^\s]*|text-(?:left|center|right|xs|sm|base|lg|xl|\[[^\]]+\])|leading-[^\s]+|tracking-[^\s]+|font-[^\s]+|translate-[^\s]+|scale-[^\s]+|rotate-[^\s]+|grid-cols-[^\s]+|col-span-[^\s]+|row-span-[^\s]+)/u;

function extractConstString(source: string, constName: string): string {
  const escapedConstName = constName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = source.match(
    new RegExp(`const ${escapedConstName} =\\s*"([^"]+)";`, "u"),
  );

  assert.ok(match, `Expected ${constName} to be declared as a string constant.`);

  return match[1]!;
}

test("desktop controls still use StableControlLabel to keep button widths from jumping", () => {
  const stableControlLabelSource = readFileSync(STABLE_CONTROL_LABEL_PATH, "utf8");
  const captureBarSource = readFileSync(WORKSPACE_CAPTURE_BAR_PATH, "utf8");
  const workspaceHomeSource = readFileSync(WORKSPACE_HOME_SCREEN_PATH, "utf8");
  const settingsSource = readFileSync(SETTINGS_API_KEYS_CLIENT_PATH, "utf8");

  assert.match(
    stableControlLabelSource,
    /<span className="inline-grid">[\s\S]*aria-hidden="true" className="invisible col-start-1 row-start-1"[\s\S]*className="col-start-1 row-start-1"/u,
  );
  assert.match(
    captureBarSource,
    /data-voice-capture-toggle=\{voiceCaptureState\.status\}[\s\S]*widestLabel="Stop recording"/u,
  );
  assert.match(
    captureBarSource,
    /data-capture-submit-state=\{isSubmittingCapture \? "saving" : "idle"\}[\s\S]*widestLabel="Save note"/u,
  );
  assert.match(
    workspaceHomeSource,
    /data-ai-field-retry-action=\{field\.fieldName\}[\s\S]*widestLabel="Try again"/u,
  );
  assert.match(
    workspaceHomeSource,
    /data-record-detail-list-action=\{item\.id\}[\s\S]*widestLabel="Viewing detail"/u,
  );
  assert.match(
    settingsSource,
    /widestLabel=\{SETTINGS_API_KEYS_CREATE_FORM_SUBMIT_PENDING_LABEL\}/u,
  );
  assert.match(
    settingsSource,
    /widestLabel=\{SETTINGS_API_KEYS_REVOKE_ACTION_PENDING_LABEL\}/u,
  );
});

test("desktop interactive primitives only swap visual tokens across states", () => {
  const captureBarSource = readFileSync(WORKSPACE_CAPTURE_BAR_PATH, "utf8");
  const workspaceHomeSource = readFileSync(WORKSPACE_HOME_SCREEN_PATH, "utf8");
  const settingsSource = readFileSync(SETTINGS_API_KEYS_CLIENT_PATH, "utf8");
  const navigationSource = readFileSync(
    AUTHENTICATED_APP_NAVIGATION_PATH,
    "utf8",
  );

  const classNamesToProtect = [
    extractConstString(
      captureBarSource,
      "WORKSPACE_CAPTURE_BAR_CONTROL_BUTTON_CLASS_NAME",
    ),
    extractConstString(
      captureBarSource,
      "WORKSPACE_CAPTURE_BAR_INLINE_ACTION_BUTTON_CLASS_NAME",
    ),
    extractConstString(
      workspaceHomeSource,
      "WORKSPACE_HOME_INLINE_ACTION_BUTTON_CLASS_NAME",
    ),
    extractConstString(settingsSource, "createApiKeyInputClassName"),
    extractConstString(settingsSource, "createApiKeySubmitButtonClassName"),
    extractConstString(settingsSource, "revokeApiKeyButtonClassName"),
  ];

  for (const className of classNamesToProtect) {
    assert.doesNotMatch(className, STATE_GEOMETRY_MUTATOR_PATTERN);
  }

  assert.match(
    navigationSource,
    /rounded-full border text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300\/70/u,
  );
});
