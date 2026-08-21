/**
 * The group synthesis request: same artifact schema, different subject. What
 * matters here is that the group branch is chosen only when a group is
 * present, that member ownership reaches the prompt (the cross-member reading
 * is the point), and that the personal path is byte-identical to before.
 */

import { describe, expect, it } from "vitest";

import type { TopOfMindSynthesisInput } from "../lib/model-provider.js";
import {
  buildTopOfMindSynthesisRequest,
  GROUP_TOP_OF_MIND_SYNTHESIS_SYSTEM_INSTRUCTION,
  TOP_OF_MIND_SYNTHESIS_SYSTEM_INSTRUCTION,
} from "./gemini.js";

function baseInput(): TopOfMindSynthesisInput {
  return {
    profileId: "tenant-1",
    preferredLocale: "en-US",
    provisional: false,
    recentFeedback: [],
    lockedEntries: [],
    currentEntries: [],
    signals: [
      {
        id: "s1",
        statement: "Batch-cooking keeps the weekdays calm.",
        confidence: 52,
        evidenceCount: 4,
        lastEvidenceAt: new Date("2026-08-01T00:00:00Z"),
      },
    ],
  };
}

describe("the group synthesis request", () => {
  it("speaks the group instruction only when a group is present", () => {
    const personal = buildTopOfMindSynthesisRequest(baseInput());
    expect(personal.systemInstruction.parts[0]!.text).toBe(
      TOP_OF_MIND_SYNTHESIS_SYSTEM_INSTRUCTION,
    );

    const group = buildTopOfMindSynthesisRequest({
      ...baseInput(),
      group: { name: "field kitchen", memberNames: ["Ann", "Ben"] },
    });
    expect(group.systemInstruction.parts[0]!.text).toBe(
      GROUP_TOP_OF_MIND_SYNTHESIS_SYSTEM_INSTRUCTION,
    );
  });

  it("names the group, its members, and each signal's owner in the prompt", () => {
    const input: TopOfMindSynthesisInput = {
      ...baseInput(),
      group: { name: "field kitchen", memberNames: ["Ann", "Ben"] },
    };
    input.signals[0]!.ownerName = "Ann";
    const prompt = buildTopOfMindSynthesisRequest(input).contents[0]!.parts[0]!.text!;
    expect(prompt).toContain('The group is "field kitchen"');
    expect(prompt).toContain("Ann, Ben");
    expect(prompt).toContain("owner: Ann");
  });

  it("keeps ownership out of the personal prompt entirely", () => {
    const prompt = buildTopOfMindSynthesisRequest(baseInput()).contents[0]!.parts[0]!
      .text!;
    expect(prompt).not.toContain("owner:");
    expect(prompt).not.toContain("The group is");
  });

  /** The group voice is plural and cross-member; the words that carry that. */
  it("asks for the group's voice, not one person's", () => {
    expect(GROUP_TOP_OF_MIND_SYNTHESIS_SYSTEM_INSTRUCTION).toMatch(/plural voice/);
    expect(GROUP_TOP_OF_MIND_SYNTHESIS_SYSTEM_INSTRUCTION).toMatch(
      /MORE THAN ONE member/,
    );
    expect(GROUP_TOP_OF_MIND_SYNTHESIS_SYSTEM_INSTRUCTION).toMatch(
      /Never address one\s+person as "you"/,
    );
  });
});
