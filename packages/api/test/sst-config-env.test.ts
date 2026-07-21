import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sstConfig = readFileSync(resolve(__dirname, "../../../sst.config.ts"), "utf8");

describe("SST API admin route environment flags", () => {
  it("enables all non-secret admin route gates only for dev/development stages", () => {
    expect(sstConfig).toContain(
      'const isDevelopmentDomain = $app.stage === "development" || $app.stage === "dev";',
    );

    const devOnlyAdminFlags = sstConfig.match(
      /\.\.\.\(isDevelopmentDomain\s*\?\s*\{(?<body>[\s\S]*?)\}\s*:\s*\{\}\),/,
    );

    expect(devOnlyAdminFlags?.groups?.body).toEqual(
      expect.stringContaining('WAKA_ENABLE_ADMIN_ROUTES: "true"'),
    );
    expect(devOnlyAdminFlags?.groups?.body).toEqual(
      expect.stringContaining('WAKA_SHOW_INTERNAL_STATUS: "true"'),
    );
    expect(devOnlyAdminFlags?.groups?.body).toEqual(
      expect.stringContaining('WAKA_ENABLE_BACKGROUND_JOBS_ADMIN: "true"'),
    );
  });
});

describe("SST background job recovery schedule", () => {
  it("runs the production BackgroundJobDrain backstop every 12 hours", () => {
    const backgroundJobDrain = sstConfig.match(
      /new sst\.aws\.Cron\("BackgroundJobDrain", \{(?<body>[\s\S]*?)\n    \}\);/,
    );

    expect(backgroundJobDrain?.groups?.body).toEqual(
      expect.stringContaining('schedule: "rate(12 hours)"'),
    );
    expect(backgroundJobDrain?.groups?.body).toEqual(
      expect.stringContaining('enabled: $app.stage === "production"'),
    );
  });
});
