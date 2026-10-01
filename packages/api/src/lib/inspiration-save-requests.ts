import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { inspirationSaveRequests, profiles } from '../db/index.js';
import { getDb } from './db.js';
import type { InspirationProcessingReceipt } from './inspiration-processing.js';

type Database = ReturnType<typeof getDb>;
export type InspirationSaveTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type InspirationSaveOperation = 'inspiration' | 'reflection';
export interface SavedInspirationReference {
  inspirationId: string;
  reflectionId: string | null;
  processing: InspirationProcessingReceipt;
}

export class InspirationSaveError extends Error {
  constructor(readonly status: 400 | 404 | 409 | 410, readonly code: string, message: string) { super(message); }
}
export function parseInspirationSaveRequestId(header: string | undefined): string | undefined {
  if (header === undefined) return undefined;
  const id = z.string().uuid().safeParse(header);
  if (!id.success) throw new InspirationSaveError(400, 'invalid_save_request', 'Idempotency-Key must be a UUID');
  return id.data.toLowerCase();
}
function ordered(input: unknown): unknown {
  if (Array.isArray(input)) return input.map(ordered);
  if (input && typeof input === 'object') return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, value]) => [key, ordered(value)]));
  return input;
}

/** Source rows, processing jobs and the save identity commit together. Replays
 * load current permitted material; no authored response is stored in the ledger.
 * A keyless caller retains the existing create contract, without false dedup. */
export async function runInspirationSave<T>(db: Database, input: {
  profileId: string; requestId?: string; operation: InspirationSaveOperation; material: unknown;
}, create: (tx: InspirationSaveTransaction) => Promise<SavedInspirationReference & { response: T }>,
load: (tx: InspirationSaveTransaction, saved: SavedInspirationReference) => Promise<T>) {
  return db.transaction(async (tx) => {
    if (!input.requestId) {
      const made = await create(tx);
      return { response: made.response, replayed: false, saveRequest: undefined };
    }
    const [owner] = await tx.select({ id: profiles.id }).from(profiles).where(eq(profiles.id, input.profileId))
      .for('key share', { noWait: true });
    if (!owner) throw new InspirationSaveError(404, 'profile_not_found', 'Profile not found');
    const [lock] = await tx.execute(sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${`inspiration-save:${input.profileId}:${input.requestId}`}, 0)) AS acquired`);
    if (!lock?.acquired) throw new InspirationSaveError(409, 'save_in_progress', 'This save is still in progress. Check it again shortly.');
    const requestHash = createHash('sha256').update(JSON.stringify(ordered(input.material))).digest('hex');
    const [prior] = await tx.select().from(inspirationSaveRequests).where(and(eq(inspirationSaveRequests.profileId, input.profileId),
      eq(inspirationSaveRequests.requestId, input.requestId))).limit(1);
    if (prior) {
      if (prior.operation !== input.operation || prior.requestHash !== requestHash) {
        throw new InspirationSaveError(409, 'save_request_conflict', 'This save request was already used for different content.');
      }
      if (!prior.inspirationId || !prior.processing) throw new InspirationSaveError(410, 'saved_item_removed', 'That saved item was removed.');
      if (prior.processing.profileId !== input.profileId || prior.processing.inspirationId !== prior.inspirationId) {
        throw new Error('Invalid stored save binding');
      }
      const response = await load(tx, { inspirationId: prior.inspirationId, reflectionId: prior.reflectionId, processing: prior.processing });
      return { response, replayed: true, saveRequest: { requestId: input.requestId, replayed: true } };
    }
    const made = await create(tx);
    if (made.processing.profileId !== input.profileId || made.processing.inspirationId !== made.inspirationId) throw new Error('Invalid save binding');
    await tx.insert(inspirationSaveRequests).values({ profileId: input.profileId, requestId: input.requestId,
      operation: input.operation, requestHash, inspirationId: made.inspirationId, reflectionId: made.reflectionId, processing: made.processing });
    return { response: made.response, replayed: false, saveRequest: { requestId: input.requestId, replayed: false } };
  });
}

/** Row-lock contention is also an ambiguous/in-flight result, never success. */
export function inspirationSaveFailure(error: unknown): InspirationSaveError | null {
  if (error instanceof InspirationSaveError) return error;
  const code = (error as { cause?: { code?: string } })?.cause?.code ?? (error as { code?: string })?.code;
  return code === '55P03' ? new InspirationSaveError(409, 'save_in_progress', 'This save is still in progress. Check it again shortly.') : null;
}
