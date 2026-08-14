/**
 * Compute-at-read node dynamics — Phases 2–5 of the durable-interest goal
 * under the founder's 2026-08-09 expedition (goal Log): the S/R state is
 * replayed per request instead of stored in columns, because the math is a
 * pure function of the event log and a migration here would conflict with
 * in-flight branches. Milliseconds at current scale; columns follow in a
 * quiet migration window.
 *
 * The surfaces consume:
 *   - `tomRank`  — E[R over 28 d] × a state weight: what deserves the
 *     person's scarce attention now (top-of-mind pools, synthesis input).
 *   - `importance` / `discovery` — durable standing for discovery boards.
 *   - `state` — the lifecycle label; silence has a cause, never a penalty.
 */

import { sql } from "drizzle-orm";

import type { WakaDb } from "./inspiration-embeddings.js";
import {
  evidenceGrade,
  importanceScore,
  meanRetrievabilityOverWindow,
  replayStability,
  retrievability,
  silenceDiagnostics,
  stabilityGradeForEvent,
  type StabilityEvent,
  type StabilityGradeEvent,
} from "../scoring/stability.js";

export type NodeLifecycleState =
  | "emerging"
  | "active"
  | "warm"
  | "reactivated"
  | "dormant"
  | "fading"
  | "resolved";

/**
 * Provisional Phase-5 state weights for the top-of-mind pool, recorded in
 * the goal Log and founder-tunable: a deep comeback outranks everything
 * (the moment worth speaking to), silence discounts attention without ever
 * deleting standing, and a consummated goal asks for the least.
 */
export const TOM_STATE_WEIGHTS: Record<NodeLifecycleState, number> = {
  reactivated: 1.25,
  emerging: 1.1,
  active: 1.0,
  warm: 0.95,
  dormant: 0.6,
  fading: 0.55,
  resolved: 0.4,
};

/** Provisional closure cues (judged closure arrives with the sleep cycle). */
const CLOSURE_CUES = [
  "signed the lease", "signed the contract", "done with", "finished the",
  "completed the", "wrapped up", "it's over", "gave up on", "giving up on",
  "decided to stop", "no longer ", "calling it done",
];

const DAY_MS = 86_400_000;

export interface NodeDynamicsEventInput {
  nodeId: string;
  at: Date;
  /** Present on evidence rows: the citing signal's trailing text sample. */
  textSample?: string | null;
  /** Present on revisit-derived events. */
  revisitType?: StabilityGradeEvent;
  /** Distinct capture channel of the citing signal (evidence rows only). */
  channel?: string | null;
}

export interface NodeDynamics {
  nodeId: string;
  stability: number;
  retrievabilityNow: number;
  expectedRetrievability28: number;
  state: NodeLifecycleState;
  seasonal: boolean;
  importance: number;
  /** Importance × (1 − awareness); awareness is 0 until ambitions are adopted. */
  discovery: number;
  tomRank: number;
}

/** Pure core: events in (already scoped ≤ now), dynamics out. */
export function computeNodeDynamics(
  eventsByNode: Map<string, NodeDynamicsEventInput[]>,
  now: Date,
): Map<string, NodeDynamics> {
  const out = new Map<string, NodeDynamics>();
  for (const [nodeId, raw] of eventsByNode) {
    const events: StabilityEvent[] = raw.map((event) => ({
      at: event.at,
      grade: event.revisitType
        ? stabilityGradeForEvent(event.revisitType)
        : evidenceGrade(0.5),
    }));
    if (events.length === 0) continue;

    const replay = replayStability(events);
    const stability = replay.state!.stability;
    const diagnostics = silenceDiagnostics(events, now);
    const retrievabilityNow = retrievability(diagnostics.openGapDays, stability);
    const expectedRetrievability28 = meanRetrievabilityOverWindow(
      stability,
      diagnostics.openGapDays,
      28,
    );

    const evidenceEvents = raw.filter((event) => !event.revisitType);
    const lastTexts = evidenceEvents
      .slice(-2)
      .map((event) => (event.textSample ?? "").toLowerCase())
      .join(" ");
    const closure = CLOSURE_CUES.some((cue) => lastTexts.includes(cue));
    const firstAgeDays =
      (now.getTime() - replay.steps[0].at.getTime()) / DAY_MS;
    const deepComeback = replay.steps.some(
      (step) =>
        step.gapDays >= 120 &&
        step.retrievabilityBefore < 0.6 &&
        (now.getTime() - step.at.getTime()) / DAY_MS <= 120,
    );

    let state: NodeLifecycleState;
    if (diagnostics.silent) {
      state = closure ? "resolved" : diagnostics.stretching ? "fading" : "dormant";
    } else if (deepComeback) {
      state = "reactivated";
    } else if (firstAgeDays <= 90) {
      state = "emerging";
    } else if (stability >= 60) {
      state = "active";
    } else {
      state = "warm";
    }

    const channels = new Set(
      evidenceEvents.map((event) => event.channel ?? "unknown"),
    );
    const importance = importanceScore(stability, channels.size);

    out.set(nodeId, {
      nodeId,
      stability,
      retrievabilityNow,
      expectedRetrievability28,
      state,
      seasonal: diagnostics.calendarLocked,
      importance,
      discovery: importance, // awareness = 0 until ambitions are adopted
      tomRank: expectedRetrievability28 * TOM_STATE_WEIGHTS[state],
    });
  }
  return out;
}

/**
 * Fetch a user's node event streams (evidence + graded returns on citing
 * signals, citation-time gated) and compute dynamics. Two indexed reads.
 */
export async function loadNodeDynamics(
  db: WakaDb,
  userId: string,
  now: Date = new Date(),
): Promise<Map<string, NodeDynamics>> {
  const rows = (await db.execute(sql`
    SELECT ce.context_node_id AS "nodeId", ce.created_at AS "at",
           right(s.text, 160) AS "textSample", s.kind AS "channel",
           NULL AS "revisitType"
    FROM context_evidence ce JOIN signals s ON s.id = ce.signal_id
    WHERE ce.user_id = ${userId} AND ce.created_at <= ${now.toISOString()}::timestamptz
    UNION ALL
    SELECT ce.context_node_id, r.created_at, NULL, NULL, r.event_type::text
    FROM signal_revisit_events r
    JOIN context_evidence ce ON ce.signal_id = r.signal_id AND ce.user_id = r.user_id
    WHERE r.user_id = ${userId}
      AND r.event_type::text IN ('detail_opened','detail_returned','reflection_created','inspiration_updated')
      AND r.created_at >= ce.created_at
      AND r.created_at <= ${now.toISOString()}::timestamptz
    ORDER BY 2 ASC
  `)) as unknown as Array<{
    nodeId: string;
    at: Date | string;
    textSample: string | null;
    channel: string | null;
    revisitType: string | null;
  }>;

  const eventsByNode = new Map<string, NodeDynamicsEventInput[]>();
  for (const row of rows) {
    const list = eventsByNode.get(row.nodeId) ?? [];
    list.push({
      nodeId: row.nodeId,
      at: row.at instanceof Date ? row.at : new Date(row.at),
      textSample: row.textSample,
      channel: row.channel,
      revisitType: (row.revisitType as StabilityGradeEvent | null) ?? undefined,
    });
    eventsByNode.set(row.nodeId, list);
  }
  return computeNodeDynamics(eventsByNode, now);
}

/**
 * Order a node list for the top-of-mind pool: tomRank descending, nodes
 * without dynamics (no evidence yet) last in their incoming order.
 */
export function orderByTomRank<T extends { id: string }>(
  nodes: T[],
  dynamics: Map<string, NodeDynamics>,
): T[] {
  return [...nodes].sort((a, b) => {
    const ra = dynamics.get(a.id)?.tomRank ?? -1;
    const rb = dynamics.get(b.id)?.tomRank ?? -1;
    return rb - ra;
  });
}
