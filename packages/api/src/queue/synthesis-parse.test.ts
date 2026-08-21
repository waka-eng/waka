import { describe, expect, it, vi } from "vitest";

import { parseTopOfMindSynthesis } from "./gemini.js";

/**
 * THE PARSER THAT COULD EMPTY SOMEONE'S TOP OF MIND.
 *
 * `parseTopOfMindSynthesis` validated the artifact as a single object, so one
 * entry with a `type` outside the enum failed the whole thing and the function
 * returned `{entries: []}` — discarding `noChange` and every good entry with
 * it. Downstream that read as "the model says you have nothing", and a live
 * artifact was superseded by a version with no machine-authored entries.
 *
 * These execute the three replies that produced that outcome. They are here
 * because the failure was never a crash: every step returned successfully and
 * the person simply lost their board.
 */
describe("parseTopOfMindSynthesis", () => {
  const good = {
    type: "pattern",
    body: "You want the first move made for you.",
    citedSignalIds: ["sig-1"],
  };

  it("keeps the good entries when one of them is malformed", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const out = parseTopOfMindSynthesis({
      entries: [good, { type: "not-a-real-type", body: "should be dropped" }, good],
    });
    expect(out.entries).toHaveLength(2);
    expect(out.entries[0]?.body).toBe(good.body);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("preserves noChange even when every entry is unusable", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const out = parseTopOfMindSynthesis({
      noChange: true,
      entries: [{ type: "nonsense", body: "x" }],
    });
    // The old parser returned {entries: []} with noChange lost, and the caller
    // could not tell "the model declined to change anything" from "the model
    // says you now have nothing".
    expect(out.noChange).toBe(true);
    expect(out.entries).toHaveLength(0);
    warn.mockRestore();
  });

  it("carries noChange through a reply that sends no entries at all", () => {
    const out = parseTopOfMindSynthesis({ noChange: true, entries: [] });
    expect(out.noChange).toBe(true);
    expect(out.entries).toHaveLength(0);
  });

  it("still rejects a payload that is not an artifact", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(parseTopOfMindSynthesis("nope").entries).toHaveLength(0);
    expect(parseTopOfMindSynthesis({ entries: "not an array" }).entries).toHaveLength(0);
    warn.mockRestore();
  });

  it("drops entries with an empty body, as it always did", () => {
    const out = parseTopOfMindSynthesis({
      entries: [good, { type: "question", body: "   " }],
    });
    expect(out.entries).toHaveLength(1);
  });
});
