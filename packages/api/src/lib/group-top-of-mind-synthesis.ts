/**
 * Group Top of Mind synthesis (US-053).
 *
 * Generates group notes by running the existing Top of Mind judge over the
 * POOLED shared inspirations of every member: each viable shared signal is used
 * as a trigger, its cross-member similar candidates are retrieved, and the judge
 * decides whether they form a group note. Results persist to the group-scoped
 * tables with per-evidence `owner_user_id`, so a note can cite inspirations from
 * several members and the board can tag each one with its owner.
 *
 * This is a genuine synthesis over the pooled signals — not a merge of each
 * member's already-generated personal notes.
 */

import { createHash } from "node:crypto";

import { and, desc, eq, inArray } from "drizzle-orm";

import {
  groupMembers,
  groupTopOfMindNoteSignals,
  groupTopOfMindNotes,
  inspirationEmbeddings,
  signals,
} from "../db/index.js";
import { getDb } from "./db.js";
import type { WakaDb } from "./inspiration-embeddings.js";
import type { SupportedLocale } from "./locales.js";
import { judgeGroupWowMoment, type WowMomentJudgment } from "./wow-judge.js";

// Bound the model calls per synthesis run. Each trigger is one judge call, and
// the judge is deliberately selective (many triggers return "no note"), so we
// try a healthy number of triggers, spread across members, to surface several
// group notes rather than one.
const MAX_TRIGGERS = 24;
const TARGET_NOTES = 6;
const CANDIDATE_LIMIT = 8;
// How many of each member's strongest shared signals to consider as triggers
// before interleaving. Keeps one prolific member from dominating the pass.
const PER_MEMBER_TRIGGER_CAP = 8;

export interface GroupSynthesisResult {
  triggersTried: number;
  notesCreated: number;
  notesExisting: number;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function isTransientModelError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /\b(503|429|500|502|504)\b/.test(msg) || /unavailable|overloaded|rate.?limit/i.test(msg);
}

/**
 * Judge a group trigger, retrying a few times on transient model errors (503
 * overloaded / 429 rate limit) with backoff so a brief provider blip does not
 * wipe out an entire synthesis pass.
 */
async function judgeGroupWithRetry(
  params: Parameters<typeof judgeGroupWowMoment>[0],
): Promise<WowMomentJudgment> {
  const delaysMs = [800, 2000, 4000];
  let lastError: unknown;
  for (let attempt = 0; attempt <= delaysMs.length; attempt += 1) {
    try {
      return await judgeGroupWowMoment(params);
    } catch (err) {
      lastError = err;
      if (attempt < delaysMs.length && isTransientModelError(err)) {
        await sleep(delaysMs[attempt]!);
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

async function loadMemberUserIds(db: WakaDb, groupId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: groupMembers.userId })
    .from(groupMembers)
    .where(eq(groupMembers.groupId, groupId));
  return rows.map((r) => r.userId);
}

/**
 * Shared, already-embedded signals to use as synthesis triggers, interleaved
 * round-robin across members so one prolific member does not dominate the pass
 * and cross-member combinations get a fair chance. Only shared signals are
 * eligible — private ones never seed group synthesis.
 */
async function loadTriggerSignals(
  db: WakaDb,
  memberUserIds: string[],
): Promise<Array<{ id: string; userId: string; wowScore: number }>> {
  if (memberUserIds.length === 0) return [];
  const rows = await db
    .select({
      id: signals.id,
      userId: signals.userId,
      wowScore: signals.wowScore,
    })
    .from(signals)
    .innerJoin(
      inspirationEmbeddings,
      and(
        eq(inspirationEmbeddings.inspirationId, signals.id),
        eq(inspirationEmbeddings.userId, signals.userId),
      ),
    )
    .where(and(inArray(signals.userId, memberUserIds), eq(signals.sharedToGroups, true)))
    .orderBy(desc(signals.wowScore), desc(signals.createdAt));

  // Group by member (de-duping signal ids), strongest first within each member.
  const byMember = new Map<string, Array<{ id: string; userId: string; wowScore: number }>>();
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    const bucket = byMember.get(r.userId) ?? [];
    if (bucket.length < PER_MEMBER_TRIGGER_CAP) {
      bucket.push(r);
      byMember.set(r.userId, bucket);
    }
  }

  // Round-robin interleave across members up to MAX_TRIGGERS.
  const buckets = [...byMember.values()];
  const out: Array<{ id: string; userId: string; wowScore: number }> = [];
  for (let i = 0; out.length < MAX_TRIGGERS; i += 1) {
    let advanced = false;
    for (const bucket of buckets) {
      if (i < bucket.length) {
        out.push(bucket[i]!);
        advanced = true;
        if (out.length >= MAX_TRIGGERS) break;
      }
    }
    if (!advanced) break;
  }
  return out;
}

/**
 * Crude lexical overlap, used only to catch a note that paraphrases one
 * member's own signals.
 *
 * Deliberately generous: this rejects near-copies, not merely-related
 * readings. It must never be the reason a genuinely new reading is discarded,
 * so the bar is set where only restatement clears it.
 */
const SINGLE_MEMBER_RESTATEMENT_THRESHOLD = 0.82;

function contentTokens(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((token) => token.length > 2),
  );
}

/** What share of the note's own words already appear in `source`. */
function overlapRatio(note: string, source: string): number {
  const left = contentTokens(note);
  if (left.size === 0) return 0;
  const right = contentTokens(source);
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / left.size;
}

async function restatesASingleMember(
  db: WakaDb,
  judgment: Extract<WowMomentJudgment, { isWowMoment: true }>,
  ownersBySignalId: Map<string, string>,
): Promise<boolean> {
  const ids = judgment.relatedInspirationIds.filter((id) => ownersBySignalId.has(id));
  if (ids.length === 0) return false;

  const rows = await db
    .select({ id: signals.id, userId: signals.userId, text: signals.text })
    .from(signals)
    .where(inArray(signals.id, ids));

  const textsByOwner = new Map<string, string[]>();
  for (const row of rows) {
    const bucket = textsByOwner.get(row.userId) ?? [];
    bucket.push(row.text);
    textsByOwner.set(row.userId, bucket);
  }

  const note = `${judgment.title} ${judgment.why ?? ""}`;
  for (const texts of textsByOwner.values()) {
    if (overlapRatio(note, texts.join(" ")) >= SINGLE_MEMBER_RESTATEMENT_THRESHOLD) {
      return true;
    }
  }
  return false;
}

async function loadOwnersBySignalId(
  db: WakaDb,
  signalIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (signalIds.length === 0) return map;
  const rows = await db
    .select({ id: signals.id, userId: signals.userId, shared: signals.sharedToGroups })
    .from(signals)
    .where(inArray(signals.id, signalIds));
  for (const r of rows) {
    // Defense in depth: never attribute (or expose) a signal that isn't shared.
    if (r.shared) map.set(r.id, r.userId);
  }
  return map;
}

function idempotencyKeyFor(
  groupId: string,
  judgment: Extract<WowMomentJudgment, { isWowMoment: true }>,
  locale: string,
): string {
  const ids = [...judgment.relatedInspirationIds].sort().join(",");
  return createHash("sha256")
    .update(`${groupId}|${judgment.kind}|${ids}|${locale}`)
    .digest("hex");
}

async function persistGroupNote(
  db: WakaDb,
  input: {
    groupId: string;
    judgment: Extract<WowMomentJudgment, { isWowMoment: true }>;
    locale: SupportedLocale;
    triggerWowScore: number;
    ownersBySignalId: Map<string, string>;
  },
): Promise<"created" | "existing" | "skipped"> {
  const sourceEvidenceById = new Map(
    input.judgment.sourceEvidence.map((e) => [e.inspirationId, e]),
  );
  // Keep only related ids whose owner is a real, still-shared member signal.
  const relatedIds = input.judgment.relatedInspirationIds.filter((id) =>
    input.ownersBySignalId.has(id),
  );
  if (relatedIds.length === 0) return "skipped";

  const idempotencyKey = idempotencyKeyFor(input.groupId, input.judgment, input.locale);

  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(groupTopOfMindNotes)
      .values({
        groupId: input.groupId,
        title: input.judgment.title,
        kind: input.judgment.kind,
        idempotencyKey,
        why: input.judgment.why,
        beliefStatement: input.judgment.beliefStatement ?? null,
        reflectionQuestion: input.judgment.reflectionQuestion ?? null,
        reflectionGuide: input.judgment.reflectionGuide ?? null,
        locale: input.locale,
        wowScore: input.triggerWowScore,
      })
      .onConflictDoNothing({
        target: [groupTopOfMindNotes.groupId, groupTopOfMindNotes.idempotencyKey],
      })
      .returning({ id: groupTopOfMindNotes.id });

    if (!created) return "existing"; // idempotent: this note already exists

    await tx
      .insert(groupTopOfMindNoteSignals)
      .values(
        relatedIds.map((signalId, index) => {
          const evidence = sourceEvidenceById.get(signalId);
          return {
            groupTopOfMindNoteId: created.id,
            signalId,
            ownerUserId: input.ownersBySignalId.get(signalId)!,
            role: evidence?.role ?? "related",
            reason: evidence?.reason ?? "",
            sortOrder: index,
          };
        }),
      )
      .onConflictDoNothing({
        target: [
          groupTopOfMindNoteSignals.groupTopOfMindNoteId,
          groupTopOfMindNoteSignals.signalId,
        ],
      });

    return "created";
  });
}

/**
 * Run group synthesis for one group: pool members' shared signals, judge each
 * viable trigger over the cross-member candidate pool, and persist the resulting
 * notes with owner-tagged evidence. Idempotent — re-running does not duplicate.
 */
export async function generateGroupTopOfMind(
  db: WakaDb,
  input: { groupId: string; locale?: SupportedLocale },
): Promise<GroupSynthesisResult> {
  const memberUserIds = await loadMemberUserIds(db, input.groupId);
  const triggers = await loadTriggerSignals(db, memberUserIds);
  const locale = (input.locale ?? "en-US") as SupportedLocale;

  let notesCreated = 0;
  let notesExisting = 0;
  let triggersTried = 0;

  for (const trigger of triggers) {
    if (notesCreated >= TARGET_NOTES) break;
    triggersTried += 1;

    let judgment: WowMomentJudgment;
    try {
      judgment = await judgeGroupWithRetry({
        db,
        memberUserIds,
        triggerUserId: trigger.userId,
        triggerInspirationId: trigger.id,
        limit: CANDIDATE_LIMIT,
        locale,
      });
    } catch (err) {
      console.warn("[group-synthesis] judge failed for trigger:", {
        groupId: input.groupId,
        triggerId: trigger.id,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    if (!judgment.isWowMoment) continue;

    const owners = await loadOwnersBySignalId(db, judgment.relatedInspirationIds);
    // A group Top of Mind must be a shared one: its evidence has to span at
    // least two members. Skip judgments grounded in a single person's
    // inspirations (they belong on that person's own board, not the group's).
    const distinctOwners = new Set(
      judgment.relatedInspirationIds
        .map((id) => owners.get(id))
        .filter((uid): uid is string => Boolean(uid)),
    );
    if (distinctOwners.size < 2) continue;

    // Spanning two members is necessary but not sufficient. A note can cite two
    // people and still say only what one of them already says alone, which
    // satisfies the letter of a shared reading and not its point: the group saw
    // nothing their own collection did not already contain. Checked here rather
    // than asked for in the prompt, because a model told to find a
    // combination-only insight will happily claim one.
    if (await restatesASingleMember(db, judgment, owners)) continue;

    const outcome = await persistGroupNote(db, {
      groupId: input.groupId,
      judgment,
      locale,
      triggerWowScore: trigger.wowScore,
      ownersBySignalId: owners,
    });
    if (outcome === "created") notesCreated += 1;
    else if (outcome === "existing") notesExisting += 1;
  }

  return { triggersTried, notesCreated, notesExisting };
}
