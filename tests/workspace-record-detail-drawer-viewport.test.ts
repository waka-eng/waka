import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const WORKSPACE_HOME_SCREEN_PATH = path.join(
  process.cwd(),
  "apps/web/src/home/workspace-home-screen.tsx",
);

test("mobile record detail drawer uses the new light sheet and keeps close actions tappable", () => {
  const source = readFileSync(WORKSPACE_HOME_SCREEN_PATH, "utf8");

  assert.match(
    source,
    /const WORKSPACE_HOME_MOBILE_RECORD_DRAWER_HANDLE_BUTTON_CLASS_NAME =\s*"inline-flex min-h-11 w-full max-w-full items-center justify-center rounded-full px-4 py-2\.5 text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300\/70";/u,
  );
  assert.match(
    source,
    /const WORKSPACE_HOME_MOBILE_RECORD_DRAWER_CLOSE_BUTTON_CLASS_NAME =\s*"inline-flex min-h-11 w-full max-w-full items-center justify-center rounded-full border border-stone-200 bg-white/u,
  );
  assert.match(
    source,
    /const WORKSPACE_HOME_MOBILE_RECORD_DRAWER_FOOTER_ACTION_BUTTON_CLASS_NAME =\s*"inline-flex min-h-11 w-full items-center justify-center rounded-full border border-stone-200 bg-white/u,
  );
  assert.match(
    source,
    /data-record-detail-drawer="open"[\s\S]*className="relative min-w-0 overflow-hidden rounded-\[2rem\] border border-stone-200 bg-white shadow-\[0_24px_80px_rgba\(41,37,36,0\.18\)\]"/u,
  );
  assert.match(
    source,
    /data-record-detail-drawer-footer-action="close"[\s\S]*Close note/u,
  );
  assert.match(
    source,
    /data-record-detail-list-action=\{item\.id\}[\s\S]*Viewing detail" : "Open detail"/u,
  );
});
