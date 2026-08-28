/**
 * Contested pairs — held, and resolved only by the owner's hand.
 *
 * goal: no-quiet-corners, Phase 5 (register item 4). When the three-way
 * judge answers `opposed`, the pair is recorded here — undirected,
 * normalized so it exists once — and both sides serve as CONTESTED until
 * an owner act settles it. The vocabulary (docs/data-model.md): a
 * **tension** is held on purpose; **contested** is an unresolved conflict
 * awaiting arbitration; the loser of a resolution is **yielded** — a
 * state, never a deletion.
 *
 * Owner-only resolution is doctrine (founder ruling 2026-08-23, signed in
 * the decision log): nothing in this file — and nothing anywhere — resolves
 * a pair from evidence weight. The acts that resolve, and who yields:
 *
 *   - lock (the owner edits/holds one side's words) → the OTHER side yields
 *   - verdict `true` on a side, by its owner            → the other yields
 *   - verdict `not_true` on a side, by its owner        → THAT side yields
 *   - dismissal of a side                               → that side yields
 *
 * A `partly` verdict resolves nothing — it is an invitation to sharpen,
 * not an arbitration.
 */

import { and, eq, isNull, or } from "drizzle-orm";

import { signalContradictions, type ContradictionResolution } from "../db/index.js";
import type { getDb } from "./db.js";

type WakaDb = ReturnType<typeof getDb>;
type WakaTx = Parameters<Parameters<WakaDb["transaction"]>[0]>[0];
type DbOrTx = WakaDb | WakaTx;

/** Store the pair once, whichever order the judge met it in. */
function normalizePair(x: string, y: string): { a: string; b: string } {
  return x < y ? { a: x, b: y } : { a: y, b: x };
}

/**
 * Record that two signals cannot both hold. Idempotent: the same pair
 * re-judged opposed is one row — including a pair that was RESOLVED once;
 * a resolved row stands as the record of that arbitration and is not
 * reopened by the machine (only the owner's own acts move standing, and
 * re-litigation by re-derivation would be the machine arbitrating).
 */
export async function recordContradiction(
  db: DbOrTx,
  input: { profileId: string; signalId: string; opposesSignalId: string; now?: Date },
): Promise<void> {
  const { a, b } = normalizePair(input.signalId, input.opposesSignalId);
  await db
    .insert(signalContradictions)
    .values({
      profileId: input.profileId,
      aSignalId: a,
      bSignalId: b,
      createdAt: input.now ?? new Date(),
    })
    .onConflictDoNothing();
}

export type ContestedAct = "lock" | "affirm" | "deny" | "dismiss";

const RESOLUTION_OF: Record<ContestedAct, ContradictionResolution> = {
  lock: "lock",
  affirm: "verdict",
  deny: "verdict",
  dismiss: "dismissal",
};

/**
 * Apply one owner act to every unresolved pair the signal stands in.
 * Under `lock` and `affirm` the acted side wins; under `deny` and
 * `dismiss` it yields. Returns how many pairs the act settled.
 */
export async function resolveContestedPairs(
  db: DbOrTx,
  input: { profileId: string; signalId: string; act: ContestedAct; now?: Date },
): Promise<number> {
  const open = await db
    .select({
      id: signalContradictions.id,
      aSignalId: signalContradictions.aSignalId,
      bSignalId: signalContradictions.bSignalId,
    })
    .from(signalContradictions)
    .where(
      and(
        eq(signalContradictions.profileId, input.profileId),
        isNull(signalContradictions.resolvedAt),
        or(
          eq(signalContradictions.aSignalId, input.signalId),
          eq(signalContradictions.bSignalId, input.signalId),
        ),
      ),
    );
  if (open.length === 0) return 0;

  const now = input.now ?? new Date();
  for (const pair of open) {
    const other = pair.aSignalId === input.signalId ? pair.bSignalId : pair.aSignalId;
    const yielded =
      input.act === "deny" || input.act === "dismiss" ? input.signalId : other;
    await db
      .update(signalContradictions)
      .set({ resolvedAt: now, yieldedSignalId: yielded, resolvedBy: RESOLUTION_OF[input.act] })
      .where(eq(signalContradictions.id, pair.id));
  }
  return open.length;
}
