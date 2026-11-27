/** A HUNCH'S PROMPT AND ITS PARSER (insight goal, phase 3, 2026-11-26).
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): nothing; the request builders and
 * parsers are pure. */
import { describe, expect, it } from "vitest";
import { ModelDidNotAnswerError, type HunchInput } from "../lib/model-provider.js";
import { buildHunchRequest, buildSignalExtractionRequest, parseHunch, buildReflectionQuestionRequest } from "./gemini.js";

const input: HunchInput = {
  preferredLocale: "en-US",
  saves: [
    { id: "walk", text: "Walked home the long way to hear the river.", prompt: null },
    { id: "quit", text: "My friend asked why I still work somewhere that makes me small.", prompt: "Tell me about a conversation you keep thinking about" },
  ],
  declined: [{ body: "You want to leave. Am I close?", correction: "It is about room to grow." }],
};

describe("the hunch request", () => {
  it("offers each save by id, with the question it answered fenced as context, and what was declined", () => {
    const request = buildHunchRequest(input);
    const prompt = request.contents[0]!.parts[0]!.text;
    expect(prompt).toContain("save walk");
    expect(prompt).toContain("Tell me about a conversation you keep thinking about");
    expect(prompt).toContain("It is about room to grow.");
    const system = request.systemInstruction!.parts[0]!.text;
    expect(system).toMatch(/Am I close\?/);
    expect(system).toMatch(/Never a trait that would fit anyone/);
    expect(system).toMatch(/must honour what they said instead/);
  });
});

describe("parsing a hunch", () => {
  it("keeps a particular line that asks, citing only offered saves", () => {
    expect(parseHunch({ hunch: "You keep choosing room to grow over the safe desk. Am I close?", inspirationIds: ["quit", "invented"] }, input))
      .toEqual({ hunch: "You keep choosing room to grow over the safe desk. Am I close?", inspirationIds: ["quit"] });
  });
  it("refuses a line that does not ask, cites nothing real, uses a dash, or repeats a declined line", () => {
    for (const payload of [
      { hunch: "You keep choosing room to grow.", inspirationIds: ["quit"] },
      { hunch: "You keep choosing room to grow. Am I close?", inspirationIds: ["invented"] },
      { hunch: "Room to grow — not leaving. Am I close?", inspirationIds: ["quit"] },
      { hunch: "You want to leave. Am I close?", inspirationIds: ["quit"] },
    ]) expect(() => parseHunch(payload, input)).toThrow(ModelDidNotAnswerError);
  });
});

describe("an answer keeps its question", () => {
  it("shows a save's question to signal extraction and to the reflection question, as context", () => {
    const extraction = buildSignalExtractionRequest({ profileId: "p", preferredLocale: "en-US",
      inspiration: { id: "quit", text: "My friend asked why I stay.", source: "app", createdAt: new Date(0), prompt: "Tell me about a conversation you keep thinking about" },
      reflections: [], attachments: [], relatedInspirations: [], existingCategories: [], existingStatements: [] } as never).contents[0]!.parts[0]!.text;
    expect(extraction).toContain("answers this question WAKA asked");
    expect(extraction).toContain("Tell me about a conversation you keep thinking about");
    const reflection = buildReflectionQuestionRequest({ preferredLocale: "en-US", inspirationText: "My friend asked why I stay.",
      inspirationPrompt: "Tell me about a conversation you keep thinking about", reflections: [] }).contents[0]!.parts[0]!.text;
    expect(reflection).toContain("Tell me about a conversation you keep thinking about");
  });
});
