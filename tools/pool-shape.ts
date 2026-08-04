#!/usr/bin/env tsx
/**
 * Pool shape — is the board narrow because the room is narrow?
 *
 * Every reading on Waka's board, in both the baseline and the boardSoFar runs,
 * came out as one idea grounded in `[someone + Yunji]`. Three explanations fit
 * that, and they need completely different fixes:
 *
 *   1. Retrieval concentrates — one member's signals fill every candidate pool.
 *   2. The judge concentrates — pools are balanced, the judge keeps citing one.
 *   3. The ROOM is narrow — the shared signals genuinely are one topic, and no
 *      amount of judge or retrieval work can produce readings that are not there.
 *
 * No model calls: this only reads stored embeddings. Run it before writing any
 * more prompt code, because (3) invalidates every fix aimed at (1) or (2).
 *
 * Usage: pnpm tsx tools/pool-shape.ts --group <uuid>
 */

import { config as loadDotenv } from "dotenv";

loadDotenv({ path: ".env.local" });
loadDotenv();

import { and, eq, inArray } from "drizzle-orm";

import {
  groupMembers,
  inspirationEmbeddings,
  signals,
  users,
} from "../packages/api/src/db/index";
import { getDb } from "../packages/api/src/lib/db";
import { cosineSimilarity } from "../packages/api/src/scoring/wow-score";

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

function bar(value: number, width = 40): string {
  return "#".repeat(Math.max(0, Math.round(value * width)));
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const groupId = argv[argv.indexOf("--group") + 1];
  if (!groupId || !argv.includes("--group")) {
    console.error("usage: pnpm tsx tools/pool-shape.ts --group <uuid>");
    process.exitCode = 1;
    return;
  }

  const db = getDb();

  const members = await db
    .select({ userId: groupMembers.userId, name: users.name })
    .from(groupMembers)
    .innerJoin(users, eq(users.id, groupMembers.userId))
    .where(eq(groupMembers.groupId, groupId));

  const memberIds = members.map((m) => m.userId);
  const nameById = new Map(members.map((m) => [m.userId, m.name]));

  const rows = await db
    .select({
      id: signals.id,
      userId: signals.userId,
      text: signals.text,
      wowScore: signals.wowScore,
      embedding: inspirationEmbeddings.embedding,
    })
    .from(signals)
    .innerJoin(
      inspirationEmbeddings,
      and(
        eq(inspirationEmbeddings.inspirationId, signals.id),
        eq(inspirationEmbeddings.userId, signals.userId),
      ),
    )
    .where(and(inArray(signals.userId, memberIds), eq(signals.sharedToGroups, true)));

  const pool = rows
    .map((r) => ({ ...r, embedding: r.embedding as number[] | null }))
    .filter((r): r is typeof r & { embedding: number[] } => Array.isArray(r.embedding));

  console.log(`\nroom: ${members.length} members · ${pool.length} shared+embedded signals\n`);

  // --- who holds the pool -------------------------------------------------
  console.log("--- shared signals per member ---\n");
  for (const m of members) {
    const mine = pool.filter((s) => s.userId === m.userId);
    const scores = mine.map((s) => s.wowScore);
    console.log(
      `  ${(m.name ?? "?").padEnd(14)} ${String(mine.length).padStart(3)} signals` +
        `   wow_score avg ${String(Math.round(mean(scores))).padStart(3)}` +
        `  ${bar(mine.length / Math.max(1, pool.length), 24)}`,
    );
  }

  // --- how alike is the room with itself ----------------------------------
  const within: number[] = [];
  const across: number[] = [];
  for (let i = 0; i < pool.length; i += 1) {
    for (let j = i + 1; j < pool.length; j += 1) {
      const a = pool[i]!;
      const b = pool[j]!;
      if (a.embedding.length !== b.embedding.length) continue;
      const sim = cosineSimilarity(a.embedding, b.embedding);
      (a.userId === b.userId ? within : across).push(sim);
    }
  }

  console.log("\n--- how alike are the shared signals? ---\n");
  console.log(`  same member, pairwise mean:   ${mean(within).toFixed(3)}`);
  console.log(`  across members, pairwise mean: ${mean(across).toFixed(3)}   <- groupBaseline`);
  console.log(`  whole pool, pairwise mean:    ${mean([...within, ...across]).toFixed(3)}`);

  // --- per member: how central are they to everyone else? -----------------
  console.log("\n--- centrality: mean similarity to OTHER members' signals ---\n");
  const centrality: { name: string; value: number }[] = [];
  for (const m of members) {
    const mine = pool.filter((s) => s.userId === m.userId);
    const theirs = pool.filter((s) => s.userId !== m.userId);
    const sims: number[] = [];
    for (const a of mine) {
      for (const b of theirs) {
        if (a.embedding.length !== b.embedding.length) continue;
        sims.push(cosineSimilarity(a.embedding, b.embedding));
      }
    }
    centrality.push({ name: m.name ?? "?", value: mean(sims) });
  }
  centrality.sort((a, b) => b.value - a.value);
  for (const c of centrality) {
    console.log(`  ${c.name.padEnd(14)} ${c.value.toFixed(3)}  ${bar(c.value)}`);
  }

  // --- is it the room, or the embeddings? ---------------------------------
  //
  // The decisive question. If the *least* similar pair of signals in this room
  // is still high and the two texts are obviously about different things, then
  // the embedding cannot separate them and no downstream threshold can either —
  // the fix is representation, not prompting or ranking.
  const pairs: { a: (typeof pool)[number]; b: (typeof pool)[number]; sim: number }[] = [];
  for (let i = 0; i < pool.length; i += 1) {
    for (let j = i + 1; j < pool.length; j += 1) {
      const a = pool[i]!;
      const b = pool[j]!;
      if (a.embedding.length !== b.embedding.length) continue;
      pairs.push({ a, b, sim: cosineSimilarity(a.embedding, b.embedding) });
    }
  }
  pairs.sort((x, y) => x.sim - y.sim);

  const short = (t: string, n = 52) => {
    const s = t.replace(/\s+/g, " ").trim();
    return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
  };

  console.log("\n--- the 5 LEAST similar pairs in the whole room ---\n");
  for (const p of pairs.slice(0, 5)) {
    console.log(`  ${p.sim.toFixed(3)}`);
    console.log(`      ${(nameById.get(p.a.userId) ?? "?").padEnd(12)} ${short(p.a.text)}`);
    console.log(`      ${(nameById.get(p.b.userId) ?? "?").padEnd(12)} ${short(p.b.text)}`);
  }

  const spread = (pairs.at(-1)?.sim ?? 0) - (pairs[0]?.sim ?? 0);
  console.log(`\n  cosine range across all ${pairs.length} pairs: ` +
    `${pairs[0]?.sim.toFixed(3)} … ${pairs.at(-1)?.sim.toFixed(3)}  (spread ${spread.toFixed(3)})`);

  console.log(
    "\nRead it this way: if `across members` is high (say >0.80) the room genuinely\n" +
      "says one thing and no judge or retrieval fix will invent a second. If it is\n" +
      "moderate and one member's centrality stands well above the rest, the pool is\n" +
      "being flattened toward that member and the fix is in retrieval.\n",
  );

  process.exit(0);
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
