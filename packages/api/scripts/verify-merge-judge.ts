/**
 * Two calls that answer whether the merge judge actually judges: a pair that
 * is one pattern reworded (expect same), and a pair sharing vocabulary while
 * naming different pulls (expect independent — the judge is three-way since
 * no-quiet-corners Phase 5; gemini-judge.test.ts and the goal log carry the
 * fuller live spot-check).
 *
 *   pnpm tsx packages/api/scripts/verify-merge-judge.ts
 */
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
config({ path: fileURLToPath(new URL("../../../.env.local", import.meta.url)) });

const { judgeSignalMatch } = await import("../src/queue/gemini.js");

const reworded = await judgeSignalMatch({
  preferredLocale: "en-US",
  candidateStatement: "I keep only the tools I could rebuild in an evening.",
  existingStatement: "The small tools I could rewrite from memory are the ones that survive.",
});
console.log(`reworded pair → relation=${reworded.relation} (expect same)`);

const shared = await judgeSignalMatch({
  preferredLocale: "en-US",
  candidateStatement: "I keep only the tools I could rebuild in an evening.",
  existingStatement: "I abandon any tool I did not build myself.",
});
console.log(`different pulls → relation=${shared.relation} (expect independent)`);

const ok = reworded.relation === "same" && shared.relation !== "same";
console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
