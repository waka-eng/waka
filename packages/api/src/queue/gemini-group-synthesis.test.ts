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

/**
 * The Korean closing word. The opening Locale line alone lost to "keep
 * existing entries stable" (observed live, 2026-08-31: carried-forward
 * entries stayed English after the person chose Korean), so a ko-KR
 * synthesis ends on the language instruction — the last thing read wins.
 * English gets no closing word: the personal prompt stays byte-stable.
 */
describe("the Korean closing word", () => {
  it("ends a ko-KR prompt on the Korean final check", () => {
    const prompt = buildTopOfMindSynthesisRequest({
      ...baseInput(),
      preferredLocale: "ko-KR",
    }).contents[0]!.parts[0]!.text!;
    expect(prompt.endsWith("마지막 점검: 모든 문장은 번역투 없는 자연스러운 한국어로 쓰세요.")).toBe(true);
    expect(prompt).toMatch(/locked entries alone stay exactly as written/);
  });

  it("gives English no closing word at all", () => {
    const prompt = buildTopOfMindSynthesisRequest(baseInput()).contents[0]!.parts[0]!
      .text!;
    expect(prompt).not.toContain("마지막 점검");
    expect(prompt).not.toContain("Final check");
  });
});
