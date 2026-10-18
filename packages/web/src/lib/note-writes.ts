/**
 * ═══ HOW MANY WRITES OF A NOTE ARE STILL OUT — AND WHEN THERE ARE NONE ═════
 *
 * One rule replaces the run of special cases two review rounds kept finding
 * holes in (review, 2026-10-17): every read of a note's words, and every
 * editor seeded from them, waits until no write of that note is in flight.
 *
 * A COUNT, not a flag or a single promise: the card's writes are queued one
 * behind another (`inOrder` in `space/editing.ts`), so a second write can be
 * waiting while the first is out. A write is counted from the moment it is
 * QUEUED — not when it reaches the network — and uncounted when it settles,
 * either way. `idle(id)` resolves when the count for `id` reaches zero (at
 * once if it already is).
 */
/** How long a read waits for a note's writes before it gives up. */
export const IDLE_CEILING_MS = 25_000;

export class NoteWrites {
  private readonly counts = new Map<string, number>();
  private readonly waiting = new Map<string, Array<() => void>>();

  /** A write of `id` was queued. */
  start(id: string): void {
    this.counts.set(id, (this.counts.get(id) ?? 0) + 1);
  }

  /** A write of `id` settled — landed or failed. */
  settle(id: string): void {
    const left = Math.max(0, (this.counts.get(id) ?? 0) - 1);
    if (left > 0) { this.counts.set(id, left); return; }
    this.counts.delete(id);
    const resolve = this.waiting.get(id) ?? [];
    this.waiting.delete(id);
    for (const done of resolve) done();
  }

  /** Is any write of `id` still out? */
  pending(id: string): boolean {
    return (this.counts.get(id) ?? 0) > 0;
  }

  /** Resolves `true` once no write of `id` is out — or `false` after
      `ceilingMs` (pass `Infinity` for no ceiling), so a caller waiting on a
      slow write can say "Still saving…" instead of sitting silent. Writes
      themselves are not cut off: an abandoned write that still commits would
      break the order everything here relies on. */
  idle(id: string, ceilingMs = IDLE_CEILING_MS): Promise<boolean> {
    if (!this.pending(id)) return Promise.resolve(true);
    return new Promise((done) => {
      let finished = false;
      const finish = (ok: boolean) => { if (!finished) { finished = true; done(ok); } };
      const timer = Number.isFinite(ceilingMs) ? setTimeout(() => finish(false), ceilingMs) : undefined;
      const list = this.waiting.get(id) ?? [];
      list.push(() => { clearTimeout(timer); finish(true); });
      this.waiting.set(id, list);
    });
  }
}
