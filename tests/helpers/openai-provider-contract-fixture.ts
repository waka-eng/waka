import {
  OPENAI_API_BASE_URL,
  OPENAI_EMBEDDING_DIMENSIONS,
  OPENAI_EMBEDDING_MODEL,
  OpenAIProvider,
} from "../../packages/shared/llm/openai-provider.ts";
import { LLM_PROVIDER_OPERATIONS } from "../../packages/shared/llm/provider.ts";
import type { SharedProviderContractFixture } from "./shared-provider-contract-suite.ts";

function openAIJsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json",
      "x-request-id": "openai_contract_success_req",
    },
    ...init,
  });
}

export const openaiProviderContractFixture = {
  provider: "openai",
  supportedOperations: LLM_PROVIDER_OPERATIONS,
  createProvider(fetchImplementation) {
    return new OpenAIProvider({
      apiKey: "sk-test",
      fetch: fetchImplementation,
    });
  },
  createSuccessFetch() {
    const embeddingVector = Array.from(
      { length: OPENAI_EMBEDDING_DIMENSIONS },
      (_, index) => Number((index / OPENAI_EMBEDDING_DIMENSIONS).toFixed(6)),
    );

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

      if (url === `${OPENAI_API_BASE_URL}/embeddings`) {
        return openAIJsonResponse({
          model: OPENAI_EMBEDDING_MODEL,
          data: [
            {
              embedding: embeddingVector,
            },
          ],
        });
      }

      if (url === `${OPENAI_API_BASE_URL}/audio/transcriptions`) {
        return openAIJsonResponse({
          text: "  Voice transcript about linking scattered notes into one capture inbox.  ",
        });
      }

      if (url !== `${OPENAI_API_BASE_URL}/chat/completions`) {
        throw new Error(`Unexpected fetch to ${url}`);
      }

      const body = JSON.parse(String(init?.body)) as {
        messages?: Array<{
          role?: string;
          content?: unknown;
        }>;
        model?: string;
      };
      const systemInstruction = body.messages?.[0];

      if (
        systemInstruction?.role !== "system" ||
        typeof systemInstruction.content !== "string"
      ) {
        throw new Error(
          `Unhandled OpenAI request without system instruction: ${JSON.stringify(body)}`,
        );
      }

      if (systemInstruction.content.includes("Summarize the content")) {
        return openAIJsonResponse({
          model: body.model,
          choices: [
            {
              message: {
                content:
                  "  Capture first, cluster later, and keep every draft durable through retries. Capture first, cluster later, and keep every draft durable through retries. Capture first, cluster later, and keep every draft durable through retries. Capture first, cluster later, and keep every draft durable through retries. Capture first, cluster later, and keep every draft durable through retries. Offline queue sync should never drop a note on reconnect.  ",
              },
            },
          ],
        });
      }

      if (systemInstruction.content.includes("Choose exactly one label")) {
        return openAIJsonResponse({
          model: body.model,
          choices: [
            {
              message: {
                content: "  productivity  ",
              },
            },
          ],
        });
      }

      if (systemInstruction.content.includes("reflective follow-up question")) {
        return openAIJsonResponse({
          model: body.model,
          choices: [
            {
              message: {
                content: "  What pattern keeps showing up across these ideas?  ",
              },
            },
          ],
        });
      }

      if (systemInstruction.content.includes("strongest connection")) {
        return openAIJsonResponse({
          model: body.model,
          choices: [
            {
              message: {
                content:
                  "  Both notes focus on turning fleeting captures into durable knowledge.  ",
              },
            },
          ],
        });
      }

      if (
        systemInstruction.content.includes("Generate a concise, descriptive title")
      ) {
        return openAIJsonResponse({
          model: body.model,
          choices: [
            {
              message: {
                content:
                  "  Reliable capture from web, voice, photos, CLI, and AI chats with resilient synthesis. Reliable capture from web, voice, photos, CLI, and AI chats with resilient synthesis.  ",
              },
            },
          ],
        });
      }

      if (systemInstruction.content.includes("Classify the note into JSON")) {
        return openAIJsonResponse({
          model: body.model,
          choices: [
            {
              message: {
                content: JSON.stringify({
                  tags: [" capture ", "knowledge", "Capture", " ai "],
                  domain: " Technology ",
                  mood: " Curious ",
                  actionability: " Idea ",
                }),
              },
            },
          ],
        });
      }

      if (
        systemInstruction.content.includes("Describe the image") ||
        systemInstruction.content.includes("Extract any legible text")
      ) {
        return openAIJsonResponse({
          model: body.model,
          choices: [
            {
              message: {
                content:
                  "  A handwritten sticky note beside a laptop describing a fast capture workflow.  ",
              },
            },
          ],
        });
      }

      throw new Error(`Unhandled OpenAI request: ${JSON.stringify(body)}`);
    };
  },
  expectedSuccessRequestId: "openai_contract_success_req",
} satisfies SharedProviderContractFixture;
