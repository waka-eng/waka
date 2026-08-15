/**
 * Two calls that answer whether the merge judge actually judges: a pair that
 * is one pattern reworded (expect same), and a pair sharing vocabulary while
 * naming different pulls (expect different).
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
console.log(`reworded pair → samePattern=${reworded.samePattern} (expect true)`);

const shared = await judgeSignalMatch({
  preferredLocale: "en-US",
  candidateStatement: "I keep only the tools I could rebuild in an evening.",
  existingStatement: "I abandon any tool I did not build myself.",
});
console.log(`different pulls → samePattern=${shared.samePattern} (expect false)`);

const ok = reworded.samePattern === true && shared.samePattern === false;
console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
