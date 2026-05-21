import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildSafeEvidence,
  resolveSignedInWowDetailConfig,
  textMatcher,
} from "../../../tools/e2e/wow-detail-signed-in-helpers";

const repoRoot = resolve(process.cwd(), "../..");

describe("signed-in WOW detail browser QA harness", () => {
  it("defaults to the monolithic local app URL and refuses non-loopback databases", () => {
    const config = resolveSignedInWowDetailConfig(
      {
        DB_CONNECTION_URL: "postgres://waka:secret@localhost:5432/waka",
      },
      { now: () => 1_700_000_000_000, randomHex: () => "abcdef1234567890abcdef1234567890" },
    );

    expect(config.webUrl).toBe("http://localhost:3010");
    expect(config.apiOrigin).toBe("http://localhost:3010");
    expect(config.email).toBe("waka-wow-detail-1700000000000-abcdef@example.test");
    expect(config.password).toHaveLength(32);
    expect(config.credentialsGenerated).toBe(true);
    expect(config.artifactDir).toBe(resolve(repoRoot, ".hermes/qa-artifacts/wow-detail-signed-in"));

    expect(() =>
      resolveSignedInWowDetailConfig({ DB_CONNECTION_URL: "postgres://waka:secret@db.example.com:5432/waka" }),
    ).toThrow(/Refusing to use non-local database host/);
  });

  it("requires provided QA email credentials as a pair without exposing the password", () => {
    expect(() =>
      resolveSignedInWowDetailConfig({
        DB_CONNECTION_URL: "postgres://waka:secret@127.0.0.1:5432/waka",
        WAKA_WOW_DETAIL_EMAIL: "qa@example.test",
      }),
    ).toThrow(/WAKA_WOW_DETAIL_EMAIL and WAKA_WOW_DETAIL_PASSWORD must be provided together/);

    const config = resolveSignedInWowDetailConfig({
      DB_CONNECTION_URL: "postgres://waka:secret@127.0.0.1:5432/waka",
      WAKA_WOW_DETAIL_EMAIL: "QA@Example.Test",
      WAKA_WOW_DETAIL_PASSWORD: "do-not-print-me",
      WAKA_WOW_DETAIL_WEB_URL: "http://localhost:3010/",
    });

    expect(config.email).toBe("qa@example.test");
    expect(config.credentialsGenerated).toBe(false);
    expect(buildSafeEvidence(config, { momentId: "moment-1", checks: ["Reflection mode"] })).toEqual({
      webUrl: "http://localhost:3010",
      apiOrigin: "http://localhost:3010",
      email: "qa@example.test",
      credentialsGenerated: false,
      momentId: "moment-1",
      checks: ["Reflection mode"],
    });
    expect(JSON.stringify(buildSafeEvidence(config, {}))).not.toContain("do-not-print-me");
    expect(JSON.stringify(buildSafeEvidence(config, {}))).not.toContain("postgres://");
  });

  it("ships a package script and docs for the signed-in browser path", () => {
    const rootPackage = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    const docs = readFileSync(resolve(repoRoot, "packages/web/QA_WOW_DETAIL.md"), "utf8");
    const harnessPath = resolve(repoRoot, "tools/e2e/wow-detail-signed-in.ts");

    expect(existsSync(harnessPath)).toBe(true);
    expect(rootPackage.scripts["qa:wow-detail:signed-in"]).toBe("tsx tools/e2e/wow-detail-signed-in.ts");
    expect(rootPackage.scripts["qa:wow-detail:signed-in:boot"]).toBe(
      'tsx tools/dev-stack/boot-and-wait.ts --boot-cmd "pnpm dev:local" --api-url http://localhost:3010 --web-url http://localhost:3010 -- pnpm tsx tools/e2e/wow-detail-signed-in.ts',
    );
    expect(rootPackage.scripts["qa:wow-detail:signed-in:boot"]).not.toContain("pnpm sst dev");
    expect(docs).toContain("qa:wow-detail:signed-in");
    expect(docs).toContain("starts `pnpm dev:local`");
    expect(docs).toContain("http://localhost:3010/api/health");
    expect(docs).toContain("does not require AWS credentials");
    expect(docs).toContain("WAKA_WOW_DETAIL_WEB_URL");
    expect(docs).toContain("local/loopback Postgres");
    expect(docs).toContain("does not print passwords, tokens, or database URLs");
    expect(docs).toContain("local `.hermes/qa-artifacts/`");
    expect(docs).toContain("keep these artifacts local/excluded from commits");

    const artifactDocLines = docs.split("\n").filter((line) => line.includes("qa-artifacts"));
    expect(artifactDocLines.every((line) => !line.includes("ignored"))).toBe(true);
  });

  it("matches the requested future-memory copy while tolerating the current local-preview labels", () => {
    expect(textMatcher(["Remember this about me?", "Save this as a future memory?"]).toString()).toContain(
      "Remember this about me",
    );
    expect(textMatcher(["Remember this", "Mark locally"]).test("Mark locally")).toBe(true);
  });
});
