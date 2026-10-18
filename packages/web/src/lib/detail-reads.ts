/**
 * ═══ ONE NOTE'S FULL DETAIL, READ SO THAT AN OLD ANSWER NEVER WINS ══════════
 *
 * Home reads a note's full detail for the memory card (and warms it ahead of
 * a tap); the archive saves notes over the same world. A read is slow enough
 * that a save can land while it is out, and the read then answers with the
 * words from BEFORE the save — which, cached, became the next edit's starting
 * point and overwrote the save (review, 2026-10-17: data loss).
 *
 * So every read is checked against two stamps when it lands:
 *
 *   - the note's SAVE GENERATION, bumped by every save this page sees — a
 *     read that started under an older generation is older than a save;
 *   - the newest server `updatedAt` this page has accepted for the note — a
 *     row older than it is older than something already shown.
 *
 * A stale answer is never cached. If the save left a detail in the cache,
 * that is the answer; if it did not (a save that came back with no row),
 * the read is made again — a read started now is fresh — rather than
 * answering null and leaving the card with "couldn't load the rest".
 *
 * Kept outside `Home.tsx` so the rule can be tested on its own; Home passes
 * its refs' maps in.
 */
import type { InspirationDetail } from "./data";

export interface DetailReadState {
  /** The cache of full details, by note id. */
  details: Map<string, InspirationDetail>;
  /** Reads in flight, by note id — a second ask joins the first. */
  pending: Map<string, Promise<InspirationDetail | null>>;
  /** Saves seen, by note id. */
  generations: Map<string, number>;
  /** Newest accepted server `updatedAt` (ms), by note id. */
  stamps: Map<string, number>;
  /** Writes of a note still in flight, by note id: settle when the write
      has landed (and its words are cached) or failed. */
  writes?: Map<string, Promise<void>>;
}

export function readDetail(
  state: DetailReadState,
  id: string,
  fetch: (id: string) => Promise<InspirationDetail>,
): Promise<InspirationDetail | null> {
  const inFlight = state.pending.get(id);
  if (inFlight) return inFlight;
  const generation = state.generations.get(id) ?? 0;
  const stale = (row?: InspirationDetail) =>
    (state.generations.get(id) ?? 0) !== generation
    || (row !== undefined && row.updatedMs < (state.stamps.get(id) ?? -Infinity));
  const settle = () => { if (state.pending.get(id) === p) state.pending.delete(id); };
  const p: Promise<InspirationDetail | null> = fetch(id)
    .then((row) => {
      settle();
      if (stale(row)) {
        /* A WRITE STILL IN FLIGHT: the cache holds the words from BEFORE it,
           so they are not the answer either — wait for the write to land
           (it caches its own row) and answer with that, or read again. */
        const writing = state.writes?.get(id);
        if (writing) return writing.then(() => state.details.get(id) ?? readDetail(state, id, fetch));
        return state.details.get(id) ?? readDetail(state, id, fetch);
      }
      state.details.set(id, row);
      return row;
    })
    .catch(() => {
      settle();
      return stale() ? state.details.get(id) ?? null : null;
    });
  state.pending.set(id, p);
  return p;
}

/** A save of `id` happened: every read already out is now older than it. */
export function markSaved(state: DetailReadState, id: string, updatedAt?: string): void {
  state.generations.set(id, (state.generations.get(id) ?? 0) + 1);
  state.pending.delete(id);
  const stamp = updatedAt ? Date.parse(updatedAt) : NaN;
  if (Number.isFinite(stamp)) state.stamps.set(id, Math.max(stamp, state.stamps.get(id) ?? -Infinity));
}

/** A read that must not start until any write of `id` in flight has
    landed — the archive opening a note the card is saving. */
export function readAfterWrites(
  state: DetailReadState,
  id: string,
  fetch: (id: string) => Promise<InspirationDetail>,
): Promise<InspirationDetail | null> {
  const writing = state.writes?.get(id);
  return writing ? writing.then(() => readDetail(state, id, fetch)) : readDetail(state, id, fetch);
}
