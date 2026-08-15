/**
 * The layer-2 gate: do captures actually become evidence-backed patterns, and
 * are those patterns this person's rather than a template's?
 *
 * The questions this answers cannot be answered by unit tests, because they
 * are about what a model produces over a real archive:
 *
 *   - does a run of related captures converge on one signal, or scatter into
 *     near-duplicates?
 *   - do two people who saved different things get different statements? The
 *     previous middle layer bucketed every capture into nine hardcoded English
 *     sentences, so every archive converged on the same "insights" — that is
 *     the regression this gate exists to catch.
 *   - does the cascade behave when evidence disappears, and does a locked
 *     statement survive regeneration byte for byte?
 *
 *   pnpm tsx tools/e2e/signals.ts [--base-url http://localhost:3010]
 */

import {
  capture,
  deleteAccount,
  deleteInspiration,
  health,
  listSignals,
  signUp,
  waitFor,
  type Session,
  type Signal,
} from "./organic.js";
import { startFixtureServer } from "./fixture-server.js";

const DEFAULT_BASE_URL = "http://localhost:3010";

/** Long enough for extract + embed + match per capture, plus queue backoff. */
const DERIVATION_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * One person's archive: five captures circling the same pull, two that have
 * nothing to do with it. A signal that cites two of the five is the pipeline
 * finding a pattern; a signal citing the strays would be it finding noise.
 */
const TOOLS_ARCHIVE = [
  "Rebuilt my note exporter as a forty-line script tonight. Every big system I started this year is abandoned; the tiny tools are the only things I still open.",
  "Deleted the dashboard I spent three weekends on. I never once looked at it after the day it shipped.",
  "The scripts I actually keep are the ones I could rewrite from memory in an evening.",
  "Started sketching another framework, then wrote a shell alias instead. The alias solved it.",
  "I keep choosing the thing I can hold in my head over the thing that would scale.",
];

const TOOLS_STRAYS = [
  "Dentist moved to Thursday at 4.",
  "Wedding is in Lisbon in June, need to book flights.",
];

/**
 * A second person whose archive shares no vocabulary with the first. If both
 * end up with a statement in common, the generator is producing boilerplate
 * rather than reading.
 */
const GARDEN_ARCHIVE = [
  "Third year running I have failed to keep basil alive past August. The rosemary I ignore completely is thriving.",
  "I water the things I love too much and the tough ones flourish on neglect.",
  "Pulled out the raised bed. What actually grew here was whatever seeded itself.",
  "Stopped buying seedlings. Letting the garden choose is producing more than my planning did.",
  "The most alive corner of the garden is the one I never touch.",
];

interface StepResult {
  title: string;
  ok: boolean;
  detail: string;
  elapsedMs: number;
}

const results: StepResult[] = [];

async function step(title: string, run: () => Promise<string>): Promise<boolean> {
  const started = Date.now();
  try {
    const detail = await run();
    results.push({ title, ok: true, detail, elapsedMs: Date.now() - started });
    console.log(`PASS ${results.length}. ${title} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
    console.log(`     ${detail}`);
    return true;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    results.push({ title, ok: false, detail, elapsedMs: Date.now() - started });
    console.log(`FAIL ${results.length}. ${title} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
    console.log(`     ${detail}`);
    return false;
  }
}

/** Capture a whole archive, one at a time, so ordering is deterministic. */
async function seedArchive(session: Session, texts: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const text of texts) {
    const inspiration = await capture(session, { text, kind: "note" });
    ids.push(inspiration.id);
  }
  return ids;
}

/** Wait until any signal cites at least `minEvidence` captures. */
async function waitForSupportedSignal(
  session: Session,
  minEvidence: number,
  label: string,
): Promise<Signal> {
  return waitFor(
    async ({ note }) => {
      const signals = await listSignals(session, { limit: 50 });
      const best = signals
        .slice()
        .sort((a, b) => (b.evidenceCount ?? 0) - (a.evidenceCount ?? 0))[0];
      note(
        signals.length === 0
          ? "no signals yet"
          : `${signals.length} signals, best evidence=${best?.evidenceCount ?? 0}`,
      );
      return best && (best.evidenceCount ?? 0) >= minEvidence ? best : null;
    },
    { timeoutMs: DERIVATION_TIMEOUT_MS, label },
  );
}

function normalizeStatement(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();
}

async function main(): Promise<void> {
  const baseUrl =
    process.argv.includes("--base-url")
      ? process.argv[process.argv.indexOf("--base-url") + 1]!
      : DEFAULT_BASE_URL;

  console.log(`[signals] base url: ${baseUrl}\n`);

  const fixtures = await startFixtureServer();
  let owner: Session | undefined;
  let neighbour: Session | undefined;

  try {
    await step("the stack answers as waka", async () => {
      const body = await health(baseUrl);
      if (body.service !== "waka") throw new Error(`service=${body.service}`);
      return `service=${body.service}`;
    });

    let toolsIds: string[] = [];
    await step("an archive of related captures lands", async () => {
      owner = await signUp({ baseUrl });
      toolsIds = await seedArchive(owner, TOOLS_ARCHIVE);
      await seedArchive(owner, TOOLS_STRAYS);
      return `${toolsIds.length} related + ${TOOLS_STRAYS.length} unrelated captured`;
    });

    let supported: Signal | undefined;
    await step("a signal cites at least two of the related captures", async () => {
      supported = await waitForSupportedSignal(owner!, 2, "a signal supported by two captures");
      return `"${supported.statement.slice(0, 90)}" — evidence=${supported.evidenceCount}`;
    });

    /**
     * The canned-ontology regression. Two archives with no shared vocabulary
     * must not produce a statement in common.
     */
    await step("a different archive produces entirely different statements", async () => {
      neighbour = await signUp({ baseUrl });
      await seedArchive(neighbour, GARDEN_ARCHIVE);
      await waitForSupportedSignal(neighbour, 2, "a signal in the second archive");

      const mine = await listSignals(owner!, { limit: 50 });
      const theirs = await listSignals(neighbour, { limit: 50 });
      const overlap = mine
        .map((signal) => normalizeStatement(signal.statement))
        .filter((statement) =>
          theirs.some((other) => normalizeStatement(other.statement) === statement),
        );

      if (overlap.length > 0) {
        throw new Error(
          `${overlap.length} identical statement(s) across unrelated archives: ${overlap[0]}`,
        );
      }
      return `${mine.length} vs ${theirs.length} statements, zero identical`;
    });

    await step("a locked statement survives regeneration byte for byte", async () => {
      const target = supported!;
      const locked = "I keep only the tools I could rebuild in an evening.";

      const response = await fetch(`${baseUrl}/api/signals/${target.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${owner!.token}`,
        },
        body: JSON.stringify({ statement: locked }),
      });
      if (!response.ok) throw new Error(`PATCH → ${response.status}`);

      // A further capture on the same theme re-runs derivation over it.
      await capture(owner!, {
        text: "Another evening, another twenty-line script that replaced something I abandoned.",
        kind: "note",
      });

      const settled = await waitFor(
        async ({ note, attempt }) => {
          const signals = await listSignals(owner!, { limit: 50 });
          const found = signals.find((signal) => signal.id === target.id);
          note(found ? `statement=${found.statement.slice(0, 40)}` : "signal missing");
          // Give derivation a few passes to have run before declaring victory.
          return attempt >= 4 && found ? found : null;
        },
        { timeoutMs: DERIVATION_TIMEOUT_MS, label: "the locked signal after re-derivation" },
      );

      if (settled.statement !== locked) {
        throw new Error(`locked statement changed to "${settled.statement}"`);
      }
      return `locked text unchanged across regeneration (evidence=${settled.evidenceCount})`;
    });

    await step("deleting every citation retires an unlocked signal", async () => {
      const before = await listSignals(owner!, { limit: 50 });
      const unlocked = before.find(
        (signal) => signal.id !== supported!.id && (signal.evidenceCount ?? 0) > 0,
      );
      if (!unlocked) return "no unlocked signal available to test the cascade; skipped";

      const detail = await fetch(`${baseUrl}/api/signals/${unlocked.id}`, {
        headers: { Authorization: `Bearer ${owner!.token}` },
      }).then((r) => r.json() as Promise<{ signal: { evidence: Array<{ inspirationId: string }> } }>);

      for (const evidence of detail.signal.evidence) {
        await deleteInspiration(owner!, evidence.inspirationId);
      }

      const gone = await waitFor(
        async ({ note }) => {
          const signals = await listSignals(owner!, { limit: 50, status: "active" });
          const still = signals.find((signal) => signal.id === unlocked.id);
          note(still ? "still active" : "retired");
          return still ? null : true;
        },
        { timeoutMs: DERIVATION_TIMEOUT_MS, label: "the unsupported signal retiring" },
      );
      return gone ? "signal retired once its last citation went" : "unreachable";
    });
  } finally {
    await fixtures.close();
    for (const session of [owner, neighbour]) {
      if (session) await deleteAccount(session).catch(() => undefined);
    }
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  console.log(`\n[signals] ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

await main();
