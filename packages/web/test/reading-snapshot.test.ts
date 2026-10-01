/** WHAT THIS MOCKS, AND WHY: nothing; these are pure ordering and scope rules. */
import { describe, expect, it } from "vitest";
import { acceptsReadingSnapshot } from "../src/lib/reading-snapshot";
import type { TopOfMind } from "../src/lib/data";

const reading = (revision: string, version = 1): TopOfMind => ({
  id: `reading-${version}`, profileId: "owner", generationRevision: revision,
  version, reason: "initial", createdMs: 1, entries: [],
});
describe("private reading snapshots", () => {
  it("does not restore an older same-version support projection", () => {
    expect(acceptsReadingSnapshot(reading("20"), reading("19"), "owner")).toBe(false);
    expect(acceptsReadingSnapshot(reading("20"), reading("21"), "owner")).toBe(true);
  });
  it("keeps revision precision beyond the JavaScript number range", () => {
    expect(acceptsReadingSnapshot(reading("9007199254740993"), reading("9007199254740992"))).toBe(false);
  });
  it("rejects a different profile and a stale initial-null response", () => {
    expect(acceptsReadingSnapshot(null, reading("1"), "someone-else")).toBe(false);
    expect(acceptsReadingSnapshot(reading("1"), null)).toBe(false);
  });
  it("does not rewind artifact identity even when a historical read has a fresh token", () => {
    expect(acceptsReadingSnapshot(reading("2", 2), reading("3", 1))).toBe(false);
  });
  it("accepts legacy payloads only until a revisioned snapshot is known", () => {
    const legacy = { ...reading("1"), generationRevision: undefined };
    expect(acceptsReadingSnapshot(null, legacy)).toBe(true);
    expect(acceptsReadingSnapshot(reading("1"), legacy)).toBe(false);
  });
});
