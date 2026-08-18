/**
 * Layer 3, stage 4 — assembling the next version and writing it.
 *
 * Nothing is mutated in place. The previous live row is marked superseded and
 * points forward at its replacement, so the history is a chain a reader can
 * walk, and a person's own words are never overwritten by a regeneration —
 * `assembleEntries` copies locked, pinned and dismissed entries out of the
 * previous version rather than out of the model's reply. That is the
 * difference between a rule and a request.
 *
 * `isUnchanged` is here rather than with the pass because "did anything
 * move?" is a question about the two lists of entries, not about the refresh
 * that produced them, and answering it wrongly is how a genuine no-change
 * pass gets labelled `regenerated` — which the version chain then repeats
 * forever.
 */

import { eq } from "drizzle-orm";

import {
  topOfMindEntries,
  topOfMindEntrySignals,
  topOfMinds,
  type TopOfMindEntryType,
  type TopOfMindRevisionReason,
} from "../db/index.js";
import type { getDb } from "./db.js";
import type { TopOfMindSynthesisEntry } from "./model-provider.js";
import {
  isHumanTouched,
  type CarriedEntry,
  type LiveArtifactSnapshot,
} from "./top-of-mind-artifact.js";

type WakaDb = ReturnType<typeof getDb>;
type WakaTx = Parameters<Parameters<WakaDb["transaction"]>[0]>[0];

export interface PersistedEntry {
  type: TopOfMindEntryType;
  body: string;
  belief: string | null;
  prompt: string | null;
  lockedAt: Date | null;
  pinnedAt: Date | null;
  dismissedAt: Date | null;
  citedSignalIds: string[];
}

/**
 * The order a reader meets the artifact in:
 *   pinned, then locked, then what the model wrote, then dismissed.
 *
 * Pinned first because pinning is the owner saying "keep this where I can see
 * it". Dismissed last because they are carried only so a dismissal survives
 * the next regeneration; every read path filters them out by default.
 */
export function assembleEntries(input: {
  carried: CarriedEntry[];
  generated: TopOfMindSynthesisEntry[];
}): PersistedEntry[] {
  const humanTouched = input.carried.filter(isHumanTouched);
  const carriedBodies = new Set(humanTouched.map((entry) => entry.body));

  const bySortOrder = (a: CarriedEntry, b: CarriedEntry) => a.sortOrder - b.sortOrder;
  const toPersisted = (entry: CarriedEntry): PersistedEntry => ({
    type: entry.type,
    body: entry.body,
    belief: entry.belief,
    prompt: entry.prompt,
    lockedAt: entry.lockedAt,
    pinnedAt: entry.pinnedAt,
    dismissedAt: entry.dismissedAt,
    citedSignalIds: entry.citedSignalIds,
  });

  const pinned = humanTouched
    .filter((entry) => entry.pinnedAt !== null && entry.dismissedAt === null)
    .sort(bySortOrder)
    .map(toPersisted);
  const locked = humanTouched
    .filter(
      (entry) =>
        entry.lockedAt !== null && entry.pinnedAt === null && entry.dismissedAt === null,
    )
    .sort(bySortOrder)
    .map(toPersisted);
  const dismissed = humanTouched
    .filter((entry) => entry.dismissedAt !== null)
    .sort(bySortOrder)
    .map(toPersisted);

  const generated = input.generated
    // The model was asked to reproduce locked entries; those copies are
    // redundant with the verbatim ones, and a dismissed body coming back is
    // the regeneration re-proposing something the owner already refused.
    .filter((entry) => !carriedBodies.has(entry.body))
    .map<PersistedEntry>((entry) => ({
      type: entry.type,
      body: entry.body,
      belief: entry.belief ?? null,
      prompt: entry.prompt ?? null,
      lockedAt: null,
      pinnedAt: null,
      dismissedAt: null,
      citedSignalIds: entry.citedSignalIds,
    }));

  return [...pinned, ...locked, ...generated, ...dismissed];
}

/**
 * Same entries, same order, same citations — nothing for a reader to notice.
 *
 * Dismissed entries are excluded from the comparison because they are
 * excluded from every read: they ride along so a dismissal survives the next
 * regeneration, and where they sit in the list is not something anyone sees.
 */
export function isUnchanged(previous: CarriedEntry[], next: PersistedEntry[]): boolean {
  const before = [...previous]
    .filter((entry) => entry.dismissedAt === null)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const after = next.filter((entry) => entry.dismissedAt === null);
  if (before.length !== after.length) return false;

  // Citations compared as sets, not sequences: the carried order comes from a
  // query with no ORDER BY and the generated order from the model, so the same
  // citations arriving shuffled would otherwise read as a change and mislabel
  // a genuine no-change pass as `regenerated`.
  const sortedIds = (ids: string[]): string => [...ids].sort().join(",");

  return before.every((entry, index) => {
    const candidate = after[index]!;
    return (
      entry.type === candidate.type &&
      entry.body === candidate.body &&
      (entry.belief ?? null) === candidate.belief &&
      (entry.prompt ?? null) === candidate.prompt &&
      sortedIds(entry.citedSignalIds) === sortedIds(candidate.citedSignalIds)
    );
  });
}

/** Everything the previous version held, in the order it held it. */
export function carryEverything(previous: LiveArtifactSnapshot): PersistedEntry[] {
  return [...previous.entries]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((entry) => ({
      type: entry.type,
      body: entry.body,
      belief: entry.belief,
      prompt: entry.prompt,
      lockedAt: entry.lockedAt,
      pinnedAt: entry.pinnedAt,
      dismissedAt: entry.dismissedAt,
      citedSignalIds: entry.citedSignalIds,
    }));
}

export async function writeVersion(
  tx: WakaTx,
  input: {
    profileId: string;
    previous: LiveArtifactSnapshot | null;
    entries: PersistedEntry[];
    reason: TopOfMindRevisionReason;
    now: Date;
  },
): Promise<{ id: string; version: number }> {
  // Supersede before inserting: the partial unique index permits exactly one
  // live row per profile, so the old one has to step down first.
  if (input.previous) {
    await tx
      .update(topOfMinds)
      .set({ status: "superseded", replacedAt: input.now })
      .where(eq(topOfMinds.id, input.previous.id));
  }

  const [created] = await tx
    .insert(topOfMinds)
    .values({
      profileId: input.profileId,
      version: (input.previous?.version ?? 0) + 1,
      status: "live",
      reason: input.reason,
    })
    .returning({ id: topOfMinds.id, version: topOfMinds.version });
  if (!created) throw new Error("Failed to insert top of mind version");

  if (input.previous) {
    await tx
      .update(topOfMinds)
      .set({ replacedById: created.id })
      .where(eq(topOfMinds.id, input.previous.id));
  }

  for (const [index, entry] of input.entries.entries()) {
    const [insertedEntry] = await tx
      .insert(topOfMindEntries)
      .values({
        topOfMindId: created.id,
        type: entry.type,
        body: entry.body,
        belief: entry.belief,
        prompt: entry.prompt,
        lockedAt: entry.lockedAt,
        pinnedAt: entry.pinnedAt,
        dismissedAt: entry.dismissedAt,
        sortOrder: index,
      })
      .returning({ id: topOfMindEntries.id });
    if (!insertedEntry) throw new Error("Failed to insert top of mind entry");

    if (entry.citedSignalIds.length > 0) {
      await tx
        .insert(topOfMindEntrySignals)
        .values(
          entry.citedSignalIds.map((signalId) => ({
            entryId: insertedEntry.id,
            signalId,
          })),
        )
        .onConflictDoNothing();
    }
  }

  return created;
}
