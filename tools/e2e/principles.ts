/**
 * Layer 4, end to end: declaration routing (both destinations), the
 * canonical markdown document, curation, and — under the documented env
 * overrides, because e2e can wait for neither 45 days nor midnight — the
 * full promotion path: captures → signals → top of mind → a minted
 * principle with citations.
 *
 *   pnpm tsx tools/e2e/principles.ts [--base-url http://localhost:3010]
 *
 * The promotion step needs the stack booted with:
 *   WAKA_PRINCIPLE_MIN_SPAN_OVERRIDE=0
 *   WAKA_PRINCIPLE_MIN_TOM_OVERRIDE=1
 *   WAKA_ENABLE_PRINCIPLES_TEST_TRIGGER=1
 * Absent those (a deployed stage), the promotion step reports itself
 * skipped rather than pretending: deployed stages have no trigger — the
 * nightly cron is the sole enqueuer, which is the point.
 */

import {
  capture,
  deleteAccount,
  health,
  signUp,
  waitFor,
  type Session,
} from "./organic.js";

const baseUrl = process.argv.includes("--base-url")
  ? process.argv[process.argv.indexOf("--base-url") + 1]!
  : "http://localhost:3010";

let passed = 0;
let failed = 0;
let skipped = 0;

async function step(name: string, run: () => Promise<string>): Promise<void> {
  const startedAt = Date.now();
  try {
    const note = await run();
    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    if (note.startsWith("SKIP")) {
      skipped += 1;
      console.log(`SKIP ${name} (${seconds}s)\n     ${note.slice(5)}`);
    } else {
      passed += 1;
      console.log(`PASS ${name} (${seconds}s)\n     ${note}`);
    }
  } catch (err) {
    failed += 1;
    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(`FAIL ${name} (${seconds}s)\n     ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function api(
  session: Session,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<{ status: number; body: unknown; text: string }> {
  const response = await fetch(`${session.baseUrl}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${session.token}`,
      ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  const text = await response.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    // markdown responses stay in `text`
  }
  return { status: response.status, body, text };
}

/**
 * Three related themes, three captures each. The longevity bar demands three
 * DISTINCT citing signals (deliberately not overridden — the distinctness
 * test is the point), and a signal promotes to active at three pieces of
 * evidence, so each theme repeats its own sentence three times. The shared
 * frugality through-line is what distillation should generalize across.
 */
const FRUGALITY_CAPTURES = [
  "Rebuilt the exporter as a forty-line script tonight. I keep choosing small tools over big platforms.",
  "Wrote a shell alias instead of installing the suite. I keep choosing small tools over big platforms.",
  "The forty-line script outlived the vendor tool. I keep choosing small tools over big platforms.",
  "Picked the single-file library over the framework again. I keep choosing small tools over big platforms.",
  "Kept the experiment on the monthly plan again. I cap spending until something ships.",
  "Refused the annual license before the pilot proved out. I cap spending until something ships.",
  "Said no to the bigger cloud instance this sprint. I cap spending until something ships.",
  "Held the tooling budget flat until the prototype worked. I cap spending until something ships.",
  "Deleted the half-built dashboard; the spreadsheet already worked. I ship a working slice before polishing.",
  "The features that survived all shipped ugly first. I ship a working slice before polishing.",
  "Demoed the walking skeleton instead of the mockups. I ship a working slice before polishing.",
  "Cut the settings screen to get the core loop out. I ship a working slice before polishing.",
];

async function main(): Promise<void> {
  console.log(`[principles] base url: ${baseUrl}\n`);
  const body = await health(baseUrl);
  if (body.service !== "waka") throw new Error(`service=${body.service}`);

  let session: Session | undefined;

  await step("1. the stack answers as waka", async () => `service=${body.service}`);

  await step("2. a qualifying declaration lands as an aspirational principle", async () => {
    session = await signUp({ baseUrl });
    const declared = await api(session, "/api/principles", {
      method: "POST",
      body: { statement: "Have something working before you put more money in." },
    });
    if (declared.status !== 201) throw new Error(`declare → ${declared.status}`);
    const payload = declared.body as {
      created: string;
      principle?: { state: string; locked: boolean; origin: string };
    };
    if (payload.created !== "principle") throw new Error(`created=${payload.created}`);
    if (payload.principle?.state !== "aspirational" || !payload.principle.locked) {
      throw new Error(`state=${payload.principle?.state} locked=${payload.principle?.locked}`);
    }
    return "aspirational, locked, declared";
  });

  await step("3. a goal-shaped declaration is filed as an inspiration, silently", async () => {
    const declared = await api(session!, "/api/principles", {
      method: "POST",
      body: { statement: "Ship the museum app by June." },
    });
    if (declared.status !== 201) throw new Error(`declare → ${declared.status}`);
    const payload = declared.body as Record<string, unknown>;
    if (payload.created !== "inspiration") throw new Error(`created=${String(payload.created)}`);
    const keys = Object.keys(payload).sort().join(",");
    if (keys !== "created,inspirationId") throw new Error(`payload leaks: ${keys}`);
    const archive = await api(session!, "/api/inspirations?limit=5");
    const listed = (archive.body as { inspirations: Array<{ textPreview: string }> }).inspirations;
    if (!listed.some((row) => row.textPreview.includes("museum app"))) {
      throw new Error("the routed words did not reach the archive");
    }
    return "filed with the captures; response carries only {created, inspirationId}";
  });

  await step("4. the canonical document reads back with the contract", async () => {
    const document = await api(session!, "/api/principles.md");
    if (document.status !== 200) throw new Error(`md → ${document.status}`);
    if (!document.text.startsWith("# Principles — ")) throw new Error("missing title");
    if (!document.text.includes("bounds decisions made on this person's behalf")) {
      throw new Error("missing the consumption contract preamble");
    }
    if (!document.text.includes("(aspirational)")) throw new Error("missing the declared row");
    return "title, preamble, and the declared principle present";
  });

  await step("5. reorder is the owner's and sticky; edit locks", async () => {
    const second = await api(session!, "/api/principles", {
      method: "POST",
      body: { statement: "Prefer tools you can hold in your head over systems you must trust." },
    });
    if ((second.body as { created: string }).created !== "principle") {
      throw new Error("second declaration did not qualify — fixture drift");
    }
    const list = () =>
      api(session!, "/api/principles").then(
        (r) => (r.body as { principles: Array<{ id: string; rank: number }> }).principles,
      );
    const before = await list();
    const reordered = await api(session!, "/api/principles/reorder", {
      method: "POST",
      body: { order: [before[1]!.id, before[0]!.id] },
    });
    if (reordered.status !== 200) throw new Error(`reorder → ${reordered.status}`);
    const after = await list();
    if (after[0]!.id !== before[1]!.id) throw new Error("order did not persist");

    const edited = await api(session!, `/api/principles/${after[0]!.id}`, {
      method: "PATCH",
      body: { statement: "Prefer tools you can hold in your head." },
    });
    const principle = (edited.body as { principle: { locked: boolean } }).principle;
    if (!principle.locked) throw new Error("edit did not lock");
    return "rank persisted; edit locked";
  });

  await step("6. promotion: months of signals mint a held principle", async () => {
    if (process.env.WAKA_PRINCIPLE_E2E !== "1") {
      return "SKIP needs the local stack booted with the documented overrides (deployed stages have no trigger — the nightly cron is the sole enqueuer, by design)";
    }
    for (const text of FRUGALITY_CAPTURES) {
      await capture(session!, { text, kind: "note" });
    }
    // Wait for derivation + synthesis to settle (push-driven, seconds). The
    // bar demands three distinct signals, so three must go active.
    await waitFor(
      async ({ note }) => {
        const signals = await api(session!, "/api/signals?status=active");
        const count = (signals.body as { signals: unknown[] }).signals.length;
        note(`active signals: ${count}`);
        return count >= 3 ? true : null;
      },
      { timeoutMs: 240_000, label: "three active signals from the recurring themes" },
    );

    const trigger = await api(session!, "/api/principles/refresh-test-trigger", {
      method: "POST",
    });
    if (trigger.status !== 202) throw new Error(`test trigger → ${trigger.status}`);

    const minted = await waitFor(
      async ({ note }) => {
        const list = await api(session!, "/api/principles");
        const rows = (list.body as {
          principles: Array<{ state: string; origin: string; citedSignals: unknown[] }>;
        }).principles;
        const held = rows.find((row) => row.origin === "minted" && row.state !== "aspirational");
        note(`principles: ${rows.length}, minted+held: ${held ? 1 : 0}`);
        return held ?? null;
      },
      { timeoutMs: 180_000, label: "a minted principle" },
    );
    if (minted.citedSignals.length < 1) throw new Error("minted without citations");
    return `minted with ${minted.citedSignals.length} citation(s)`;
  });

  if (session) await deleteAccount(session).catch(() => undefined);

  console.log(`\n[principles] ${passed} passed, ${failed} failed, ${skipped} skipped`);
  if (failed > 0) process.exit(1);
}

await main().catch((err) => {
  console.log(`FATAL ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
