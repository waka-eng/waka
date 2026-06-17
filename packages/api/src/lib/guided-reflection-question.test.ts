import { describe, expect, it, vi } from "vitest";

import {
  buildGuidedReflectionQuestionRequest,
  fallbackGuidedReflectionQuestion,
  generateGuidedReflectionQuestion,
  parseGuidedReflectionQuestionResponse,
} from "./guided-reflection-question.js";

const baseInput = {
  locale: "en-US" as const,
  inspiration: {
    text: "A studio table covered in sketches makes me want a quieter rhythm.",
    kind: "note" as const,
    links: ["https://example.com/studio"],
    attachmentKinds: ["link" as const],
    highlights: ["quieter rhythm"],
    resonance: "want",
    resonanceNote: "I want the room more than the object.",
  },
  priorAnswers: [
    {
      question: "What first caught you here?",
      answer: "The protected studio feeling.",
    },
  ],
};

function geminiJson(question: string): Response {
  return new Response(
    JSON.stringify({
      candidates: [
        {
          content: {
            parts: [{ text: JSON.stringify({ question }) }],
          },
        },
      ],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("guided reflection question contract", () => {
  it("builds a JSON-only Gemini request containing inspiration and prior answers as untrusted payload data", () => {
    const request = buildGuidedReflectionQuestionRequest(baseInput);

    expect(request.generationConfig.responseMimeType).toBe("application/json");
    expect(request.generationConfig.responseSchema).toEqual({
      type: "OBJECT",
      properties: { question: { type: "STRING" } },
      required: ["question"],
    });

    const prompt = JSON.parse(request.contents[0]!.parts[0]!.text) as {
      inspiration: { untrustedText: string; untrustedHighlights: string[] };
      priorAnswers: Array<{ untrustedQuestion: string; untrustedAnswer: string }>;
    };
    expect(prompt.inspiration.untrustedText).toContain("studio table");
    expect(prompt.inspiration.untrustedHighlights).toEqual(["quieter rhythm"]);
    expect(prompt.priorAnswers[0]).toEqual({
      index: 0,
      untrustedQuestion: "What first caught you here?",
      untrustedAnswer: "The protected studio feeling.",
    });
  });

  it("returns model-authored questions when the response satisfies the schema", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      geminiJson("What would make that protected studio feeling easier to choose this week?"),
    );

    const result = await generateGuidedReflectionQuestion(baseInput, {
      apiKey: "test-key",
      fetchFn,
    });

    expect(result).toEqual({
      question: "What would make that protected studio feeling easier to choose this week?",
      source: "model",
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0]![1]!.headers).toMatchObject({ "x-goog-api-key": "test-key" });
  });

  it("falls back safely when model configuration or responses are unavailable", async () => {
    await expect(generateGuidedReflectionQuestion(baseInput, { apiKey: "" })).resolves.toEqual({
      question: fallbackGuidedReflectionQuestion(baseInput),
      source: "fallback",
      fallbackReason: "no_model_config",
    });

    const badFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "not json" }] } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    await expect(
      generateGuidedReflectionQuestion(baseInput, { apiKey: "test-key", fetchFn: badFetch }),
    ).resolves.toEqual({
      question: fallbackGuidedReflectionQuestion(baseInput),
      source: "fallback",
      fallbackReason: "invalid_model_response",
    });
  });

  it("rejects empty or over-broad parsed model payloads", () => {
    expect(parseGuidedReflectionQuestionResponse({ candidates: [] })).toBeNull();
    expect(
      parseGuidedReflectionQuestionResponse({
        candidates: [{ content: { parts: [{ text: JSON.stringify({ question: "Short" }) }] } }],
      }),
    ).toBeNull();
  });
});
