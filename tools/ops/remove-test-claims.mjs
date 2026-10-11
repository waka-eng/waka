#!/usr/bin/env node
/**
 * THE THREE TEST CLAIMS, REMOVED.
 *
 * Founder: "show claim as test data so i can test it." Their queue was
 * legitimately empty — all eight of their real signals already carry a
 * verdict — so three unanswered ones were inserted rather than their real
 * answers being deleted to make room. This takes them back out, along with
 * any verdict given while testing, so nothing invented is left behind in
 * the material the product reads them by.
 *
 *     node tools/ops/remove-test-claims.mjs
 */
import postgres from "postgres";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const env = Object.fromEntries(
  readFileSync(resolve(ROOT, ".env.local"), "utf8")
    .split("\n")
    .filter((line) => line.includes("=") && !line.trim().startsWith("#"))
    .map((line) => [
      line.slice(0, line.indexOf("=")).trim(),
      line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, ""),
    ]),
);
const IDS = [
  "0d69329b-0acf-4e00-b0a0-37608cf54e29",
  "95b11480-6e9b-4667-9c8d-65469e86e4e2",
  "5af24a19-c93a-4543-a348-4ff2650b5cf1",
];
const sql = postgres(env.DB_CONNECTION_URL, { max: 1 });
const answers = await sql`delete from feedback where target_type::text = 'signal' and target_id in ${sql(IDS)} returning id`;
const gone = await sql`delete from signals where id in ${sql(IDS)} returning id`;
console.log(`removed ${gone.length} test claim(s) and ${answers.length} verdict(s) given on them`);
await sql.end();
