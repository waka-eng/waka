import assert from "node:assert/strict";
import test from "node:test";

import { buildAiConversationSummaryPromptContent } from "../apps/web/src/import/ai-conversation-summary.ts";

test("buildAiConversationSummaryPromptContent preserves intents, entities, and decisions while stripping filler turns", () => {
  const summaryPrompt = buildAiConversationSummaryPromptContent({
    rawContent:
      "User: Hi there.\nAssistant: Happy to help.\nUser: We need a Neon + pgvector setup and OpenAI text-embedding-3-small for embeddings.\nAssistant: Keep non-embedding tasks switchable via LLM_PROVIDER and poll every 3 seconds.\nUser: Decision: preserve entities like Prisma, DBSCAN, and Auth.js in the summary.\nAssistant: Next step: update the worker and add tests.\nAssistant: Thanks!",
    sourceMeta: {
      conversationTitle: "Architecture decisions",
      model: "gpt-4.1-mini",
      participantNames: ["Ada", "ChatGPT"],
      provider: "chatgpt",
      turns: [
        {
          participantIndex: 0,
          role: "user",
          text: "Hi there.",
        },
        {
          participantIndex: 1,
          role: "assistant",
          text: "Happy to help.",
        },
        {
          participantIndex: 0,
          role: "user",
          text: "We need a Neon + pgvector setup and OpenAI text-embedding-3-small for embeddings.",
        },
        {
          participantIndex: 1,
          role: "assistant",
          text: "Keep non-embedding tasks switchable via LLM_PROVIDER and poll every 3 seconds.",
        },
        {
          participantIndex: 0,
          role: "user",
          text: "Decision: preserve entities like Prisma, DBSCAN, and Auth.js in the summary.",
        },
        {
          participantIndex: 1,
          role: "assistant",
          text: "Next step: update the worker and add tests.",
        },
        {
          participantIndex: 1,
          role: "assistant",
          text: "Thanks!",
        },
      ],
      turnCount: 7,
    },
  });

  assert.equal(typeof summaryPrompt, "string");
  assert.match(summaryPrompt ?? "", /semantic retrieval and embeddings/i);
  assert.match(summaryPrompt ?? "", /Provider: ChatGPT/);
  assert.match(summaryPrompt ?? "", /Title: Architecture decisions/);
  assert.match(summaryPrompt ?? "", /Participants: Ada, ChatGPT/);
  assert.match(
    summaryPrompt ?? "",
    /Ada: We need a Neon \+ pgvector setup and OpenAI text-embedding-3-small for embeddings\./,
  );
  assert.match(
    summaryPrompt ?? "",
    /ChatGPT: Keep non-embedding tasks switchable via LLM_PROVIDER and poll every 3 seconds\./,
  );
  assert.match(
    summaryPrompt ?? "",
    /Decision: preserve entities like Prisma, DBSCAN, and Auth\.js in the summary\./,
  );
  assert.match(summaryPrompt ?? "", /Next step: update the worker and add tests\./);
  assert.doesNotMatch(summaryPrompt ?? "", /Hi there\./);
  assert.doesNotMatch(summaryPrompt ?? "", /Happy to help\./);
  assert.doesNotMatch(summaryPrompt ?? "", /^.*Thanks!.*$/m);
});

test("buildAiConversationSummaryPromptContent falls back to a transcript excerpt when canonical turns are unavailable", () => {
  const summaryPrompt = buildAiConversationSummaryPromptContent({
    rawContent:
      "User: Compare pgvector against keyword search for connection discovery.\nAssistant: Favor pgvector because we need semantic recall across long AI conversations.",
    sourceMeta: {
      provider: "claude",
    },
  });

  assert.equal(typeof summaryPrompt, "string");
  assert.match(summaryPrompt ?? "", /Provider: Claude/);
  assert.match(summaryPrompt ?? "", /Transcript excerpt:/);
  assert.match(
    summaryPrompt ?? "",
    /Compare pgvector against keyword search for connection discovery\./,
  );
});
