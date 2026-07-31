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

import { groupMembers, groups, signals, users } from "../packages/api/src/db/index";
import { getDb } from "../packages/api/src/lib/db";
import { judgeGroupWowMoment } from "../packages/api/src/lib/wow-judge";

function parseArgs(argv: string[]) {
  let groupId: string | undefined;
  let triggers = 10;
  let list = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--group") groupId = argv[++i];
    else if (argv[i] === "--triggers") triggers = Number.parseInt(argv[++i] ?? "10", 10);
    else if (argv[i] === "--list") list = true;
  }
  if (!Number.isFinite(triggers) || triggers < 1) triggers = 10;
  return { groupId, triggers, list };
}

function preview(text: string, max = 78): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

/** Crude similarity, only to show whether the readings repeat each other. */
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

  // Spread triggers across members so no single archive drives every reading.
  const perMember = Math.max(1, Math.ceil(opts.triggers / members.length));
  const chosen: Array<{ id: string; userId: string; text: string }> = [];
  for (const member of members) {
    const mine = await db
      .select({ id: signals.id, userId: signals.userId, text: signals.text })
      .from(signals)
      .where(and(eq(signals.userId, member.userId), eq(signals.sharedToGroups, true)))
      .orderBy(desc(signals.wowScore))
      .limit(perMember);
    chosen.push(...mine);
  }

  console.log(`judging ${chosen.length} triggers with the real group judge\n`);

  const readings: string[] = [];
  const reasons = new Map<string, number>();

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
        readings.push(judgment.title);
        console.log("reading");
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

  console.log(`\n--- readings (${readings.length}/${chosen.length}) ---\n`);
  for (const r of readings) console.log(`  "${r}"`);

  if (reasons.size > 0) {
    console.log("\n--- not a reading ---\n");
    for (const [reason, n] of [...reasons].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(n).padStart(3)}  ${reason}`);
    }
  }

  // The number that matters. The previous run produced nine readings that were
  // near-restatements of one another; if that has not moved, labelling whose
  // signal is whose changed the prompt and not the product.
  if (readings.length > 1) {
    let total = 0;
    let pairs = 0;
    let worst = 0;
    for (let i = 0; i < readings.length; i += 1) {
      for (let j = i + 1; j < readings.length; j += 1) {
        const o = overlap(readings[i]!, readings[j]!);
        total += o;
        worst = Math.max(worst, o);
        pairs += 1;
      }
    }
    const mean = total / pairs;
    console.log("\n--- do the readings repeat each other? ---\n");
    console.log(`  mean pairwise word overlap: ${mean.toFixed(2)}`);
    console.log(`  most similar pair:          ${worst.toFixed(2)}`);
    console.log(
      mean > 0.45
        ? "\n  Still collapsing: the judge is saying one thing several ways.\n"
        : "\n  Readings are distinct from one another.\n",
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
