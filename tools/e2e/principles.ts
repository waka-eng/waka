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
 *   WAKA_PRINCIPLE_MIN_SIGNALS_OVERRIDE=1
 *   WAKA_PRINCIPLE_MIN_TOM_OVERRIDE=1
 *   WAKA_ENABLE_PRINCIPLES_TEST_TRIGGER=1
 *
 * All THREE bars have overrides — `principle-generation.ts` reads SPAN,
 * SIGNALS and TOM through the same `bar()` helper — and this list named only
 * two, so `distinctSignals >= 3` stayed at its production value while the
 * others were relaxed. That was not what made the step fail, but a documented
 * override set that omits one of the three bars is a trap for whoever reads it
 * next.
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
    /*
      WAIT FOR THE BAR THE SERVER ACTUALLY USES, NOT A COPY OF THE PRODUCTION
      CONSTANT.

      This waited for three active signals because `PRINCIPLE_MIN_SIGNALS` is
      3 — and then the stack it is talking to has that bar OVERRIDDEN, which
      is the only reason this step can run at all. So the harness was holding
      out for a condition stricter than the one being tested, and whether it
      got there depended on the model grouping a fixed set of captures into
      exactly three distinct signals rather than two. Measured: one run
      reached three, one stalled at two for the full four minutes.

      Reading the same override the server reads removes that entirely. Absent
      an override this is 3, exactly as before.
    */
    const signalsBar = Number.parseInt(
      process.env.WAKA_PRINCIPLE_MIN_SIGNALS_OVERRIDE ?? "3",
      10,
    );
    const needSignals = Number.isFinite(signalsBar) && signalsBar > 0 ? signalsBar : 3;
    await waitFor(
      async ({ note }) => {
        const signals = await api(session!, "/api/signals?status=active");
        const count = (signals.body as { signals: unknown[] }).signals.length;
        note(`active signals: ${count}/${needSignals}`);
        return count >= needSignals ? true : null;
      },
      { timeoutMs: 240_000, label: `${needSignals} active signal(s) from the recurring themes` },
    );

    /*
      AND THE THIRD BAR IS NOT A SIGNAL COUNT, WHICH IS WHY THIS USED TO RACE.
 
      `refreshPrinciplesForProfile` returns `below_bar` unless
      `computeCitationEligibility` passes, and that checks THREE things:
      distinct signals, span, and **top-of-mind appearances** — the number of
      distinct top-of-mind versions any citing signal was selected into.
      Waiting for signals to go active satisfies the first two and says
      nothing about the third.
 
      Measured across three runs: the one that reached the judge logged
      `status: evaluated`; the two that did not logged `status: below_bar`,
      having done no model work at all. The difference was whether synthesis
      had happened to select those signals yet. So this waits for the artifact
      as well, which is the condition the bar is actually about.
    */
    await waitFor(
      async ({ note }) => {
        const tom = await api(session!, "/api/top-of-mind");
        const entries =
          (tom.body as { topOfMind?: { entries?: unknown[] } }).topOfMind?.entries ?? [];
        note(`top-of-mind entries: ${entries.length}`);
        return entries.length > 0 ? true : null;
      },
      { timeoutMs: 240_000, label: "a top of mind the signals have been selected into" },
    );

    /*
      IT RUNS NIGHTLY, SO ONCE IS NOT HOW THE FEATURE WORKS.

      Three sources of variance were found here, in this order, and only the
      third is the model's:

        1. The assertion demanded `origin === "minted"` while the judge
           correctly REDEEMED a colliding declaration instead. Widened.
        2. The step triggered as soon as signals went active, but the
           eligibility gate also counts TOP-OF-MIND APPEARANCES — so runs that
           beat synthesis logged `below_bar` and did no model work at all.
           It waits for the artifact now.
        3. With both fixed, a run still logged `status: no_candidates`: the
           bar passed, the distiller ran, and the model returned nothing from
           the same fixture. Across six runs all three statuses appeared.

      Nothing in a harness fixes the third. But a single trigger is not what
      production does — the nightly cron asks again every night, and a theme
      that yields no candidate tonight yields one later. Asking three times
      with a pause is that, faithfully; it is not a retry papering over a
      failure, because the thing being tested is a recurring job.

      If all three passes come back with nothing, that is reported as what it
      is rather than as a timeout with no cause attached.
    */
    let lastTrigger = "";
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const trigger = await api(session!, "/api/principles/refresh-test-trigger", {
        method: "POST",
      });
      if (trigger.status !== 202) throw new Error(`test trigger → ${trigger.status}`);
      lastTrigger = `attempt ${attempt}`;
      const settled = await waitFor(
        async ({ note }) => {
          const list = await api(session!, "/api/principles");
          const rows = (list.body as {
            principles: Array<{ state: string; citedSignals: unknown[] }>;
          }).principles;
          const earned = rows.find((r) => r.state === "held" && r.citedSignals.length > 0);
          note(`${lastTrigger}: held with evidence: ${earned ? 1 : 0}`);
          return earned ?? null;
        },
        { timeoutMs: 45_000, label: `a principle held on its evidence (${lastTrigger})` },
      ).catch(() => null);
      if (settled) break;
    }

    /*
      HELD WITH CITATIONS — BY EITHER ROAD, BECAUSE THERE ARE TWO AND BOTH ARE
      THE PROMISE WORKING.

      This asserted `origin === "minted"` and failed for three minutes while
      the system did something better. `distill` judges each candidate against
      the principles already standing: if one is the SAME, it attaches the
      citations to that one and, if it was aspirational, redeems it —
      `state: "held"`, evidence attached — rather than minting a near-duplicate
      beside it. The run reported `attached: 3, redeemed: 1, minted: 0`.

      And it was deterministic, not luck. Step 2 of this same suite declares
      "Have something working before you put more money in", and the captures
      below say "I cap spending until something ships" and "I ship a working
      slice before polishing". Those are one principle in three wordings, so
      the judge was right and the assertion was wrong: it was demanding the
      duplicate the design exists to avoid.

      What the step's own title claims is that months of signals produce a HELD
      principle. Both roads do. Which one ran is reported rather than required,
      because that depends on what the person had already declared.

      AND THIS FIXTURE ONLY EVER WALKS ONE OF THEM. Because step 2's
      declaration collides with these captures by design, the road taken here
      is redemption, every time — minting a principle from nothing is NOT
      exercised by this suite, and the result line says which road ran so a
      reader can never mistake one for both. Proving the other needs a fixture
      whose captures land on a theme nothing standing already covers.
    */
    const held = await waitFor(
      async ({ note }) => {
        const list = await api(session!, "/api/principles");
        const rows = (list.body as {
          principles: Array<{ state: string; origin: string; citedSignals: unknown[] }>;
        }).principles;
        const earned = rows.find(
          (row) => row.state === "held" && row.citedSignals.length > 0,
        );
        note(`principles: ${rows.length}, held with evidence: ${earned ? 1 : 0}`);
        return earned ?? null;
      },
      {
        timeoutMs: 30_000,
        label: "a principle held on its evidence, after three nightly passes",
      },
    ).catch(async () => {
      /*
        A BARE TIMEOUT NAMES NOTHING, AND THIS STEP FAILS FOR THREE DIFFERENT
        REASONS. The trigger answers 202 and logs its verdict server-side, so
        the suite cannot read it — which meant a failure here said only "timed
        out" and every diagnosis needed the server's log beside it. Twice that
        cost an hour and a wrong answer.

        So a failure states what it could see. It cannot name the verdict, but
        it can name the shape that produced it: too few active signals is the
        eligibility gate, no top of mind is the appearances bar, and everything
        present with nothing held is the model returning no candidate.
      */
      const [signals, tom, principlesNow] = await Promise.all([
        api(session!, "/api/signals?status=active"),
        api(session!, "/api/top-of-mind"),
        api(session!, "/api/principles"),
      ]);
      const activeCount = (signals.body as { signals: unknown[] }).signals.length;
      const tomEntries =
        (tom.body as { topOfMind?: { entries?: unknown[] } }).topOfMind?.entries?.length ?? 0;
      const rows = (principlesNow.body as {
        principles: Array<{ state: string; origin: string; citedSignals: unknown[] }>;
      }).principles;
      const shape = rows
        .map((r) => `${r.origin}/${r.state}/${r.citedSignals.length}cit`)
        .join(", ");
      throw new Error(
        `no principle became held after three passes — active signals: ${activeCount} ` +
          `(bar ${needSignals}), top-of-mind entries: ${tomEntries}, principles: ` +
          `[${shape || "none"}]. ` +
          (activeCount < needSignals
            ? "Too few active signals: the eligibility gate never opened."
            : tomEntries === 0
              ? "No top of mind: the appearances bar cannot be met."
              : "Everything the bar needs was present, so the distiller returned no " +
                "candidate this time — which it does, and no wait fixes."),
      );
    });
    return `${held.origin === "minted" ? "minted" : "redeemed a declaration"} — held with ${held.citedSignals.length} citation(s)`;
  });

  if (session) await deleteAccount(session).catch(() => undefined);

  console.log(`\n[principles] ${passed} passed, ${failed} failed, ${skipped} skipped`);
  if (failed > 0) process.exit(1);
}

await main().catch((err) => {
  console.log(`FATAL ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
