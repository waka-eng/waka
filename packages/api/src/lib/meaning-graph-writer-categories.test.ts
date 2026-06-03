import { describe, expect, it } from "vitest";

import { contextNodeTypeValues, normalizeContextNodeType } from "./context-node-types.js";
import { meaningNodeTypeValues } from "./meaning-graph-writer.js";

describe("meaning graph context node categories", () => {
  it("uses the ambition mirror context-node categories for new graph writes", () => {
    expect(meaningNodeTypeValues).toEqual(contextNodeTypeValues);
    expect(meaningNodeTypeValues).toEqual([
      "theme",
      "value",
      "person",
      "environment",
      "aesthetic",
      "tension",
      "project",
      "open_question",
      "hypothesis",
    ]);
  });

  it("normalizes legacy meaning-node types deterministically", () => {
    expect(normalizeContextNodeType("question")).toBe("open_question");
    expect(normalizeContextNodeType("life_direction")).toBe("project");
    expect(normalizeContextNodeType("person_archetype")).toBe("person");
    expect(normalizeContextNodeType("desire")).toBe("hypothesis");
    expect(normalizeContextNodeType("claim")).toBe("theme");
    expect(normalizeContextNodeType("unknown_legacy_type")).toBe("theme");
  });
});
