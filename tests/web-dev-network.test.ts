import assert from "node:assert/strict";
import test from "node:test";

import {
  applyDevServerNetwork,
  resolveDevServerNetwork,
} from "../scripts/web-dev-network.mjs";

test("web dev network keeps localhost as the public URL while binding all interfaces", () => {
  const network = resolveDevServerNetwork({
    APP_URL: "http://localhost:3000",
  });

  assert.deepEqual(network, {
    bindHost: "0.0.0.0",
    port: 3000,
    publicUrl: "http://localhost:3000",
  });
});

test("web dev network honors explicit host and port overrides", () => {
  const network = resolveDevServerNetwork({
    APP_URL: "http://localhost:3000",
    HOST: "127.0.0.1",
    PORT: "4010",
  });

  assert.deepEqual(network, {
    bindHost: "127.0.0.1",
    port: 4010,
    publicUrl: "http://localhost:4010",
  });
});

test("web dev runtime env syncs APP_URL, NEXTAUTH_URL, host, and port", () => {
  const runtimeEnv = applyDevServerNetwork({
    APP_URL: "http://localhost:3000",
  });

  assert.equal(runtimeEnv.APP_URL, "http://localhost:3000");
  assert.equal(runtimeEnv.NEXTAUTH_URL, "http://localhost:3000");
  assert.equal(runtimeEnv.HOST, "0.0.0.0");
  assert.equal(runtimeEnv.HOSTNAME, "0.0.0.0");
  assert.equal(runtimeEnv.PORT, "3000");
});

test("web dev runtime pins NEXTAUTH_URL to the resolved SST dev endpoint", () => {
  const runtimeEnv = applyDevServerNetwork({
    APP_URL: "http://localhost:3000",
    NEXTAUTH_URL: "http://localhost:3000",
    PORT: "4010",
  });

  assert.equal(runtimeEnv.APP_URL, "http://localhost:4010");
  assert.equal(runtimeEnv.NEXTAUTH_URL, "http://localhost:4010");
  assert.equal(runtimeEnv.PORT, "4010");
});

test("web dev network rejects malformed port overrides", () => {
  assert.throws(
    () =>
      resolveDevServerNetwork({
        APP_URL: "http://localhost:3000",
        PORT: "wat",
      }),
    /PORT must be an integer between 1 and 65535/,
  );
});
