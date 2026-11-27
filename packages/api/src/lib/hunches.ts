/**
 * ═══ A HUNCH FROM THE FIRST SAVES (insight goal, phase 3, 2026-11-26) ═══
 *
 * Before a reading can be published (two distinct saves and the reviewer),
 * a person with one save heard "Nothing to say yet". Now the creature
 * guesses out loud from what is there and asks "Am I close?": Yes affirms
 * the saves' patterns and asks for the reading; Not quite records what the
 * person said instead and asks for a new hunch that must honour it.
 *
 * Only while there is no live reading: once one exists, the reading is what
 * the creature says, and no more hunches are written.
 */
import { and, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { hunches, inspirations, profiles, signalEvidence, signals, topOfMinds } from '../db/index.js';
import type { getDb } from './db.js';
import { isSupportedLocale } from './locales.js';
import type { HunchInput, ModelProvider } from './model-provider.js';

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** How many recent saves a hunch reads. */
export const HUNCH_SAVES = 6;

export async function hasLiveReading(db: Pick<Db, 'select'>, profileId: string): Promise<boolean> {
  const [row] = await db.select({ id: topOfMinds.id }).from(topOfMinds)
    .where(and(eq(topOfMinds.profileId, profileId), eq(topOfMinds.status, 'live'))).limit(1);
  return Boolean(row);
}

/** What a hunch is written from: the newest saves with words, and what was declined. */
export async function loadHunchInput(db: Pick<Db, 'select'>, profileId: string): Promise<HunchInput | null> {
  const [profile] = await db.select({ preferredLocale: profiles.preferredLocale }).from(profiles).where(eq(profiles.id, profileId)).limit(1);
  if (!profile) return null;
  const saves = await db.select({ id: inspirations.id, text: inspirations.text, prompt: inspirations.prompt }).from(inspirations)
    .where(and(eq(inspirations.profileId, profileId), isNull(inspirations.memoryExcludedAt), ne(inspirations.text, '')))
    .orderBy(desc(inspirations.createdAt), desc(inspirations.id)).limit(HUNCH_SAVES);
  if (!saves.length) return null;
  const declined = await db.select({ body: hunches.body, correction: hunches.correction }).from(hunches)
    .where(and(eq(hunches.profileId, profileId), eq(hunches.status, 'declined')))
    .orderBy(desc(hunches.updatedAt)).limit(2);
  return {
    preferredLocale: isSupportedLocale(profile.preferredLocale) ? profile.preferredLocale : 'en-US',
    saves: saves.map(row => ({ id: row.id, text: row.text, prompt: row.prompt })),
    declined: declined.filter((row): row is { body: string; correction: string } => Boolean(row.correction)),
  };
}

/**
 * Writes one hunch, or nothing. `newestId` (a save's job) is dropped when a
 * newer save has arrived, since that save's own job reads everything again.
 * The commit re-checks that no reading went live meanwhile, then replaces any
 * pending hunch with the new one.
 */
export async function writeHunchForProfile(db: Db, provider: Pick<ModelProvider, 'writeHunch'>, input: {
  profileId: string; newestId?: string; beforeCommit?: (tx: Tx) => Promise<void>;
}): Promise<'written' | 'skipped'> {
  if (!provider.writeHunch || await hasLiveReading(db, input.profileId)) return 'skipped';
  const material = await loadHunchInput(db, input.profileId);
  if (!material) return 'skipped';
  if (input.newestId && material.saves[0]!.id !== input.newestId) return 'skipped';
  const result = await provider.writeHunch(material);
  return db.transaction(async (tx) => {
    await input.beforeCommit?.(tx);
    if (await hasLiveReading(tx, input.profileId)) return 'skipped';
    const cited = await tx.select({ id: inspirations.id }).from(inspirations)
      .where(and(eq(inspirations.profileId, input.profileId), inArray(inspirations.id, result.inspirationIds), isNull(inspirations.memoryExcludedAt)));
    if (cited.length !== result.inspirationIds.length) return 'skipped';
    await tx.update(hunches).set({ status: 'replaced', updatedAt: sql`now()` })
      .where(and(eq(hunches.profileId, input.profileId), eq(hunches.status, 'pending')));
    await tx.insert(hunches).values({ profileId: input.profileId, body: result.hunch, inspirationIds: result.inspirationIds });
    return 'written';
  });
}

export type HunchView = { id: string; body: string; inspirationIds: string[]; status: 'pending' | 'affirmed' | 'declined' };

/** The hunch the creature says now: the newest pending one, while no reading is live. */
export async function readCurrentHunch(db: Pick<Db, 'select'>, profileId: string): Promise<HunchView | null> {
  if (await hasLiveReading(db, profileId)) return null;
  const [row] = await db.select({ id: hunches.id, body: hunches.body, inspirationIds: hunches.inspirationIds, status: hunches.status })
    .from(hunches).where(and(eq(hunches.profileId, profileId), eq(hunches.status, 'pending')))
    .orderBy(desc(hunches.createdAt)).limit(1);
  return row ? { ...row, status: 'pending' } : null;
}

/** Signals resting on the cited saves, for Yes to affirm. */
export async function signalsBehind(db: Pick<Db, 'selectDistinct'>, profileId: string, inspirationIds: string[]): Promise<string[]> {
  if (!inspirationIds.length) return [];
  /* Never through a save excluded from memory (code review, 2026-11-26). */
  const rows = await db.selectDistinct({ id: signals.id }).from(signalEvidence)
    .innerJoin(signals, eq(signals.id, signalEvidence.signalId))
    .innerJoin(inspirations, eq(inspirations.id, signalEvidence.inspirationId))
    .where(and(eq(signalEvidence.profileId, profileId), inArray(signalEvidence.inspirationId, inspirationIds), eq(signals.profileId, profileId),
      eq(inspirations.profileId, profileId), isNull(inspirations.memoryExcludedAt)))
    .limit(3);
  return rows.map(row => row.id);
}
