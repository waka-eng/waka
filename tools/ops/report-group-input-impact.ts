/**
 * Explicit DB_CONNECTION_URL required; deliberately does not load .env files.
 * pnpm report:group-input-impact --group-id <uuid> [--limit 500]
 * Reports IDs/counts only. Never applies a repair or invokes a model.
 */
import postgres from "postgres";
import { buildGroupInputImpactReport } from "../../packages/api/src/lib/group-input-impact.js";

const args = process.argv.slice(2);
const groupId = args[0] === "--group-id" ? args[1] : undefined;
const limit = args.length === 2 ? 500 : args.length === 4 && args[2] === "--limit" ? Number(args[3]) : NaN;
if (!groupId || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(groupId) || !Number.isInteger(limit) || limit < 1 || limit > 1000) {
  throw new Error("Usage: --group-id <uuid> [--limit 1–1000]");
}
if (!process.env.DB_CONNECTION_URL) throw new Error("Set DB_CONNECTION_URL explicitly; no env file is loaded");
const client = postgres(process.env.DB_CONNECTION_URL, { max: 1, prepare: false });
try {
  console.log(JSON.stringify(await buildGroupInputImpactReport(client, groupId, limit), null, 2));
} finally {
  await client.end();
}
