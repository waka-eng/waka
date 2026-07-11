import { describe, expect, it } from "vitest";

import {
  canonicalTopOfMindValue,
  evidenceFingerprint,
  evaluateTopOfMindCandidate,
  semanticFamilyKey,
} from "./top-of-mind-value.js";

describe("canonicalTopOfMindValue", () => {
  it("computes one clamped server-owned 0-100 value", () => {
    expect(
      canonicalTopOfMindValue({
        evidenceCount: 3,
        confidence: 80,
        relevance: 70,
        novelty: 60,
      }),
    ).toBe(69);
    expect(
      canonicalTopOfMindValue({
        evidenceCount: 99,
        confidence: 999,
        relevance: 999,
        novelty: 999,
      }),
    ).toBe(100);
    expect(
      canonicalTopOfMindValue({
        evidenceCount: -1,
        confidence: -5,
        relevance: -2,
        novelty: -10,
      }),
    ).toBe(0);
  });

  it("produces stable semantic and evidence identities", () => {
    const family = semanticFamilyKey("context_node", "node-1");
    expect(semanticFamilyKey("context_node", "node-1")).toBe(family);
    expect(semanticFamilyKey("context_node", "node-2")).not.toBe(family);
    expect(evidenceFingerprint(["b", "a", "a"])).toBe(
      evidenceFingerprint(["a", "b"]),
    );
    expect(evidenceFingerprint(["a", "c"])).not.toBe(
      evidenceFingerprint(["a", "b"]),
    );
  });

  it("keeps retries, requires a five-point improvement, and protects pins", () => {
    const existing = { value: 70, evidenceFingerprint: "old", isPinned: false };
    expect(
      evaluateTopOfMindCandidate({
        candidateValue: 100,
        candidateEvidenceFingerprint: "old",
        existing,
      }),
    ).toBe("keep_existing");
    expect(
      evaluateTopOfMindCandidate({
        candidateValue: 74,
        candidateEvidenceFingerprint: "new",
        existing,
      }),
    ).toBe("keep_existing");
    expect(
      evaluateTopOfMindCandidate({
        candidateValue: 75,
        candidateEvidenceFingerprint: "new",
        existing,
      }),
    ).toBe("replace");
    expect(
      evaluateTopOfMindCandidate({
        candidateValue: 100,
        candidateEvidenceFingerprint: "new",
        existing: { ...existing, isPinned: true },
      }),
    ).toBe("blocked_by_pin");
  });
});
