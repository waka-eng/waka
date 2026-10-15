import { serve } from "@hono/node-server";
import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";

import { createLocalWebApp, defaultWebDistDir } from "./local-web.js";

const dotenvPath = process.env.WAKA_API_DOTENV_PATH ?? resolve(process.cwd(), "../../.env");
loadDotenv({ path: dotenvPath });

if (process.env.AWS_ACCESS_KEY_ID_APP && !process.env.AWS_ACCESS_KEY_ID) {
  process.env.AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID_APP;
}
if (process.env.AWS_SECRET_ACCESS_KEY_APP && !process.env.AWS_SECRET_ACCESS_KEY) {
  process.env.AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY_APP;
}
if (process.env.AWS_REGION_APP && !process.env.AWS_REGION) {
  process.env.AWS_REGION = process.env.AWS_REGION_APP;
}

if (!process.env.PUBLIC_WEB_URL) process.env.PUBLIC_WEB_URL = "http://localhost:5173";
if (!process.env.PUBLIC_API_URL) process.env.PUBLIC_API_URL = "http://localhost:3001";

const { app } = await import("./index.js");
const fetchApp =
  process.env.WAKA_SERVE_WEB_DIST === "1"
    ? createLocalWebApp(app, process.env.WAKA_WEB_DIST_DIR ?? defaultWebDistDir())
    : app;

/*
 * NOTHING RUNS AT BOOT ANY MORE, AND THAT IS THE CHANGE.
 *
 * `ensureGroupMinds()` ran here until 2026-10-15. It gave every room that
 * predated 2026-08-24 the account-less `type = 'group'` profile that newer
 * rooms were born with — work that physically could not live in migration
 * 0025, because writing a row whose `type` is 'group' resolves an enum value
 * 0024 added in the same uncommitted transaction and PostgreSQL refuses. A
 * separate transaction was the only fix and startup was the honest place for
 * it.
 *
 * Founder: "방 없애". No room can be created now, so no room can be born
 * mindless, so there is nothing for a boot-time backfill to find. It is NOT
 * kept "just in case": it was a single `INSERT ... SELECT ... WHERE NOT
 * EXISTS` over `groups`, and running it on every boot forever to repair a
 * population that cannot grow is a startup cost paid to a dead feature.
 *
 * THE ROWS IT ALREADY WROTE STAY. Every mind it ever created is still in
 * `profiles`, still joined to its room by `group_id`, and still cascades
 * with that room. Nothing here deletes one, and no migration is written —
 * same ruling as the five tables.
 */

const port = Number(process.env.PORT ?? 3001);
/**
 * LOOPBACK, SPELLED AS AN ADDRESS RATHER THAN A NAME.
 *
 * Serving the built web app means this process is the whole product, so it
 * binds to loopback only: a dev server reachable from the café wifi is a
 * person's entire archive reachable from the café wifi. That part was always
 * right. The NAME was not.
 *
 * `localhost` is a resolution, and which family it resolves to first is a
 * property of the machine. On this repo's dev containers it is 127.0.0.1, so
 * the stack came up and every gate passed. On a GitHub runner it is `::1`,
 * so the server bound IPv6-only and every probe in CI — all of which use
 * 127.0.0.1 — was refused for two minutes until the wait step gave up. The
 * browser gates have therefore never run in CI, and the log said so in one
 * line nobody read: `[api] http://::1:3010`.
 *
 * An address cannot be resolved into the wrong family. Clients that ask for
 * `localhost` still arrive: browsers and Node both fall back to the other
 * family when the first is refused.
 */
const hostname = process.env.WAKA_SERVE_WEB_DIST === "1" ? "127.0.0.1" : undefined;
serve({ fetch: fetchApp.fetch, port, ...(hostname ? { hostname } : {}) }, (info) => {
  console.log(`[api] http://${info.address}:${info.port}`);
});
