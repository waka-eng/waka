import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_APP_STAGE,
  DEFAULT_APP_URL,
  DEFAULT_AWS_REGION,
  DEFAULT_LOCAL_DEV_BIND_HOST,
  DEFAULT_LOCAL_DEV_PORT,
  resolveAppStage,
  resolveAppUrl,
  resolveLocalDevHost,
  resolveLocalDevPort,
  resolveLocalDevUrl,
  resolveAwsRegion,
  resolveWakaSstAppConfig,
} from "../infra/app-config.ts";

test("SST app config falls back to dev-friendly defaults", () => {
  const config = resolveWakaSstAppConfig({});

  assert.equal(config.name, "waka");
  assert.equal(config.home, "aws");
  assert.equal(config.stage, DEFAULT_APP_STAGE);
  assert.equal(config.region, DEFAULT_AWS_REGION);
  assert.equal(config.appUrl, DEFAULT_APP_URL);
  assert.equal(config.localDevUrl, DEFAULT_APP_URL);
  assert.equal(config.localDevHost, DEFAULT_LOCAL_DEV_BIND_HOST);
  assert.equal(config.localDevPort, DEFAULT_LOCAL_DEV_PORT);
  assert.equal(config.removal, "remove");
});

test("SST app config keeps production resources and requires a secure origin", () => {
  const config = resolveWakaSstAppConfig(
    {
      AWS_REGION: "ap-northeast-2",
      APP_URL: "https://waka.app",
    },
    "production",
  );

  assert.equal(config.stage, "production");
  assert.equal(config.region, "ap-northeast-2");
  assert.equal(config.appUrl, "https://waka.app");
  assert.equal(config.removal, "retain");
});

test("stage defaults only when omitted", () => {
  assert.equal(resolveAppStage(undefined), DEFAULT_APP_STAGE);
  assert.equal(resolveAppStage("staging"), "staging");
  assert.throws(
    () => resolveAppStage("release candidate"),
    /must contain only letters, numbers, and hyphens/,
  );
});

test("AWS region validation fails fast on malformed values", () => {
  assert.equal(resolveAwsRegion({ AWS_REGION: "us-east-1" }), "us-east-1");
  assert.throws(
    () => resolveAwsRegion({ AWS_REGION: "not-a-region" }),
    /is not a valid AWS region/,
  );
});

test("APP_URL is normalized to its origin", () => {
  assert.equal(resolveAppUrl({ APP_URL: "https://waka.app/" }), "https://waka.app");
  assert.equal(resolveAppUrl({ APP_URL: "http://localhost:3000/" }), "http://localhost:3000");
});

test("local dev networking stays reachable while keeping a stable public URL", () => {
  const env = {
    APP_URL: "http://localhost:3000",
  };

  assert.equal(resolveLocalDevUrl(env), "http://localhost:3000");
  assert.equal(resolveLocalDevHost(env), "0.0.0.0");
  assert.equal(resolveLocalDevPort(env), 3000);
});

test("local dev networking honors explicit port overrides", () => {
  const env = {
    APP_URL: "http://localhost:3000",
    PORT: "4010",
    HOST: "127.0.0.1",
  };

  assert.equal(resolveLocalDevUrl(env), "http://localhost:4010");
  assert.equal(resolveLocalDevHost(env), "127.0.0.1");
  assert.equal(resolveLocalDevPort(env), 4010);
});

test("APP_URL rejects unsupported deployment values", () => {
  assert.throws(
    () => resolveAppUrl({ APP_URL: "waka.app" }),
    /must be a valid absolute URL/,
  );
  assert.throws(
    () => resolveAppUrl({ APP_URL: "ftp://waka.app" }),
    /must use http or https/,
  );
  assert.throws(
    () => resolveAppUrl({ APP_URL: "https://waka.app/dashboard" }),
    /must be an origin without a path, query, or hash/,
  );
  assert.throws(
    () => resolveAppUrl({ APP_URL: "http://waka.app" }, "production"),
    /must use https for the production stage/,
  );
  assert.throws(
    () => resolveLocalDevPort({ PORT: "wat" }),
    /PORT must be an integer between 1 and 65535/,
  );
});
