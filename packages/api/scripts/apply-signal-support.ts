/** Applies exactly one reviewed metadata report; never loads dotenv or calls a model. */
import { readFileSync, statSync } from "node:fs";
import { parseArgs } from "node:util";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../src/db/index.js";
import { applySignalSupportReview } from "../src/lib/signal-support-apply.js";

const usage = "apply-signal-support --report <json-file> --review-id <uuid> --profile-id <uuid>";
const { values } = parseArgs({ options: {
  report: { type: "string" }, "review-id": { type: "string" }, "profile-id": { type: "string" }, help: { type: "boolean" },
} });
if (values.help) {
  console.log(`${usage}\nRequires explicit DB_CONNECTION_URL and a reviewed report for the named profile/review. Changes evidence and standing and persists refresh work atomically. Stale reports are rejected. No model calls. Never run against an unverified deployment target.`);
} else {
  if (!values.report || !values["review-id"] || !values["profile-id"]) throw new Error(usage);
  if (!process.env.DB_CONNECTION_URL) throw new Error("Set DB_CONNECTION_URL explicitly; no env file is loaded");
  if (statSync(values.report).size > 2_000_000) throw new Error("Report exceeds the size limit");
  const report = JSON.parse(readFileSync(values.report, "utf8")) as Record<string, unknown>;
  if (report.reviewId !== values["review-id"] || report.profileId !== values["profile-id"]) throw new Error("Report does not match the explicitly named review and profile");
  const client = postgres(process.env.DB_CONNECTION_URL, { max: 1, prepare: false });
  try {
    console.log(JSON.stringify(await applySignalSupportReview(drizzle(client, { schema }), report), null, 2));
  } catch {
    console.error("Support review completion could not be confirmed. Verify the target and report. Reapplying the same review ID safely reconciles an ambiguous connection failure; stale inputs require a new review.");
    process.exitCode = 1;
  } finally { await client.end(); }
}
