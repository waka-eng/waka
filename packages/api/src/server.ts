import { serve } from "@hono/node-server";
import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";

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

const port = Number(process.env.PORT ?? 3001);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[api] http://localhost:${info.port}`);
});
