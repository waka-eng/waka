/** Explicit, bounded shadow review. No dotenv loading and no mutation mode. */
import { parseArgs } from "node:util";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../src/db/index.js";
import { getDefaultModelProvider } from "../src/lib/model-provider.js";
import { reviewSignalSupport } from "../src/lib/signal-support-review.js";

const usage = "review-signal-support --owner-profile-id <uuid> --inspiration-id <uuid> --max-calls <0-10>";
const { values } = parseArgs({ options: {
  "owner-profile-id": { type: "string" },
  "inspiration-id": { type: "string" },
  // Still parsed so an old invocation fails with the reason, not "unknown option".
  "derive-into-profile-id": { type: "string" },
  "max-calls": { type: "string" },
  help: { type: "boolean" },
} });
if (values.help) {
  console.log(`${usage}\nRequires explicit DB_CONNECTION_URL. Uses a read-only connection. max-calls=0 invokes no model. Positive budgets can incur provider charges; agree a cost limit first. Reports contain IDs/hashes/verdicts, not text. No evidence is changed.`);
} else {
  const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
  const ownerProfileId = values["owner-profile-id"];
  const inspirationId = values["inspiration-id"];
  if (values["derive-into-profile-id"] !== undefined) {
    throw new Error("--derive-into-profile-id is gone: rooms were retired (2026-10-17), so support is reviewed on the owner's own profile only");
  }
  const rawCalls = values["max-calls"];
  if (!ownerProfileId || !uuid.test(ownerProfileId) || !inspirationId || !uuid.test(inspirationId) ||
    !rawCalls || !/^(10|[0-9])$/.test(rawCalls)) {
    throw new Error(usage);
  }
  if (!process.env.DB_CONNECTION_URL) throw new Error("Set DB_CONNECTION_URL explicitly; no env file is loaded");
  const client = postgres(process.env.DB_CONNECTION_URL, {
    max: 1, prepare: false, connection: { default_transaction_read_only: true },
  });
  try {
    const report = await reviewSignalSupport(drizzle(client, { schema }), {
      ownerProfileId, inspirationId, maxCalls: Number(rawCalls),
      provider: await getDefaultModelProvider(),
    });
    console.log(JSON.stringify(report, null, 2));
  } catch {
    // Database/provider diagnostics can include private text or a connection URL.
    console.error("Support review did not complete. Verify the explicit target, access, and schema; no repair was attempted.");
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}
