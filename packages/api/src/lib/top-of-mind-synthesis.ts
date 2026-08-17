/**
 * Layer 3 — synthesizing one profile's top of mind.
 *
 * The artifact is the unit. A refresh selects the profile's strongest signals
 * deterministically, asks the provider for the WHOLE artifact once, validates
 * what comes back against facts the database owns, and then writes a new
 * version. Nothing is mutated in place: the previous live row is marked
 * superseded and points forward at its replacement, so the history is a chain
 * a reader can walk.
 *
 * This file is the pass — the order the stages run in, and the two entry
 * points the queue calls. Each stage is its own module, named for the
 * question it answers:
 *
 *   1. `top-of-mind-selection.ts`  — which signals may be considered at all
 *   2. `top-of-mind-artifact.ts`   — what the version standing now holds
 *   3. `top-of-mind-validation.ts` — what of the reply the database can vouch for
 *   4. `top-of-mind-versioning.ts` — what the next version holds, and writing it
 *
 * Two invariants are enforced in code rather than trusted to the prompt, and
 * each now sits in a named module a test can call without a provider:
 *
 *   - **Every cited signal exists and belongs to this profile.** A citation
 *     the model invented is dropped, and an entry left with no citation is
 *     dropped with it. An artifact that cites nothing is a horoscope. The
 *     profile filter is in stage 1 and the check against it is in stage 3;
 *     neither is any use without the other, which is why stage 3's set is
 *     built from the selection and never re-queried.
 *
 *   - **Human decisions survive regeneration.** Entries the owner locked,
 *     pinned, or dismissed are copied forward verbatim from the previous
 *     version — read out of the database, never out of the model's reply.
 *     The instruction asks the model to reproduce locked entries exactly, and
 *     we check that it did, but the bytes that get written are the stored
 *     ones. That is the difference between a rule and a request.
 *
 * Every refresh records a decision. When nothing moved, the pass writes a
 * version with `reason: "no_change"` rather than returning quietly — a silent
 * empty pass and a broken generator look identical from the outside, and the
 * previous system hid its failures in exactly that gap.
 */

import { desc, eq, inArray } from "drizzle-orm";

import {
  feedback,
  profiles,
  signals,
  topOfMindEntries,
  type TopOfMindRevisionReason,
} from "../db/index.js";
import { getDb } from "./db.js";
import { normalizeSupportedLocale } from "./locales.js";
import {
  getDefaultModelProvider,
  type ModelProvider,
  type TopOfMindSynthesisEntry,
  type TopOfMindRecentFeedback,
} from "./model-provider.js";
import { loadLiveArtifact } from "./top-of-mind-artifact.js";
import { acquireTopOfMindArtifactLock } from "./top-of-mind-family-lock.js";
import { selectSignals } from "./top-of-mind-selection.js";
import {
  countLockViolations,
  validateSynthesizedEntries,
} from "./top-of-mind-validation.js";
import {
  assembleEntries,
  carryEverything,
  isUnchanged,
  writeVersion,
} from "./top-of-mind-versioning.js";

type WakaDb = ReturnType<typeof getDb>;

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export interface RefreshTopOfMindInput {
  profileId: string;
  reason: "signals_changed" | "manual";
}

export interface TopOfMindRefreshDependencies {
  db?: WakaDb;
  modelProvider?: ModelProvider;
  now?: Date;
}

export interface TopOfMindRefreshResult {
  status: "versioned" | "nothing_to_synthesize";
  topOfMindId: string | null;
  version: number;
  reason: TopOfMindRevisionReason | null;
  entryCount: number;
  /** Signals whose ids the model cited but the profile does not hold. */
  droppedCitations: number;
  /** Locked entries the model failed to reproduce byte-identically. */
  lockViolations: number;
}

// ---------------------------------------------------------------------------
// The pass
// ---------------------------------------------------------------------------

/** Newest verdicts, with the text each one was about, bounded for the prompt. */
const RECENT_FEEDBACK_LIMIT = 20;

async function loadRecentFeedback(
  db: WakaDb,
  profileId: string,
): Promise<TopOfMindRecentFeedback[]> {
  const rows = await db
    .select({
      targetType: feedback.targetType,
      targetId: feedback.targetId,
      value: feedback.value,
      correctionText: feedback.correctionText,
    })
    .from(feedback)
    .where(eq(feedback.profileId, profileId))
    .orderBy(desc(feedback.createdAt))
    .limit(RECENT_FEEDBACK_LIMIT);
  if (rows.length === 0) return [];

  const signalIds = rows
    .filter((row) => row.targetType === "signal")
    .map((row) => row.targetId);
  const entryIds = rows
    .filter((row) => row.targetType === "top_of_mind_entry")
    .map((row) => row.targetId);

  const statements = signalIds.length
    ? await db
        .select({ id: signals.id, statement: signals.statement })
        .from(signals)
        .where(inArray(signals.id, signalIds))
    : [];
  const bodies = entryIds.length
    ? await db
        .select({ id: topOfMindEntries.id, body: topOfMindEntries.body })
        .from(topOfMindEntries)
        .where(inArray(topOfMindEntries.id, entryIds))
    : [];

  const aboutById = new Map<string, string>();
  for (const row of statements) aboutById.set(row.id, row.statement);
  for (const row of bodies) aboutById.set(row.id, row.body);

  return rows.flatMap((row) => {
    const about = aboutById.get(row.targetId);
    // A verdict on something since deleted still shaped the person's history,
    // but without its text the model would be reasoning about a blank.
    if (!about) return [];
    return [
      {
        target: row.targetType === "signal" ? ("signal" as const) : ("entry" as const),
        about,
        value: row.value,
        correction: row.correctionText,
      },
    ];
  });
}

export async function refreshTopOfMindForProfile(
  input: RefreshTopOfMindInput,
  deps: TopOfMindRefreshDependencies = {},
): Promise<TopOfMindRefreshResult> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const provider = deps.modelProvider ?? (await getDefaultModelProvider());

  const [profileRows, selection, liveBefore] = await Promise.all([
    db
      .select({ preferredLocale: profiles.preferredLocale })
      .from(profiles)
      .where(eq(profiles.id, input.profileId))
      .limit(1),
    selectSignals(db, input.profileId, now),
    loadLiveArtifact(db, input.profileId),
  ]);
  const selected = selection.signals;
  const provisional = selection.provisional;

  if (selected.length === 0 && liveBefore === null) {
    // There is no artifact and nothing to make one from. Recording versions
    // of nothing would fill the chain with entries that say only that the
    // profile is new.
    return {
      status: "nothing_to_synthesize",
      topOfMindId: null,
      version: 0,
      reason: null,
      entryCount: 0,
      droppedCitations: 0,
      lockViolations: 0,
    };
  }

  const lockedBefore = (liveBefore?.entries ?? []).filter(
    (entry) => entry.lockedAt !== null && entry.dismissedAt === null,
  );

  let generated: TopOfMindSynthesisEntry[] = [];
  let modelSaidNoChange = false;
  let droppedCitations = 0;
  let lockViolations = 0;

  if (selected.length > 0) {
    const recentFeedback = await loadRecentFeedback(db, input.profileId);
    const synthesis = await provider.synthesizeTopOfMind({
      recentFeedback,
      provisional,
      profileId: input.profileId,
      preferredLocale: normalizeSupportedLocale(profileRows[0]?.preferredLocale),
      signals: selected.map((signal) => ({
        id: signal.id,
        statement: signal.statement,
        confidence: signal.confidence,
        evidenceCount: signal.evidenceCount,
        lastEvidenceAt: signal.lastEvidenceAt,
      })),
      lockedEntries: lockedBefore.map((entry, index) => ({
        id: `${liveBefore?.id ?? "pending"}:${index}`,
        type: entry.type,
        body: entry.body,
        belief: entry.belief,
        prompt: entry.prompt,
        citedSignalIds: entry.citedSignalIds,
      })),
      currentEntries: (liveBefore?.entries ?? [])
        .filter((entry) => entry.dismissedAt === null)
        .map((entry) => ({
          type: entry.type,
          body: entry.body,
          citedSignalIds: entry.citedSignalIds,
        })),
    });

    modelSaidNoChange = synthesis.noChange === true;
    lockViolations = countLockViolations(lockedBefore, synthesis.entries);
    if (lockViolations > 0) {
      console.warn("[top-of-mind] model did not reproduce locked entries verbatim", {
        profileId: input.profileId,
        lockViolations,
      });
    }

    const validated = validateSynthesizedEntries(
      synthesis.entries,
      new Set(selected.map((signal) => signal.id)),
    );
    generated = validated.entries;
    droppedCitations = validated.droppedCitations;
    if (droppedCitations > 0) {
      console.warn("[top-of-mind] dropped citations the profile does not hold", {
        profileId: input.profileId,
        droppedCitations,
      });
    }
  }

  const written = await db.transaction(async (tx) => {
    await acquireTopOfMindArtifactLock(tx, { profileId: input.profileId });

    // Re-read under the lock. Another pass may have landed a version while
    // this one was waiting on the provider, and the human decisions on that
    // newer version are the ones that must be carried forward.
    const previous = await loadLiveArtifact(tx, input.profileId);

    // No eligible signals and an artifact already standing: nothing was
    // synthesized, so nothing is known to have moved. Carrying the previous
    // version forward whole is the honest record of that. Dropping its
    // generated entries here would empty someone's top of mind on a
    // technicality, without a single model call having been made.
    const nothingReconsidered = selected.length === 0 && previous !== null;

    /**
     * AN EMPTY REPLY IS NOT A VERDICT THAT YOU ARE EMPTY.
     *
     * `assembleEntries` keeps a carried entry only when it is locked, pinned
     * or dismissed — everything else is expected to be re-supplied by
     * `generated`. That is right when the model answered, and catastrophic
     * when it did not: an empty `generated` wrote a NEW VERSION with every
     * machine-authored entry gone, superseding the old one, with nothing in
     * the product able to bring it back.
     *
     * Three reachable inputs produce an empty `generated` without any error
     * being raised: the model returns one entry whose `type` is outside the
     * enum and the whole zod object fails, so the reply collapses to
     * `{entries: []}`; the model cites only invented signal ids and
     * `validateSynthesizedEntries` drops them all; or the model takes "return
     * the current entries unchanged" literally and replies with `noChange`
     * and no entries. In every case the person opens the app after an
     * ordinary capture and finds their top of mind blank.
     *
     * `carryEverything` is the honest record of "the machine had nothing to
     * say this time", and it already exists for exactly that reading one
     * branch up. There is no case where deleting a person's standing artifact
     * because a model call came back empty is the correct outcome.
     */
    const modelSaidNothingUsable = selected.length > 0 && generated.length === 0;
    if (modelSaidNothingUsable && previous !== null) {
      console.warn("[top-of-mind] synthesis returned no usable entries; carrying the artifact", {
        profileId: input.profileId,
        selected: selected.length,
        previousEntries: previous.entries.length,
      });
    }

    /**
     * AND `no_change` MUST MEAN NO CHANGE. `modelSaidNoChange` short-circuited
     * the comparison below while `entries` was still whatever `assembleEntries`
     * had produced — so a reply of `{noChange: true, entries: []}` wrote a
     * TRUNCATED artifact and labelled the truncation `no_change`. The label and
     * the content now come from the same decision.
     */
    const carryPrevious =
      previous !== null && (nothingReconsidered || modelSaidNoChange || modelSaidNothingUsable);

    const entries = carryPrevious
      ? carryEverything(previous)
      : assembleEntries({ carried: previous?.entries ?? [], generated });

    const unchanged =
      previous !== null && (carryPrevious || isUnchanged(previous.entries, entries));
    const reason: TopOfMindRevisionReason = previous === null
      ? "initial"
      : unchanged
        ? "no_change"
        : "regenerated";

    const created = await writeVersion(tx, {
      profileId: input.profileId,
      previous,
      entries,
      reason,
      now,
    });

    return { created, reason, entryCount: entries.length };
  });

  return {
    status: "versioned",
    topOfMindId: written.created.id,
    version: written.created.version,
    reason: written.reason,
    entryCount: written.entryCount,
    droppedCitations,
    lockViolations,
  };
}

/**
 * The group artifact is generated from members' shared signals rather than a
 * profile's own, and its co-editing mechanism (proposals, affirmations) is a
 * different versioning story. The seam exists so the queue can route the job
 * type today and the behaviour can land without touching the router.
 *
 * IT IS A STUB. It logs and returns; no group artifact has ever been written
 * by it. Anything a member sees on a room's board today came from somewhere
 * else, and `GET /api/groups/:groupId/top-of-mind` reads a table this
 * function does not fill.
 *
 * WHOEVER FILLS IT IN OWNS ONE RULE THAT IS NOT ENFORCED HERE. A member may
 * see THAT a shared signal fed an entry, and never WHICH one — evidence never
 * crosses an account boundary, whatever the capture's visibility says
 * (`docs/data-model.md`, "Sharing and privacy"). Today that rule is kept by
 * the read path, not the write path: the group serializer in
 * `routes/groups.ts` selects `topOfMindEntrySignals.ownerProfileId` and joins
 * `profiles` for a name, and never selects `signalId` at all. It is a rule
 * about a SELECT list, which means the shape that breaks it is not a missing
 * `if` — it is someone spreading the citation row instead of naming its
 * fields, and shipping every member's signal ids to the room.
 *
 * The write side has one obligation that follows from that: group citations
 * must carry `ownerProfileId`, or the read path has nothing to attribute with
 * and will show a room an entry that came from nobody. The personal pass
 * leaves it null on purpose — on a personal artifact the answer is never in
 * question — so it is not something the profile path can be copied for.
 */
export async function refreshTopOfMindForGroup(input: {
  groupId: string;
  reason: string;
}): Promise<{ status: "not_implemented"; groupId: string }> {
  console.log("[top-of-mind] group synthesis is not wired yet", {
    groupId: input.groupId,
    reason: input.reason,
  });
  return { status: "not_implemented", groupId: input.groupId };
}
