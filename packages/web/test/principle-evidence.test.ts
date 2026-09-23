/** WHAT THIS MOCKS, AND WHY (gate G6): nothing. The display excerpt is a pure
 * text transformation; real input strings exercise it without replacing any layer.
 */
import { describe, expect, it } from "vitest";
import { principleEvidenceExcerpt } from "../src/components/PrincipleEvidence";

describe("readable principle evidence", () => {
  it("keeps the pattern and removes embedded model annotations", () => {
    expect(principleEvidenceExcerpt('Ship the small working version. (This is a pattern I also see in how I connect my local tools.) — grounded in: a save — earlier witness: 253db005-6c8a-406a-a955-87973564e'))
      .toBe("Ship the small working version.");
  });
  it("removes complete and legacy truncated identifiers", () => {
    expect(principleEvidenceExcerpt("A pattern 253db005-6c8a-406a-a955-87973564e and 1234567890abcdef1234567890abcdef"))
      .toBe("A pattern and");
  });
  it("bounds long prose as an explicit excerpt without changing saved text", () => {
    const original = "Choose a smaller experiment before expanding the scope ".repeat(8);
    const excerpt = principleEvidenceExcerpt(original);
    expect(excerpt.length).toBeLessThanOrEqual(151);
    expect(excerpt.endsWith("…")).toBe(true);
    expect(original.length).toBeGreaterThan(300);
  });
});
