#!/usr/bin/env tsx
/**
 * Group reading eval.
 *
 * Runs the REAL group judge — agikee's `judgeGroupWowMoment`, with the member
 * labels and combination-question task added on top — over a real group, and
 * prints what came back.
 *
 * Read-only. It calls the judge directly rather than `runGroupSynthesis`,
 * because synthesis persists its results: evaluating a prompt change should
 * not leave notes on a real group's board.
 *
 * Point it at a development database. It prints members' real names and the
 * text of their saved signals to stdout — that is the whole point of an eval,
 * and it is also why the output does not belong in a terminal scrollback or a
 * pasted log if the rows came from real people.
 *
 * The question it answers: the previous run collapsed, producing nine readings
 * that were all variations on "physical rituals forcing AI into reality". If
 * telling the judge whose signal is whose does not break that, the change is
 * plumbing rather than a fix, and should be described as such.
 *
 * Usage:
 *   pnpm tsx tools/group-reading-eval.ts --list
 *   pnpm tsx tools/group-reading-eval.ts --group <uuid> [--triggers 10]
 */

import { config as loadDotenv } from "dotenv";

loadDotenv({ path: ".env.local" });
loadDotenv();

import { and, desc, eq, inArray, sql } from "drizzle-orm";

import {
  groupMembers,
  groups,
  signals,
  users,
} from "../packages/api/src/db/index";
import { getDb } from "../packages/api/src/lib/db";
import { GeminiEmbeddingHttpClient } from "../packages/api/src/lib/inspiration-embeddings";
import { selectBoard } from "../packages/api/src/scoring/board-selection";
import { cosineSimilarity } from "../packages/api/src/scoring/wow-score";
import { judgeGroupWowMoment } from "../packages/api/src/lib/wow-judge";
import {
  loadOwnersBySignalId,
  loadTriggerSignals,
  restatesASingleMember,
  type ReachMode,
} from "../packages/api/src/lib/group-top-of-mind-synthesis";

function parseArgs(argv: string[]) {
  let groupId: string | undefined;
  let triggers = 10;
  let list = false;
  let variant = "baseline";
  let reach: ReachMode = "nearest";
  let evidence: CandidateReachMode = "standing";
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--group") groupId = argv[++i];
    else if (argv[i] === "--triggers") triggers = Number.parseInt(argv[++i] ?? "10", 10);
    else if (argv[i] === "--variant") variant = argv[++i] ?? "baseline";
    else if (argv[i] === "--reach") reach = (argv[++i] ?? "nearest") as ReachMode;
    else if (argv[i] === "--evidence") evidence = (argv[++i] ?? "standing") as CandidateReachMode;
    else if (argv[i] === "--list") list = true;
  }
  if (!Number.isFinite(triggers) || triggers < 1) triggers = 10;
  return { groupId, triggers, list, variant, reach, evidence };
}

function preview(text: string, max = 78): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

/**
 * Lexical overlap. Kept only as a secondary reading, never as the verdict.
 *
 * It called a board of five phrasings of "physical versus screen" distinct at
 * 0.08, because those five sentences share no words. Counting words cannot see
 * a board that says one thing in five vocabularies, which is the exact failure
 * this eval exists to catch.
 */
function overlap(a: string, b: string): number {
  const tok = (v: string) =>
    new Set(v.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 3));
  const x = tok(a);
  const y = tok(b);
  if (x.size === 0) return 0;
  let shared = 0;
  for (const t of x) if (y.has(t)) shared += 1;
  return shared / x.size;
}

function meanPairwiseCosine(vectors: number[][]): number {
  let total = 0;
  let pairs = 0;
  for (let i = 0; i < vectors.length; i += 1) {
    for (let j = i + 1; j < vectors.length; j += 1) {
      total += cosineSimilarity(vectors[i]!, vectors[j]!);
      pairs += 1;
    }
  }
  return pairs === 0 ? 0 : total / pairs;
}

/**
 * How much more alike are these readings than unrelated readings are?
 *
 * Raw cosine is unusable as a verdict: in this embedding space a collapsed
 * board scored 0.964 and *unrelated* text scored 0.926, so any absolute
 * threshold either passes everything or fails everything. Nearly reported a
 * healthy board as collapsed on that basis.
 *
 * So the number is normalized against a baseline drawn from the same space: a
 * fixed corpus of note-shaped statements about deliberately unrelated things.
 * Fixed rather than sampled from other groups, because most databases have
 * exactly one group with notes, and because a constant denominator is what
 * makes two runs on different days comparable at all. The result is the
 * fraction of the available headroom the board has closed: 0 means "no more
 * alike than any two unrelated notes", 1 means "identical".
 *
 * **This number is NOT calibrated, and this tool deliberately does not turn it
 * into a verdict.** Measured 2026-08-01 against the only labelled pair
 * available — the five-note board known to be five phrasings of one idea, and
 * the six-note board believed to be plural — it scored 0.38 and 0.41. It
 * ranked them the wrong way round and separated them by noise. Both the
 * lexical metric it replaces and this one have now failed to detect a collapse
 * that is obvious to a reader, so the honest output is the number and its
 * provenance, not a pass. Anyone setting a threshold here needs labelled
 * boards first.
 *
 * Returns null when there is no baseline to measure against, because a made-up
 * denominator is worse than an absent number.
 */
/**
 * Note-register statements about unrelated things.
 *
 * Their mean pairwise similarity is "how alike are two arbitrary notes in this
 * embedding space" — the floor any real board sits above. Deliberately spread
 * across domains none of which this product is about, so a board cannot look
 * distinct merely by sharing the baseline's subject.
 */
const BASELINE_CORPUS = [
  "Kitchens laid out around the cook's hands rather than around the appliances",
  "Long-distance runners negotiate with pain differently than sprinters do",
  "A municipal budget is a record of what a city is afraid of",
  "The grammar that subtitles invented for silent film",
  "Soil testing as a slow form of listening to a field",
  "Actuaries and the price of a year that probably will not happen",
  "Choral breathing is how a group keeps time without a conductor",
  "Warehouse routing when the map changes several times an hour",
] as const;

function collapseExcess(within: number, baseline: number): number | null {
  const headroom = 1 - baseline;
  if (headroom <= 0.001) return null;
  return (within - baseline) / headroom;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const db = getDb();

  if (opts.list || !opts.groupId) {
    const rows = await db
      .select({
        id: groups.id,
        name: groups.name,
        members: sql<number>`count(distinct ${groupMembers.userId})::int`,
      })
      .from(groups)
      .leftJoin(groupMembers, eq(groupMembers.groupId, groups.id))
      .groupBy(groups.id, groups.name);
    console.log("\ngroups\n");
    for (const r of rows) console.log(`  ${r.id}  ${String(r.members).padStart(2)} members  ${r.name}`);
    console.log("\nrun: pnpm tsx tools/group-reading-eval.ts --group <uuid>\n");
    return;
  }

  const members = await db
    .select({ userId: groupMembers.userId, name: users.name })
    .from(groupMembers)
    .innerJoin(users, eq(users.id, groupMembers.userId))
    .where(eq(groupMembers.groupId, opts.groupId));

  if (members.length < 2) {
    console.error("A group needs at least two members for a combination to exist.");
    process.exitCode = 1;
    return;
  }

  const memberUserIds = members.map((m) => m.userId);
  console.log(`\n${members.length} members: ${members.map((m) => m.name).join(", ")}`);

  // Production's own trigger selection, not a re-implementation of it. The
  // earlier version blocked triggers by member while production round-robins
  // them, so the two did not even ask the same questions in the same order.
  const triggerRows = await loadTriggerSignals(db as never, memberUserIds, opts.reach);
  const texts = triggerRows.length
    ? await db
        .select({ id: signals.id, text: signals.text })
        .from(signals)
        .where(inArray(signals.id, triggerRows.map((t) => t.id)))
    : [];
  const textById = new Map(texts.map((t) => [t.id, t.text]));
  const chosen = triggerRows
    .slice(0, opts.triggers)
    .map((t) => ({ id: t.id, userId: t.userId, text: textById.get(t.id) ?? "" }));

  console.log(`judging ${chosen.length} triggers with the real group judge\n`);

  const readings: string[] = [];
  const reasons = new Map<string, number>();
  /**
   * Which members a note actually rests on. Coverage is the number this goal
   * turns on: a board can be full of good notes and still leave a member with
   * nothing on it, and only the evidence owners say whether that happened.
   */
  /**
   * A judgment is not a note. Production applies two more gates before anything
   * reaches a board, and an eval that skips them measures the judge rather than
   * the board — which made earlier runs of this read twice as good as the board
   * they were meant to predict.
   */
  const discarded = new Map<string, number>();
  const evidenceByMember = new Map<string, number>();
  const notesByMember = new Map<string, number>();
  /**
   * Members reached by the time the Nth note exists.
   *
   * Production stops at `TARGET_NOTES`, so a member whose trigger comes after
   * that point is never asked — their absence from the board says nothing about
   * whether their signals combine. This sweep asks everyone, which measures
   * something different, so record the stopping point too.
   */
  const TARGET_NOTES = 6;
  /**
   * Every reading that cleared the gates, in the order the pass reached them.
   *
   * Kept so one generation can be turned into TWO walls — the six arrival
   * order would show, and the six selection picks. Same readings, same judge
   * calls, so the comparison costs nothing beyond a handful of embeddings.
   */
  const survivors: Array<{
    title: string;
    belief: string;
    ownerIds: string[];
    wowScore: number;
  }> = [];
  const membersAtTarget = new Set<string>();
  let coverageAtTarget: number | null = null;

  for (const [i, trigger] of chosen.entries()) {
    const who = members.find((m) => m.userId === trigger.userId)?.name ?? "?";
    process.stdout.write(`  [${i + 1}/${chosen.length}] ${who}: ${preview(trigger.text, 42)} … `);
    try {
      const judgment = await judgeGroupWowMoment({
        db,
        memberUserIds,
        triggerUserId: trigger.userId,
        triggerInspirationId: trigger.id,
      });
      if (judgment.isWowMoment) {
        // Gate 1: evidence must span two members, or it is one person's note.
        const ownersBySignalId = await loadOwnersBySignalId(
          db as never,
          judgment.relatedInspirationIds,
        );
        const distinctOwners = new Set(
          judgment.relatedInspirationIds
            .map((id) => ownersBySignalId.get(id))
            .filter((uid): uid is string => Boolean(uid)),
        );
        if (distinctOwners.size < 2) {
          discarded.set("single_owner", (discarded.get("single_owner") ?? 0) + 1);
          console.log("judged, discarded (single owner)");
          continue;
        }
        // Gate 2: spanning two members but saying only what one already says.
        if (await restatesASingleMember(db as never, judgment, ownersBySignalId)) {
          discarded.set("restates_one_member", (discarded.get("restates_one_member") ?? 0) + 1);
          console.log("judged, discarded (restates one member)");
          continue;
        }

        readings.push(judgment.title);
        survivors.push({
          title: judgment.title,
          belief: judgment.beliefStatement ?? judgment.why,
          ownerIds: [...distinctOwners],
          wowScore: trigger.wowScore ?? 0,
        });
        const owners = await db
          .select({ id: signals.id, userId: signals.userId })
          .from(signals)
          .where(inArray(signals.id, judgment.relatedInspirationIds));
        const seen = new Set<string>();
        for (const row of owners) {
          const name = members.find((m) => m.userId === row.userId)?.name ?? "?";
          evidenceByMember.set(name, (evidenceByMember.get(name) ?? 0) + 1);
          seen.add(name);
        }
        for (const name of seen) {
          notesByMember.set(name, (notesByMember.get(name) ?? 0) + 1);
          if (readings.length <= TARGET_NOTES) membersAtTarget.add(name);
        }
        if (readings.length === TARGET_NOTES && coverageAtTarget === null) {
          coverageAtTarget = membersAtTarget.size;
        }
        console.log(`reading  [${[...seen].join(" + ")}]`);
      } else {
        reasons.set(judgment.reason, (reasons.get(judgment.reason) ?? 0) + 1);
        console.log(`no (${judgment.reason})`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      reasons.set("threw", (reasons.get("threw") ?? 0) + 1);
      console.log(`error (${preview(msg, 50)})`);
    }
  }

  if (discarded.size > 0) {
    console.log("\n--- judged, then discarded before reaching a board ---\n");
    for (const [why, n] of [...discarded].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(n).padStart(3)}  ${why}`);
    }
  }

  console.log(`\n--- readings that survive to a board (${readings.length}/${chosen.length}) ---\n`);
  for (const r of readings) console.log(`  "${r}"`);

  if (reasons.size > 0) {
    console.log("\n--- not a reading ---\n");
    for (const [reason, n] of [...reasons].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(n).padStart(3)}  ${reason}`);
    }
  }

  // Coverage: how many members a board actually rests on. A board can be full
  // of good notes and still leave someone with nothing on it, which is the
  // failure this goal exists to measure.
  console.log("\n--- who the readings rest on ---\n");
  for (const member of members) {
    const evidence = evidenceByMember.get(member.name) ?? 0;
    const inNotes = notesByMember.get(member.name) ?? 0;
    const bar = evidence > 0 ? "#".repeat(Math.min(20, evidence)) : "";
    console.log(
      `  ${String(member.name).padEnd(14)} ${String(evidence).padStart(3)} evidence  ` +
        `in ${String(inNotes).padStart(2)} notes  ${bar}`,
    );
  }
  const covered = members.filter((m) => (evidenceByMember.get(m.name) ?? 0) > 0).length;
  console.log(`\n  coverage: ${covered}/${members.length} members (every trigger asked)`);
  console.log(
    `  coverage at ${TARGET_NOTES} notes: ` +
      (coverageAtTarget === null
        ? `n/a — the pass produced only ${readings.length}`
        : `${coverageAtTarget}/${members.length} — what production sees, since it stops there`),
  );

  // The number that matters for quality. The previous run produced nine readings
  // that were near-restatements of one another; if that has not moved, labelling
  // whose signal is whose changed the prompt and not the product.
  let mean = 0;
  let worst = 0;
  let semanticExcess: number | null = null;
  if (readings.length > 1) {
    let total = 0;
    let pairs = 0;
    for (let i = 0; i < readings.length; i += 1) {
      for (let j = i + 1; j < readings.length; j += 1) {
        const o = overlap(readings[i]!, readings[j]!);
        total += o;
        worst = Math.max(worst, o);
        pairs += 1;
      }
    }
    mean = total / pairs;
    console.log("\n--- do the readings repeat each other? ---\n");
    console.log(`  mean pairwise word overlap: ${mean.toFixed(2)} (lexical, secondary)`);
    console.log(`  most similar pair:          ${worst.toFixed(2)}`);

  /**
   * The two walls, side by side.
   *
   * This is the whole point of holding the survivors: one generation pass, two
   * boards. The left is what arrival order shows today — the first six that
   * cleared the gates. The right is what selection picks — the six covering
   * the most people and saying the most different things.
   *
   * Same readings and the same judge calls produced both, so the comparison
   * costs a handful of embeddings and nothing else. The verdict is yours: read
   * both and say which wall you would rather have on a wall.
   */
  if (survivors.length > TARGET_NOTES) {
    console.log(`\n--- the same ${survivors.length} readings, two ways ---\n`);

    const arrival = survivors.slice(0, TARGET_NOTES);

    let picked = arrival;
    try {
      const embedder = new GeminiEmbeddingHttpClient();
      const vectors = await Promise.all(
        survivors.map((r) => embedder.embed(`${r.title}\n${r.belief}`)),
      );
      const chosenIds = new Set(
        selectBoard(
          survivors.map((r, i) => ({
            id: String(i),
            embedding: vectors[i] ?? [],
            ownerIds: r.ownerIds,
            quality: Math.max(0, Math.min(1, r.wowScore / 100)),
          })),
          TARGET_NOTES,
        ).map((c) => c.id),
      );
      picked = survivors.filter((_, i) => chosenIds.has(String(i)));
    } catch (err) {
      console.log(`  (could not embed to select: ${err instanceof Error ? err.message : String(err)})`);
    }

    const reach = (rows: typeof survivors) =>
      new Set(rows.flatMap((r) => r.ownerIds)).size;

    console.log("  ARRIVAL ORDER — what the wall shows today");
    for (const r of arrival) console.log(`    · ${preview(r.title, 68)}`);
    console.log(`    reaches ${reach(arrival)} members`);

    console.log("\n  SELECTED — what the editor picks");
    for (const r of picked) console.log(`    · ${preview(r.title, 68)}`);
    console.log(`    reaches ${reach(picked)} members`);

    const changed = picked.filter((r) => !arrival.some((a) => a.title === r.title)).length;
    console.log(`\n  ${changed} of ${TARGET_NOTES} places differ between the two walls.`);
    console.log("  Read both. Which one covers more distinct ideas?");
  }

    /**
     * The verdict is semantic. Words are what a board happens to use; meaning
     * is what it says, and collapse is a claim about meaning.
     */
    try {
      const embedder = new GeminiEmbeddingHttpClient();
      const vectors = await Promise.all(readings.map((text) => embedder.embed(text)));
      const within = meanPairwiseCosine(vectors);

      const baseline = meanPairwiseCosine(
        await Promise.all(BASELINE_CORPUS.map((line) => embedder.embed(line))),
      );
      const excess = collapseExcess(within, baseline);
      semanticExcess = excess;
      console.log(`  mean pairwise cosine:       ${within.toFixed(3)}`);
      console.log(`  baseline (unrelated notes): ${baseline.toFixed(3)}`);
      console.log(
        `  collapse excess:            ${excess === null ? "n/a" : excess.toFixed(2)} (0 = as varied as unrelated notes, 1 = identical)`,
      );
      // No verdict: see `collapseExcess`. On the one labelled pair available
      // this number ranked a known-collapsed board ABOVE a plural one, so
      // printing "distinct" here would be the old bug in a new unit.
      console.log(
        "\n  Not calibrated — compare across runs, do not read as pass/fail.\n",
      );
    } catch (err) {
      // A failed measurement is reported as absent, never as a pass.
      console.log(
        `  semantic:                   could not measure (${err instanceof Error ? err.message : String(err)})`,
      );
    }
  }

  // One line, machine-readable, so two runs diff without reading prose. This is
  // what the goal's gates are judged on.
  const refused = [...reasons]
    .sort((a, b) => b[1] - a[1])
    .map(([reason, n]) => `${reason}:${n}`)
    .join(",");
  console.log(
    `\nVARIANT=${opts.variant} reach=${opts.reach} evidence=${opts.evidence} notes=${readings.length}/${chosen.length} ` +
      `coverage=${covered}/${members.length} ` +
      `covAtTarget=${coverageAtTarget ?? "na"}/${members.length} ` +
      `overlap=${mean.toFixed(2)} ` +
      `collapse=${semanticExcess === null ? "na" : semanticExcess.toFixed(2)} ` +
      `worst=${worst.toFixed(2)} refused={${refused}} ` +
      `discarded={${[...discarded].map(([w, n]) => `${w}:${n}`).join(",")}}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
