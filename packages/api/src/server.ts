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

/**
 * Rooms that predate the room's mind get one now.
 *
 * The mind is written with the room from 2026-08-24 on; older rooms were
 * meant to be settled by migration 0025, and cannot be — writing a row whose
 * `type` is 'group' resolves an enum value added in that same uncommitted
 * transaction, which PostgreSQL refuses. A separate transaction is the only
 * fix, and startup is the honest place for it: idempotent, cheap, and never
 * on an operator's checklist.
 *
 * It must not stop the server. A room without a mind reads as a room with
 * nothing on its wall, which is recoverable on the next boot; an API that
 * refuses to start is not.
 */
const { ensureGroupMinds } = await import("./routes/groups-membership.js");
await ensureGroupMinds().catch((err: unknown) => {
  console.error(
    "[api] could not give older rooms their minds:",
    err instanceof Error ? err.message : String(err),
  );
});

const port = Number(process.env.PORT ?? 3001);
const hostname = process.env.WAKA_SERVE_WEB_DIST === "1" ? "localhost" : undefined;
serve({ fetch: fetchApp.fetch, port, ...(hostname ? { hostname } : {}) }, (info) => {
  console.log(`[api] http://${info.address}:${info.port}`);
});
