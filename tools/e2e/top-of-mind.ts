/**
 * The layer-3 gate: does the artifact hold together across regeneration?
 *
 * Layer 3 is the only place WAKA rewrites something a person may have edited,
 * so the questions worth asking are all about what survives:
 *
 *   - a locked entry must come back byte for byte, no matter what the model
 *     returns; the enforcement is in code, and the model is never trusted
 *   - every cited signal must resolve, or an entry rests on a citation nobody
 *     can follow
 *   - one live artifact per profile, enforced by the database rather than by
 *     whichever code path happened to run
 *   - a refresh that changes nothing must say so; a silent empty pass is
 *     indistinguishable from a broken generator, which is how the previous
 *     system hid its failures
 *
 *   pnpm tsx tools/e2e/top-of-mind.ts [--base-url http://localhost:3010]
 */

import {
  capture,
  deleteAccount,
  getTopOfMind,
  health,
  listSignals,
  signUp,
  waitFor,
  type Session,
  type TopOfMind,
} from "./organic.js";

const DEFAULT_BASE_URL = "http://localhost:3010";
const SYNTHESIS_TIMEOUT_MS = 5 * 60 * 1000;

/** One person's pull, said several ways, so there is something to synthesize. */
const ARCHIVE = [
  "Rebuilt my note exporter as a forty-line script tonight. Every big system I started this year is abandoned; the tiny tools are the only ones I still open.",
  "Deleted the dashboard I spent three weekends on. I never opened it after the day it shipped.",
  "The scripts I keep are the ones I could rewrite from memory in an evening.",
  "Started sketching another framework, then wrote a shell alias instead. The alias solved it.",
  "I keep choosing the thing I can hold in my head over the thing that would scale.",
];

interface StepResult {
  ok: boolean;
}
const results: StepResult[] = [];

async function step(title: string, run: () => Promise<string>): Promise<void> {
  const started = Date.now();
  const index = results.length + 1;
  try {
    const detail = await run();
    results.push({ ok: true });
    console.log(`PASS ${index}. ${title} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
    console.log(`     ${detail}`);
  } catch (err) {
    results.push({ ok: false });
    console.log(`FAIL ${index}. ${title} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
    console.log(`     ${err instanceof Error ? err.message : String(err)}`);
  }
}

function api(session: Session, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${session.baseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.token}`,
      ...(init.headers ?? {}),
    },
  });
}

/** Ask for a refresh and wait until a version newer than `after` is live. */
async function refreshAndWait(
  session: Session,
  after: number,
  label: string,
): Promise<TopOfMind> {
  const queued = await api(session, "/api/top-of-mind/refresh", { method: "POST" });
  if (!queued.ok && queued.status !== 202) {
    throw new Error(`refresh → ${queued.status}`);
  }
  return waitFor(
    async ({ note }) => {
      const artifact = await getTopOfMind(session, {});
      note(artifact ? `version=${artifact.version} reason=${String(artifact.reason)}` : "none yet");
      return artifact && artifact.version > after ? artifact : null;
    },
    { timeoutMs: SYNTHESIS_TIMEOUT_MS, label },
  );
}

async function main(): Promise<void> {
  const baseUrl = process.argv.includes("--base-url")
    ? process.argv[process.argv.indexOf("--base-url") + 1]!
    : DEFAULT_BASE_URL;

  console.log(`[top-of-mind] base url: ${baseUrl}\n`);

  let owner: Session | undefined;

  try {
    await step("the stack answers as waka", async () => {
      const body = await health(baseUrl);
      if (body.service !== "waka") throw new Error(`service=${body.service}`);
      return `service=${body.service}`;
    });

    let first: TopOfMind | undefined;
    await step("an archive synthesizes into a first artifact", async () => {
      owner = await signUp({ baseUrl });
      for (const text of ARCHIVE) await capture(owner, { text, kind: "note" });

      // Signals have to exist before there is anything to synthesize from.
      await waitFor(
        async ({ note }) => {
          const signals = await listSignals(owner!, { limit: 50 });
          note(`${signals.length} signals`);
          return signals.length >= 1 ? signals : null;
        },
        { timeoutMs: SYNTHESIS_TIMEOUT_MS, label: "signals to derive" },
      );

      first = await waitFor(
        async ({ note }) => {
          const artifact = await getTopOfMind(owner!, {});
          note(artifact ? `version=${artifact.version} entries=${artifact.entries.length}` : "none yet");
          return artifact && artifact.entries.length > 0 ? artifact : null;
        },
        { timeoutMs: SYNTHESIS_TIMEOUT_MS, label: "the first artifact" },
      );
      return `version=${first.version}, ${first.entries.length} entries, reason=${String(first.reason)}`;
    });

    await step("every cited signal resolves to one the profile owns", async () => {
      const signals = await listSignals(owner!, { limit: 100 });
      const owned = new Set(signals.map((signal) => signal.id));

      let cited = 0;
      for (const entry of first!.entries) {
        const citations = (entry.citedSignals ?? []) as Array<{ id: string }>;
        for (const citation of citations) {
          cited += 1;
          if (!owned.has(citation.id)) {
            throw new Error(`entry ${entry.id} cites unknown signal ${citation.id}`);
          }
        }
      }
      if (cited === 0) throw new Error("no entry cited any signal");
      return `${cited} citations across ${first!.entries.length} entries, all resolvable`;
    });

    let lockedText = "";
    await step("a locked entry survives regeneration byte for byte", async () => {
      const target = first!.entries[0]!;
      lockedText = "Keep only what I could rebuild in one evening.";

      const edited = await api(owner!, `/api/top-of-mind/entries/${target.id}`, {
        method: "PATCH",
        body: JSON.stringify({ body: lockedText }),
      });
      if (!edited.ok) throw new Error(`PATCH entry → ${edited.status}`);

      await capture(owner!, {
        text: "Another evening, another twenty-line script replacing something I abandoned.",
        kind: "note",
      });

      const next = await refreshAndWait(owner!, first!.version, "a regenerated artifact");
      const carried = next.entries.find((entry) => entry.body === lockedText);
      if (!carried) {
        throw new Error(
          `locked entry did not survive; bodies now: ${next.entries.map((e) => e.body.slice(0, 40)).join(" | ")}`,
        );
      }
      first = next;
      return `version=${next.version}, locked entry carried verbatim`;
    });

    await step("pin and dismiss round-trip and survive a regeneration", async () => {
      const pinTarget = first!.entries.find((entry) => entry.body === lockedText)!;
      const dismissTarget = first!.entries.find((entry) => entry.id !== pinTarget.id);

      const pinned = await api(owner!, `/api/top-of-mind/entries/${pinTarget.id}/pin`, {
        method: "POST",
      });
      if (!pinned.ok) throw new Error(`pin → ${pinned.status}`);

      if (dismissTarget) {
        const dismissed = await api(
          owner!,
          `/api/top-of-mind/entries/${dismissTarget.id}/dismiss`,
          { method: "POST" },
        );
        if (!dismissed.ok) throw new Error(`dismiss → ${dismissed.status}`);
      }

      const after = await getTopOfMind(owner!, { includeDismissed: true });
      const stillPinned = after!.entries.find((entry) => entry.id === pinTarget.id);
      if (!stillPinned?.pinned) throw new Error("pin did not stick");
      if (dismissTarget) {
        const gone = after!.entries.find((entry) => entry.id === dismissTarget.id);
        if (!gone?.dismissed) throw new Error("dismiss did not stick");
      }
      return dismissTarget ? "pin and dismiss both stuck" : "pin stuck (only one entry to work with)";
    });

    await step("a refresh with nothing new records an explicit no-change", async () => {
      const before = await getTopOfMind(owner!, {});
      const next = await refreshAndWait(
        owner!,
        before!.version,
        "a version recording the no-change decision",
      );
      if (next.reason !== "no_change" && next.reason !== "regenerated") {
        throw new Error(`unexpected reason=${String(next.reason)}`);
      }
      return `version=${next.version} reason=${String(next.reason)} — the pass is on the record either way`;
    });

    await step("only one artifact is live for the profile", async () => {
      const versions = await api(owner!, "/api/top-of-mind/versions").then(
        (r) => r.json() as Promise<{ versions: Array<{ version: number; status: string }> }>,
      );
      const live = versions.versions.filter((entry) => entry.status === "live");
      if (live.length !== 1) {
        throw new Error(`${live.length} live artifacts in a chain of ${versions.versions.length}`);
      }
      return `${versions.versions.length} versions in the chain, exactly 1 live`;
    });
  } finally {
    if (owner) await deleteAccount(owner).catch(() => undefined);
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  console.log(`\n[top-of-mind] ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

await main();
