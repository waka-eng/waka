/**
 * ═══ A NOTE'S DETAIL IS READ AFTER ITS WRITES, AND RE-READ IF STALE ═══════
 *
 * Review, 2026-10-17 — `lib/detail-reads.ts` with `lib/note-writes.ts`. One
 * rule: every read waits until no write of the note is out; a read that
 * turns out stale for any reason (a save while it was out, a row older than
 * one accepted, a failure after a write began) is made again after the
 * writes are idle. It never answers with cached words from before a write.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6). Nothing in the product: the fetch is
 * a function the case hands in and answers by hand, because the subject is
 * the ordering rule, not the network.
 */
import { describe, expect, it, vi } from "vitest";

import type { InspirationDetail } from "../src/lib/data";
import { markSaved, newerDetail, readDetail, type DetailReadState } from "../src/lib/detail-reads";
import { IDLE_CEILING_MS, NoteWrites } from "../src/lib/note-writes";

const state = (writes = new NoteWrites()): DetailReadState & { writes: NoteWrites } =>
  ({ details: new Map(), pending: new Map(), generations: new Map(), stamps: new Map(), writes });
const row = (text: string, updatedMs = 1_000): InspirationDetail =>
  ({ id: "n1", text, preview: text, updatedMs, capturedMs: 0, attachments: [], reflections: [] }) as unknown as InspirationDetail;

/** A fetch whose answers the case gives, in order. */
function heldFetch() {
  const asked: Array<{ done: (value: InspirationDetail) => void; fail: () => void }> = [];
  const fetch = () => new Promise<InspirationDetail>((done, fail) => { asked.push({ done, fail: () => fail(new Error("offline")) }); });
  return { fetch, asked };
}
const tick = async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); };

describe("a note's detail read", () => {
  it("is cached when nothing happened while it was out", async () => {
    const s = state(), f = heldFetch();
    const p = readDetail(s, "n1", f.fetch);
    await tick();
    f.asked[0]!.done(row("stored"));
    expect((await p)?.text).toBe("stored");
    expect(s.details.get("n1")?.text).toBe("stored");
  });

  it("waits for every write of the note — including one queued behind another — then reads the last", async () => {
    const s = state(), f = heldFetch();
    s.writes.start("n1"); // X is out
    s.writes.start("n1"); // Y is queued behind it
    const p = readDetail(s, "n1", f.fetch);
    await tick();
    expect(f.asked, "no read while X is out").toHaveLength(0);
    s.writes.settle("n1"); // X lands
    await tick();
    expect(f.asked, "nor while Y is still queued").toHaveLength(0);
    s.writes.settle("n1"); // Y lands
    await tick();
    f.asked[0]!.done(row("Y"));
    expect((await p)?.text).toBe("Y");
  });

  it("started before a save, is read again — never answered with the cache", async () => {
    const s = state(), f = heldFetch();
    s.details.set("n1", row("cached before the save"));
    const p = readDetail(s, "n1", f.fetch);
    await tick();
    markSaved(s, "n1");
    f.asked[0]!.done(row("before the save"));
    await tick();
    expect(f.asked, "a fresh read went out").toHaveLength(2);
    f.asked[1]!.done(row("after the save", 2_000));
    expect((await p)?.text).toBe("after the save");
  });

  it("failing after a write began, is read again once the write lands — and shows the written words", async () => {
    const s = state(), f = heldFetch();
    const p = readDetail(s, "n1", f.fetch);
    await tick();
    s.writes.start("n1");
    markSaved(s, "n1");
    f.asked[0]!.fail();
    await tick();
    expect(f.asked, "no re-read while the write is out").toHaveLength(1);
    s.writes.settle("n1");
    await tick();
    expect(f.asked).toHaveLength(2);
    f.asked[1]!.done(row("the written words", 2_000));
    expect((await p)?.text).toBe("the written words");
  });

  it("answering with a row older than one already accepted, is read again", async () => {
    const s = state(), f = heldFetch();
    s.stamps.set("n1", 5_000);
    const p = readDetail(s, "n1", f.fetch);
    await tick();
    f.asked[0]!.done(row("older", 4_000));
    await tick();
    f.asked[1]!.done(row("newer", 5_000));
    expect((await p)?.text).toBe("newer");
  });

  /* A SLOW WRITE IS NOT A FAILED ONE (review, 2026-10-17). Past the
     ceiling the read says "still saving" and keeps waiting; it reads — the
     written words — when the write settles. It never reads while it is out. */
  it("past the ceiling, says still saving and reads the written words once the write settles", async () => {
    vi.useFakeTimers();
    try {
      const told: string[] = [];
      const s = { ...state(), onStillSaving: (id: string) => { told.push(id); } }, f = heldFetch();
      s.writes.start("n1");
      const p = readDetail(s, "n1", f.fetch);
      await vi.advanceTimersByTimeAsync(IDLE_CEILING_MS + 10);
      expect(told, "the card was told it is still saving").toEqual(["n1"]);
      expect(f.asked, "and nothing was read while the write is out").toHaveLength(0);
      s.writes.settle("n1");
      await vi.advanceTimersByTimeAsync(0);
      expect(f.asked).toHaveLength(1);
      f.asked[0]!.done(row("the written words", 2_000));
      expect((await p)?.text).toBe("the written words");
    } finally {
      vi.useRealTimers();
    }
  });

  /* A JOINED READ'S FAILURE IS STILL KNOWN: the address open joins a read
     the card started, and a 404 must still say "unavailable". */
  it("records a fetch's failure where a caller that joined it can read it", async () => {
    const errors = new Map<string, unknown>();
    const s = { ...state(), errors }, f = heldFetch();
    const first = readDetail(s, "n1", f.fetch);
    const joined = readDetail(s, "n1", f.fetch);
    expect(joined).toBe(first);
    await tick();
    f.asked[0]!.fail();
    expect(await joined).toBeNull();
    expect((errors.get("n1") as Error).message).toBe("offline");
  });

  it("never lets a read replace a newer detail already shown", () => {
    const shown = row("saved while the read was out", 3_000);
    expect(newerDetail(shown, row("read before it", 2_000))).toBe(shown);
    const later = row("read after it", 4_000);
    expect(newerDetail(shown, later)).toBe(later);
    expect(newerDetail(shown, null), "a failed read keeps what is shown").toBe(shown);
  });

  it("fails plainly when nothing went stale", async () => {
    const s = state(), f = heldFetch();
    const p = readDetail(s, "n1", f.fetch);
    await tick();
    f.asked[0]!.fail();
    expect(await p).toBeNull();
  });
});
