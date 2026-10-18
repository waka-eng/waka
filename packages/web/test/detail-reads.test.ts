/**
 * ═══ A DETAIL READ OLDER THAN A SAVE NEVER WINS — `lib/detail-reads.ts` ════
 *
 * Review, 2026-10-17 (rounds 3 and 4). The rule Home's memory card reads
 * through: a read that started before a save, or that answers with a row
 * older than one already accepted, is never cached; the save's cached detail
 * answers instead, and when the save left none, the read is made again —
 * never answered with null.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6). Nothing in the product: the fetch is
 * a function the case hands in and answers by hand, because the subject is
 * the ordering rule, not the network.
 */
import { describe, expect, it } from "vitest";

import type { InspirationDetail } from "../src/lib/data";
import { markSaved, readDetail, type DetailReadState } from "../src/lib/detail-reads";

const state = (): DetailReadState => ({ details: new Map(), pending: new Map(), generations: new Map(), stamps: new Map() });
const row = (text: string, updatedMs = 1_000): InspirationDetail =>
  ({ id: "n1", text, preview: text, updatedMs, capturedMs: 0, attachments: [], reflections: [] }) as unknown as InspirationDetail;

/** A fetch whose answers the case releases, in order. */
function heldFetch() {
  const asked: Array<(value: InspirationDetail) => void> = [];
  const fetch = () => new Promise<InspirationDetail>((done) => { asked.push(done); });
  return { fetch, asked };
}

describe("a note's detail read", () => {
  it("is cached when nothing happened while it was out", async () => {
    const s = state(), f = heldFetch();
    const p = readDetail(s, "n1", f.fetch);
    f.asked[0]!(row("stored"));
    expect((await p)?.text).toBe("stored");
    expect(s.details.get("n1")?.text).toBe("stored");
  });

  it("started before a save, is dropped for the save's cached words", async () => {
    const s = state(), f = heldFetch();
    const p = readDetail(s, "n1", f.fetch);
    markSaved(s, "n1");
    s.details.set("n1", row("saved"));
    f.asked[0]!(row("before the save"));
    expect((await p)?.text).toBe("saved");
    expect(s.details.get("n1")?.text).toBe("saved");
  });

  it("started before a save that left nothing cached, is read again — not answered with null", async () => {
    const s = state(), f = heldFetch();
    const p = readDetail(s, "n1", f.fetch);
    markSaved(s, "n1"); // a save with no row to show for it
    f.asked[0]!(row("before the save"));
    await Promise.resolve(); await Promise.resolve();
    expect(f.asked, "a fresh read went out").toHaveLength(2);
    f.asked[1]!(row("after the save", 2_000));
    expect((await p)?.text).toBe("after the save");
    expect(s.details.get("n1")?.text).toBe("after the save");
  });

  it("answering with a row older than one already accepted, is dropped", async () => {
    const s = state(), f = heldFetch();
    s.stamps.set("n1", 5_000);
    s.details.set("n1", row("newer", 5_000));
    const p = readDetail(s, "n1", f.fetch);
    f.asked[0]!(row("older", 4_000));
    expect((await p)?.text).toBe("newer");
  });
});
