import {
  GEMINI_API_BASE_URL,
  GEMINI_PROVIDER_SUPPORTED_OPERATIONS,
  GeminiProvider,
} from "../../packages/shared/llm/gemini-provider.ts";
import type { SharedProviderContractFixture } from "./shared-provider-contract-suite.ts";

function geminiJsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json",
      "x-goog-request-id": "gemini_contract_success_req",
    },
    ...init,
  });
}

export const geminiProviderContractFixture = {
  provider: "gemini",
  supportedOperations: GEMINI_PROVIDER_SUPPORTED_OPERATIONS,
  createProvider(fetchImplementation) {
    return new GeminiProvider({
      apiKey: "gemini-test-key",
      fetch: fetchImplementation,
    });
  },
  createSuccessFetch() {
    return async (input, init) => {
      const url = typeof input === "string" ? input : input.url;

      if (url === "https://assets.example/voice-note.mp3") {
        return new Response(new Uint8Array([1, 2, 3]), {
          headers: {
            "content-type": "audio/mpeg",
          },
        });
      }

      if (url === "https://assets.example/inspiration.png") {
        return new Response(new Uint8Array([137, 80, 78, 71]), {
          headers: {
            "content-type": "image/png",
          },
        });
      }

      if (!url.startsWith(`${GEMINI_API_BASE_URL}/models/`)) {
        throw new Error(`Unexpected fetch to ${url}`);
      }

      const body = JSON.parse(String(init?.body)) as {
        systemInstruction?: {
          parts?: Array<{
            text?: string;
          }>;
        };
      };
      const systemInstruction = body.systemInstruction?.parts?.[0]?.text;

      if (typeof systemInstruction !== "string") {
        throw new Error(
          `Unhandled Gemini request without system instruction: ${JSON.stringify(body)}`,
        );
      }

      if (systemInstruction.includes("Summarize the content")) {
        return geminiJsonResponse({
          modelVersion: "gemini-2.5-flash",
          candidates: [
            {
              content: {
                parts: [
                  {
                    text:
                      "  Capture first, cluster later, and keep every draft durable through retries. Capture first, cluster later, and keep every draft durable through retries. Capture first, cluster later, and keep every draft durable through retries. Capture first, cluster later, and keep every draft durable through retries. Capture first, cluster later, and keep every draft durable through retries. Offline queue sync should never drop a note on reconnect.  ",
                  },
                ],
                role: "model",
              },
              finishReason: "STOP",
            },
          ],
        });
      }

      if (systemInstruction.includes("Choose exactly one label")) {
        return geminiJsonResponse({
          modelVersion: "gemini-2.5-flash",
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: "  productivity  ",
                  },
                ],
                role: "model",
              },
            },
          ],
        });
      }

      if (systemInstruction.includes("reflective follow-up question")) {
        return geminiJsonResponse({
          modelVersion: "gemini-2.5-flash",
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: "  What pattern keeps showing up across these ideas?  ",
                  },
                ],
                role: "model",
              },
            },
          ],
        });
      }

      if (systemInstruction.includes("strongest connection")) {
        return geminiJsonResponse({
          modelVersion: "gemini-2.5-flash",
          candidates: [
            {
              content: {
                parts: [
                  {
                    text:
                      "  Both notes focus on turning fleeting captures into durable knowledge.  ",
                  },
                ],
                role: "model",
              },
            },
          ],
        });
      }

      if (systemInstruction.includes("Generate a concise, descriptive title")) {
        return geminiJsonResponse({
          modelVersion: "gemini-2.5-flash",
          candidates: [
            {
              content: {
                parts: [
                  {
                    text:
                      "  Reliable capture from web, voice, photos, CLI, and AI chats with resilient synthesis. Reliable capture from web, voice, photos, CLI, and AI chats with resilient synthesis.  ",
                  },
                ],
                role: "model",
              },
            },
          ],
        });
      }

      if (systemInstruction.includes("Classify the note into JSON")) {
        return geminiJsonResponse({
          modelVersion: "gemini-2.5-flash",
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      tags: ["capture", "knowledge", "ai"],
                      domain: "technology",
                      mood: "curious",
                      actionability: "idea",
                    }),
                  },
                ],
                role: "model",
              },
            },
          ],
        });
      }

      if (systemInstruction.includes("Transcribe this audio")) {
        return geminiJsonResponse({
          modelVersion: "gemini-2.0-flash-exp",
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: "  Voice transcript about linking scattered notes into one capture inbox.  ",
                  },
                ],
                role: "model",
              },
            },
          ],
        });
      }

      if (
        systemInstruction.includes("Describe the image") ||
        systemInstruction.includes("Extract any legible text")
      ) {
        return geminiJsonResponse({
          modelVersion: "gemini-2.5-flash",
          candidates: [
            {
              content: {
                parts: [
                  {
                    text:
                      "  A handwritten sticky note beside a laptop describing a fast capture workflow.  ",
                  },
                ],
                role: "model",
              },
            },
          ],
        });
      }

      throw new Error(`Unhandled Gemini request: ${JSON.stringify(body)}`);
    };
  },
  expectedSuccessRequestId: "gemini_contract_success_req",
} satisfies SharedProviderContractFixture;
