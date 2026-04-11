import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const WEB_APP_ROOT = path.join(process.cwd(), "apps/web");
const PUBLIC_AUTH_SHELL_PATH = path.join(
  WEB_APP_ROOT,
  "src/auth/public-auth-shell.tsx",
);
const WORKSPACE_CAPTURE_BAR_PATH = path.join(
  WEB_APP_ROOT,
  "src/home/workspace-capture-bar.tsx",
);

test("mobile actions and sticky capture entry stay readable in the new light shell", () => {
  const publicAuthShellSource = readFileSync(PUBLIC_AUTH_SHELL_PATH, "utf8");
  const captureBarSource = readFileSync(WORKSPACE_CAPTURE_BAR_PATH, "utf8");

  assert.match(
    publicAuthShellSource,
    /className="flex w-full flex-col items-stretch gap-3 min-\[56rem\]:flex-row min-\[56rem\]:flex-wrap min-\[56rem\]:items-center"/u,
  );
  assert.match(
    publicAuthShellSource,
    /rounded-full bg-stone-950 px-4 py-2\.5 text-center text-sm font-semibold/u,
  );
  assert.match(
    publicAuthShellSource,
    /rounded-full border border-stone-300 bg-white px-4 py-2\.5 text-center text-sm font-semibold/u,
  );

  assert.match(
    captureBarSource,
    /const WORKSPACE_CAPTURE_BAR_CONTROL_BUTTON_CLASS_NAME =\s*"inline-flex min-h-11 w-full max-w-full items-center justify-center gap-2\.5 rounded-full border px-4 py-2\.5 text-center text-sm font-medium leading-5 whitespace-normal break-words transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-\[#f5efe6\] md:min-h-12 md:w-auto md:justify-start md:gap-3 md:py-3 md:text-left";/u,
  );
  assert.match(
    captureBarSource,
    /className="sticky top-4 z-20 overflow-hidden rounded-\[2rem\] border border-stone-200 bg-\[linear-gradient/u,
  );
  assert.match(
    captureBarSource,
    /className="mt-3 flex min-w-0 flex-col gap-3 rounded-\[1\.5rem\] border border-stone-200 bg-white p-3/u,
  );
  assert.match(
    captureBarSource,
    /className="min-h-24 w-full min-w-0 max-w-full flex-1 resize-none rounded-\[1\.25rem\] border border-stone-200 bg-\[#fcfaf6\]/u,
  );
  assert.match(
    captureBarSource,
    /className="inline-flex min-h-11 w-full shrink-0 items-center justify-center rounded-full bg-stone-950/u,
  );
});
