/**
 * The cold start: a brand-new profile saves a handful of unrelated thoughts —
 * none repeated three ways — and must still see a top of mind, built from
 * its forming signals rather than nothing.
 *
 *   pnpm tsx tools/e2e/cold-start.ts [--base-url http://localhost:3010]
 */

import { capture, deleteAccount, getTopOfMind, health, signUp, waitFor } from "./organic.js";

const baseUrl = process.argv.includes("--base-url")
  ? process.argv[process.argv.indexOf("--base-url") + 1]!
  : "http://localhost:3010";

// Deliberately varied: different objects, no phrase said three ways, so nothing
// crosses the three-evidence promotion bar. Before the cold-start fix this
// profile synthesised nothing.
const FIRST_SITTING = [
  "I want to spend a month somewhere I do not speak the language.",
  "The best conversations I have are the ones where nobody is trying to be useful.",
  "I keep buying notebooks I never write in.",
  "I would rather be early and wrong than late and certain.",
];

async function main(): Promise<void> {
  console.log(`[cold-start] base url: ${baseUrl}\n`);
  const body = await health(baseUrl);
  if (body.service !== "waka") throw new Error(`service=${body.service}`);

  const session = await signUp({ baseUrl });
  try {
    for (const text of FIRST_SITTING) await capture(session, { text, kind: "note" });

    const artifact = await waitFor(
      async ({ note, attempt }) => {
        const tom = await getTopOfMind(session, {});
        note(tom ? `version=${tom.version} entries=${tom.entries.length}` : "still null");
        // Give derivation + synthesis a few passes; a new profile's first
        // artifact should arrive within the background cadence.
        return tom && tom.entries.length > 0 && attempt >= 1 ? tom : null;
      },
      { timeoutMs: 5 * 60 * 1000, label: "a first, provisional top of mind" },
    );

    console.log(
      `PASS a new profile with ${FIRST_SITTING.length} unrelated captures has an artifact:`,
    );
    console.log(`     version=${artifact.version}, ${artifact.entries.length} entries`);
    for (const entry of artifact.entries) {
      console.log(`     · [${entry.type}] ${entry.body.slice(0, 90)}`);
    }
    console.log("\n[cold-start] 1 passed, 0 failed");
  } finally {
    await deleteAccount(session).catch(() => undefined);
  }
}

await main().catch((err) => {
  console.log(`FAIL ${err instanceof Error ? err.message : String(err)}`);
  console.log("\n[cold-start] 0 passed, 1 failed");
  process.exit(1);
});
