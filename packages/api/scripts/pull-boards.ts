/**
 * Phase-5 preview (durable-interest): the founder blind judgment, brought
 * forward. Computes BOTH rankings over the real archive — the shipped
 * arithmetic (currentWeight/movementScore) and the new state (S, states,
 * Importance) — so the founder can judge blind which list better answers
 * "what still races after the novelty wore off."
 *
 * Read-only. Zero model calls. Awareness is 0 for every node (no adopted
 * solo ambitions exist yet), so Discovery ≡ Importance in this preview.
 */
import { resolve } from "node:path";
import { writeFileSync } from "node:fs";
import { config as loadDotenv } from "dotenv";
import postgres from "postgres";

import {
  evidenceGrade,
  meanRetrievabilityOverWindow,
  replayStability,
  retrievability,
  silenceDiagnostics,
  stabilityGradeForEvent,
  importanceScore,
  type StabilityEvent,
  type StabilityGradeEvent,
} from "../src/scoring/stability.js";
import { deriveMemoryPattern } from "../src/lib/memory-movement.js";

const DAY_MS = 86_400_000;
const CLOSURE_CUES = ["signed the lease", "signed the contract", "done with",
  "finished the", "completed the", "wrapped up", "it's over", "gave up on",
  "giving up on", "decided to stop", "no longer ", "calling it done"];
const GRADED = ["detail_opened", "detail_returned", "reflection_created", "inspiration_updated"];

loadDotenv({ path: process.env.WAKA_API_DOTENV_PATH ?? resolve(process.cwd(), "../../.env.local") });
const sql = postgres(process.env.DB_CONNECTION_URL!, { max: 1, prepare: false });

const now = new Date();
const uid = (await sql`SELECT id FROM users WHERE email='yjchung9806@gmail.com'`)[0].id as string;

const nodes = await sql`SELECT id, type, label, weight, confidence FROM context_nodes WHERE user_id=${uid}`;
const evidence = await sql`
  SELECT ce.context_node_id AS nid, ce.signal_id AS sid, ce.weight, ce.confidence, ce.created_at,
         s.kind, left(s.text, 200) AS text
  FROM context_evidence ce JOIN signals s ON s.id = ce.signal_id
  WHERE ce.user_id=${uid} ORDER BY ce.created_at ASC`;
const revisits = await sql`
  SELECT signal_id AS sid, event_type, created_at FROM signal_revisit_events
  WHERE user_id=${uid} AND event_type::text = ANY(${sql.array(GRADED)}) ORDER BY created_at ASC`;

const evByNode = new Map<string, typeof evidence>();
for (const row of evidence) {
  const list = evByNode.get(row.nid as string) ?? [] as never;
  (list as unknown[]).push(row);
  evByNode.set(row.nid as string, list);
}
const rvBySig = new Map<string, typeof revisits>();
for (const row of revisits) {
  const list = rvBySig.get(row.sid as string) ?? [] as never;
  (list as unknown[]).push(row);
  rvBySig.set(row.sid as string, list);
}

const out: Record<string, unknown>[] = [];
for (const node of nodes) {
  const evs = evByNode.get(node.id as string);
  if (!evs || evs.length < 2) continue;

  const events: StabilityEvent[] = evs.map((r) => ({ at: new Date(r.created_at as string), grade: evidenceGrade(0.5) }));
  for (const r of evs) {
    for (const rv of rvBySig.get(r.sid as string) ?? []) {
      const at = new Date(rv.created_at as string);
      if (at.getTime() >= new Date(r.created_at as string).getTime() && at <= now) {
        events.push({ at, grade: stabilityGradeForEvent(rv.event_type as StabilityGradeEvent) });
      }
    }
  }
  const replay = replayStability(events);
  const S = replay.state!.stability;
  const diag = silenceDiagnostics(events, now);
  const openGap = diag.openGapDays;
  const R = retrievability(openGap, S);

  // state per the goal doc's Phase 4 rules (closure via provisional cues)
  const lastTexts = evs.slice(-2).map((r) => String(r.text ?? "").toLowerCase()).join(" ");
  const closure = CLOSURE_CUES.some((cue) => lastTexts.includes(cue));
  const firstAgeDays = (now.getTime() - replay.steps[0].at.getTime()) / DAY_MS;
  const deepComeback = replay.steps.some((st) =>
    st.gapDays >= 120 && st.retrievabilityBefore < 0.6 &&
    (now.getTime() - st.at.getTime()) / DAY_MS <= 120);
  let state: string;
  if (diag.silent) {
    state = closure ? "resolved" : diag.stretching ? "fading"
      : diag.calendarLocked ? "dormant (seasonal)" : "dormant";
  } else if (deepComeback) state = "reactivated";
  else if (firstAgeDays <= 90) state = "emerging";
  else if (S >= 60) state = "active";
  else state = "warm";

  const kinds = new Set(evs.map((r) => (r.kind as string) ?? "unknown"));
  const imp = importanceScore(S, kinds.size);
  const pattern = deriveMemoryPattern({
    node: {
      id: node.id as string, type: node.type as string,
      weight: evs.reduce((a, r) => a + Number(r.weight), 0),
      confidence: evs.reduce((a, r) => Math.max(a, Number(r.confidence)), 0),
      evidenceCount: evs.length,
      firstSeenAt: new Date(evs[0].created_at as string),
      lastReinforcedAt: new Date(evs[evs.length - 1].created_at as string),
    },
    evidence: evs.map((r) => ({ meaningNodeId: node.id as string, inspirationId: r.sid as string,
      createdAt: new Date(r.created_at as string), weight: Number(r.weight) })),
    now,
  });

  const months = new Set(evs.map((r) => String(r.created_at).slice(0, 7)));
  const maxGap = Math.max(0, ...replay.steps.map((st) => st.gapDays));
  out.push({
    label: node.label, type: node.type,
    saves: evs.length, months: months.size, maxGapDays: Math.round(maxGap),
    firstSeen: String(evs[0].created_at).slice(0, 10),
    S: +S.toFixed(1), R: +R.toFixed(2), state,
    importance: +imp.toFixed(1), er28: +meanRetrievabilityOverWindow(S, openGap, 28).toFixed(3),
    currentWeight: pattern.currentWeight, movementScore: +pattern.movementScore.toFixed(0),
    openGapDays: Math.round(openGap), envelopeDays: Math.round(diag.envelopeDays),
    stretching: diag.stretching, calendarLocked: diag.calendarLocked, closure,
  });
}

const oldBoard = [...out].sort((a, b) => (b.currentWeight as number) - (a.currentWeight as number));
const newBoard = [...out].sort((a, b) => (b.importance as number) - (a.importance as number));
writeFileSync(process.argv[2] ?? "/tmp/pull-boards.json", JSON.stringify({ generatedAt: now.toISOString(), oldBoard, newBoard }, null, 2));
console.log(`nodes scored: ${out.length}`);
console.log("\n=== OLD (currentWeight) top 10 ===");
for (const [i, n] of oldBoard.slice(0, 10).entries()) console.log(` ${i + 1}. [${n.type}] ${String(n.label).slice(0, 70)}  · cw ${n.currentWeight} · mv ${n.movementScore}`);
console.log("\n=== NEW (Importance/S) top 10 ===");
for (const [i, n] of newBoard.slice(0, 10).entries()) console.log(` ${i + 1}. [${n.type}] ${String(n.label).slice(0, 70)}  · S ${n.S}d · Imp ${n.importance} · ${n.state}`);
await sql.end();
