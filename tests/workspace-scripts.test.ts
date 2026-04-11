import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

type RootPackageManifest = {
  packageManager?: string;
  workspaces?: string[];
  scripts?: Record<string, string>;
};

type AppPackageManifest = {
  name?: string;
};

function readJsonFile<T>(relativePath: string): T {
  return JSON.parse(readFileSync(relativePath, "utf8")) as T;
}

test("root scripts target the web workspace through pnpm filters", () => {
  const rootPackage = readJsonFile<RootPackageManifest>("package.json");

  assert.equal(rootPackage.packageManager, "pnpm@10.30.1");
  assert.deepEqual(rootPackage.workspaces, ["apps/*", "packages/*"]);
  assert.equal(rootPackage.scripts?.dev, "node scripts/sst-dev.mjs");
  assert.equal(rootPackage.scripts?.["dev:sst"], "node scripts/sst-dev.mjs");
  assert.equal(rootPackage.scripts?.["dev:web"], "pnpm --filter @waka/web run dev");
  assert.equal(rootPackage.scripts?.build, "pnpm run build:web");
  assert.equal(rootPackage.scripts?.["build:web"], "pnpm --filter @waka/web run build");
  assert.equal(
    rootPackage.scripts?.test,
    "node scripts/run-standard-verification.ts --skip-typecheck",
  );
  assert.equal(rootPackage.scripts?.["test:node"], "node --test \"tests/*.test.ts\"");
  assert.equal(
    rootPackage.scripts?.["test:expected-load"],
    "node scripts/verify-end-to-end-enrichment-load.ts --output reports/end-to-end-enrichment-load-verification.json",
  );
  assert.equal(rootPackage.scripts?.typecheck, "pnpm run typecheck:web");
  assert.equal(
    rootPackage.scripts?.["typecheck:web"],
    "pnpm --filter @waka/web exec tsc --noEmit",
  );
  assert.equal(rootPackage.scripts?.verify, "node scripts/run-standard-verification.ts");
  assert.equal(
    rootPackage.scripts?.["verify:end-to-end-enrichment-load"],
    "node scripts/verify-end-to-end-enrichment-load.ts",
  );

  for (const script of Object.values(rootPackage.scripts ?? {})) {
    if (script === "node scripts/sst-dev.mjs") {
      continue;
    }

    assert.doesNotMatch(script, /npm --workspace/);
  }
});

test("pnpm workspace patterns and app package name stay aligned", () => {
  const workspaceConfig = readFileSync("pnpm-workspace.yaml", "utf8");
  const webPackage = readJsonFile<AppPackageManifest>("apps/web/package.json");

  assert.match(workspaceConfig, /^packages:\s*$/m);
  assert.match(workspaceConfig, /^\s*-\s+apps\/\*\s*$/m);
  assert.match(workspaceConfig, /^\s*-\s+packages\/\*\s*$/m);
  assert.equal(webPackage.name, "@waka/web");
});
