/**
 * The statement-chain writer, and the revert verb it makes possible.
 *
 * goal: no-quiet-corners, Phase 2. One writer for both layers: supersede
 * the current row (timestamp first, forward pointer the moment the
 * successor's id exists), append the new current, delete nothing — the
 * chain is history, and history only ever grows.
 *
 * SEEDING ON FIRST TOUCH. Rows minted before the chain existed have no
 * recorded original. The writer seeds one at the first write that would
 * otherwise orphan the pre-edit sentence: if the parent's current text is
 * unlocked (nobody's hand but the machine's has touched it) and the chain
 * is empty, that text is chained as the machine's before the new row
 * lands. So the machine's original becomes recoverable for every signal
 * and principle from its first post-migration edit on — not only for rows
 * born after the migration.
 *
 * REVERT. Release (shipped, Track S) keeps the person's words and returns
 * jurisdiction; revert restores the machine's sentence byte-for-byte from
 * the chain — the newest machine-side row — clears the lock, and records
 * itself as a `reverted` chain row. A statement with no machine row in its
 * chain (a declared principle; a pre-migration row never edited through
 * the writer) has nothing to revert to, and the verb says so rather than
 * inventing one.
 */

import { and, desc, eq, inArray, isNull } from "drizzle-orm";

import {
  MACHINE_STATEMENT_REASONS,
  principleStatements,
  principles,
  signalStatements,
  signals,
  type StatementReason,
} from "../db/index.js";
import type { getDb } from "./db.js";

type WakaDb = ReturnType<typeof getDb>;
type WakaTx = Parameters<Parameters<WakaDb["transaction"]>[0]>[0];
type DbOrTx = WakaDb | WakaTx;

// ---------------------------------------------------------------------------
// The writer — one shape, two layers
// ---------------------------------------------------------------------------

interface ChainWriteInput {
  profileId: string;
  statement: string;
  reason: StatementReason;
  now?: Date;
}

/**
 * Append `statement` as the signal's current chain row, superseding the
 * previous current. `seedStatement` is the parent's pre-write text, chained
 * as the machine's when the chain is empty and the parent was unlocked —
 * pass null when seeding must not happen (the parent was already the
 * owner's words).
 */
export async function writeSignalStatementChain(
  db: DbOrTx,
  input: ChainWriteInput & { signalId: string; seedStatement?: string | null },
): Promise<void> {
  const now = input.now ?? new Date();

  const [current] = await db
    .select({ id: signalStatements.id })
    .from(signalStatements)
    .where(and(eq(signalStatements.signalId, input.signalId), isNull(signalStatements.supersededAt)))
    .limit(1);

  let previousId = current?.id ?? null;

  if (!current && input.seedStatement != null) {
    const [seeded] = await db
      .insert(signalStatements)
      .values({
        profileId: input.profileId,
        signalId: input.signalId,
        statement: input.seedStatement,
        reason: "derived",
        createdAt: now,
      })
      .returning({ id: signalStatements.id });
    previousId = seeded?.id ?? null;
  }

  if (previousId) {
    // Timestamp first so the partial unique index sees one current row
    // before the successor is inserted.
    await db
      .update(signalStatements)
      .set({ supersededAt: now })
      .where(eq(signalStatements.id, previousId));
  }

  const [next] = await db
    .insert(signalStatements)
    .values({
      profileId: input.profileId,
      signalId: input.signalId,
      statement: input.statement,
      reason: input.reason,
      createdAt: now,
    })
    .returning({ id: signalStatements.id });

  if (previousId && next) {
    await db
      .update(signalStatements)
      .set({ supersededById: next.id })
      .where(eq(signalStatements.id, previousId));
  }
}

/** The same writer, at layer 4. Seeds with reason `minted`. */
export async function writePrincipleStatementChain(
  db: DbOrTx,
  input: ChainWriteInput & { principleId: string; seedStatement?: string | null },
): Promise<void> {
  const now = input.now ?? new Date();

  const [current] = await db
    .select({ id: principleStatements.id })
    .from(principleStatements)
    .where(
      and(
        eq(principleStatements.principleId, input.principleId),
        isNull(principleStatements.supersededAt),
      ),
    )
    .limit(1);

  let previousId = current?.id ?? null;

  if (!current && input.seedStatement != null) {
    const [seeded] = await db
      .insert(principleStatements)
      .values({
        profileId: input.profileId,
        principleId: input.principleId,
        statement: input.seedStatement,
        reason: "minted",
        createdAt: now,
      })
      .returning({ id: principleStatements.id });
    previousId = seeded?.id ?? null;
  }

  if (previousId) {
    await db
      .update(principleStatements)
      .set({ supersededAt: now })
      .where(eq(principleStatements.id, previousId));
  }

  const [next] = await db
    .insert(principleStatements)
    .values({
      profileId: input.profileId,
      principleId: input.principleId,
      statement: input.statement,
      reason: input.reason,
      createdAt: now,
    })
    .returning({ id: principleStatements.id });

  if (previousId && next) {
    await db
      .update(principleStatements)
      .set({ supersededById: next.id })
      .where(eq(principleStatements.id, previousId));
  }
}

// ---------------------------------------------------------------------------
// The revert verb
// ---------------------------------------------------------------------------

export type RevertOutcome =
  | { outcome: "reverted"; statement: string }
  | { outcome: "not_found" }
  | { outcome: "nothing_to_revert" };

/**
 * Restore the machine's newest statement byte-for-byte and clear the lock.
 * The restoration is itself a chain row (`reverted`, machine-side — a
 * second revert after a later edit returns to the same sentence).
 * Embedding maintenance is the caller's: the route drops the stale vector
 * and enqueues the re-embed, exactly as the edit path does.
 */
export async function revertSignalStatement(
  db: WakaDb,
  input: { profileId: string; signalId: string },
): Promise<RevertOutcome> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: signals.id, statement: signals.statement })
      .from(signals)
      .where(and(eq(signals.id, input.signalId), eq(signals.profileId, input.profileId)))
      .limit(1);
    if (!row) return { outcome: "not_found" };

    const [machine] = await tx
      .select({ statement: signalStatements.statement })
      .from(signalStatements)
      .where(
        and(
          eq(signalStatements.signalId, input.signalId),
          inArray(signalStatements.reason, [...MACHINE_STATEMENT_REASONS]),
        ),
      )
      .orderBy(desc(signalStatements.createdAt))
      .limit(1);
    if (!machine) return { outcome: "nothing_to_revert" };

    const now = new Date();
    await writeSignalStatementChain(tx, {
      profileId: input.profileId,
      signalId: input.signalId,
      statement: machine.statement,
      reason: "reverted",
      now,
    });
    await tx
      .update(signals)
      .set({ statement: machine.statement, lockedAt: null, updatedAt: now })
      .where(eq(signals.id, input.signalId));

    return { outcome: "reverted", statement: machine.statement };
  });
}

/** The same verb at layer 4. A declared principle has no machine original. */
export async function revertPrincipleStatement(
  db: WakaDb,
  input: { profileId: string; principleId: string },
): Promise<RevertOutcome> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: principles.id })
      .from(principles)
      .where(
        and(eq(principles.id, input.principleId), eq(principles.profileId, input.profileId)),
      )
      .limit(1);
    if (!row) return { outcome: "not_found" };

    const [machine] = await tx
      .select({ statement: principleStatements.statement })
      .from(principleStatements)
      .where(
        and(
          eq(principleStatements.principleId, input.principleId),
          inArray(principleStatements.reason, [...MACHINE_STATEMENT_REASONS]),
        ),
      )
      .orderBy(desc(principleStatements.createdAt))
      .limit(1);
    if (!machine) return { outcome: "nothing_to_revert" };

    const now = new Date();
    await writePrincipleStatementChain(tx, {
      profileId: input.profileId,
      principleId: input.principleId,
      statement: machine.statement,
      reason: "reverted",
      now,
    });
    await tx
      .update(principles)
      .set({ statement: machine.statement, lockedAt: null, updatedAt: now })
      .where(eq(principles.id, input.principleId));

    return { outcome: "reverted", statement: machine.statement };
  });
}
