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
 * And every read first waits until no write of the note is out
 * (`lib/note-writes.ts`). A stale answer is never cached and never answered
 * with the cache: the read is made again, after the writes are idle.
 *
 * Kept outside `Home.tsx` so the rule can be tested on its own; Home passes
 * its refs' maps in.
 */
import type { InspirationDetail } from "./data";
import type { NoteWrites } from "./note-writes";

export interface DetailReadState {
  /** The cache of full details, by note id. */
  details: Map<string, InspirationDetail>;
  /** Reads in flight, by note id — a second ask joins the first. */
  pending: Map<string, Promise<InspirationDetail | null>>;
  /** Saves seen, by note id. */
  generations: Map<string, number>;
  /** Newest accepted server `updatedAt` (ms), by note id. */
  stamps: Map<string, number>;
  /** Writes of each note still out (`lib/note-writes.ts`). Every read
      waits until there are none. */
  writes?: Pick<NoteWrites, "idle">;
}

/** How many times a read that keeps turning out stale is made again before
    it gives up (answers null, which the card shows as Try again). */
const RE_READS = 3;

/**
 * ONE RULE (review, 2026-10-17): a read waits until no write of the note is
 * out, then reads. If it turns out stale anyway — a save, an upload, or a
 * write that started while it was out (generation), or a row older than one
 * already accepted (stamp), including a read that FAILED after such a bump —
 * it is made again, after the writes are idle. It never answers with cached
 * words from before a write.
 */
export function readDetail(
  state: DetailReadState,
  id: string,
  fetch: (id: string) => Promise<InspirationDetail>,
  attempt = 0,
): Promise<InspirationDetail | null> {
  const inFlight = state.pending.get(id);
  if (inFlight) return inFlight;
  const AGAIN = Symbol("read again");
  const settle = () => { if (state.pending.get(id) === p) state.pending.delete(id); };
  const p: Promise<InspirationDetail | null> = (state.writes ? state.writes.idle(id) : Promise.resolve())
    .then(() => {
      const generation = state.generations.get(id) ?? 0;
      const stale = (row?: InspirationDetail) =>
        (state.generations.get(id) ?? 0) !== generation
        || (row !== undefined && row.updatedMs < (state.stamps.get(id) ?? -Infinity));
      return fetch(id).then(
        (row): InspirationDetail | typeof AGAIN => {
          if (stale(row)) return AGAIN;
          state.details.set(id, row);
          return row;
        },
        (): null | typeof AGAIN => (stale() ? AGAIN : null),
      );
    })
    .then((result) => {
      settle();
      if (result !== AGAIN) return result;
      return attempt < RE_READS ? readDetail(state, id, fetch, attempt + 1) : null;
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
