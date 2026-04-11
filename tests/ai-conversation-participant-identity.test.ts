import assert from "node:assert/strict";
import test from "node:test";

import {
  createHistoricalAiConversationParticipantIdentityResolver,
  resolveAiConversationParticipantIdentities,
} from "../apps/web/src/import/ai-conversation-participant-identity.ts";
import type { CanonicalAiConversationSourceMeta } from "../apps/web/src/import/ai-conversation.ts";

test("resolveAiConversationParticipantIdentities prefers source identifier matches over alias-only matches", () => {
  const resolvedSourceMeta = resolveAiConversationParticipantIdentities({
    generateIdentityId: () => "participant-new",
    historicalSourceMetas: [
      {
        participants: [
          {
            aliases: ["OpenAI Assistant"],
            identityId: "participant-source",
            name: "ChatGPT",
            role: "assistant",
            sourceId: "assistant-1",
          },
          {
            aliases: ["OpenAI Assistant"],
            identityId: "participant-alias",
            name: "OpenAI Assistant",
            role: "assistant",
          },
        ],
        provider: "chatgpt",
      },
    ],
    sourceMeta: {
      participants: [
        {
          name: "OpenAI Assistant",
          role: "assistant",
          sourceId: "assistant-1",
        },
      ],
      provider: "chatgpt",
    },
  });

  assert.equal(
    resolvedSourceMeta.participants?.[0]?.identityId,
    "participant-source",
  );
});

test("resolveAiConversationParticipantIdentities reuses a unique alias match when source ids are absent", () => {
  const resolvedSourceMeta = resolveAiConversationParticipantIdentities({
    generateIdentityId: () => "participant-new",
    historicalSourceMetas: [
      {
        participants: [
          {
            aliases: ["Founder"],
            identityId: "participant-founder",
            name: "Founder",
            role: "user",
            sourceMetadata: {
              email: "founder@waka.app",
            },
          },
        ],
        provider: "chatgpt",
      },
    ],
    sourceMeta: {
      participants: [
        {
          name: "Founder",
          role: "user",
          sourceMetadata: {
            email: "founder@waka.app",
          },
        },
      ],
      provider: "claude",
    },
  });

  assert.deepEqual(resolvedSourceMeta.participants, [
    {
      aliases: ["founder@waka.app", "Founder"],
      identityId: "participant-founder",
      name: "Founder",
      role: "user",
      sourceMetadata: {
        email: "founder@waka.app",
      },
    },
  ]);
});

test("resolveAiConversationParticipantIdentities reuses stronger historical display names over generic current labels", () => {
  const resolvedSourceMeta = resolveAiConversationParticipantIdentities({
    generateIdentityId: () => "participant-new",
    historicalSourceMetas: [
      {
        participants: [
          {
            identityId: "participant-ada",
            name: "Ada Lovelace",
            role: "user",
            sourceMetadata: {
              email: "ada_lovelace@example.com",
            },
          },
        ],
        provider: "chatgpt",
      },
    ],
    sourceMeta: {
      participants: [
        {
          name: "User",
          role: "user",
          sourceMetadata: {
            email: "ada_lovelace@example.com",
          },
        },
      ],
      provider: "claude",
    },
  });

  assert.deepEqual(resolvedSourceMeta.participantNames, ["Ada Lovelace"]);
  assert.deepEqual(resolvedSourceMeta.participants, [
    {
      aliases: ["ada_lovelace@example.com", "Ada Lovelace", "User"],
      identityId: "participant-ada",
      name: "Ada Lovelace",
      role: "user",
      sourceMetadata: {
        email: "ada_lovelace@example.com",
      },
    },
  ]);
});

test("resolveAiConversationParticipantIdentities creates a new identity when alias matches are ambiguous", () => {
  const resolvedSourceMeta = resolveAiConversationParticipantIdentities({
    generateIdentityId: () => "participant-new",
    historicalSourceMetas: [
      {
        participants: [
          {
            aliases: ["Research Bot"],
            identityId: "participant-1",
            name: "Research Bot",
            role: "assistant",
          },
          {
            aliases: ["Research Bot"],
            identityId: "participant-2",
            name: "Research Bot",
            role: "assistant",
          },
        ],
        provider: "chatgpt",
      },
    ],
    sourceMeta: {
      participants: [
        {
          name: "Research Bot",
          role: "assistant",
        },
      ],
      provider: "gemini",
    },
  });

  assert.equal(
    resolvedSourceMeta.participants?.[0]?.identityId,
    "participant-new",
  );
});

test("resolveAiConversationParticipantIdentities replaces placeholder participantNames with canonical display names", () => {
  const resolvedSourceMeta = resolveAiConversationParticipantIdentities({
    sourceMeta: {
      assistantName: " ChatGPT ",
      participantNames: [" assistant ", "   "],
      participantRoles: ["assistant"],
      provider: "chatgpt",
    },
  });

  assert.deepEqual(resolvedSourceMeta.participantNames, ["ChatGPT"]);
  assert.deepEqual(resolvedSourceMeta.participants, [
    {
      aliases: ["assistant"],
      identityId: resolvedSourceMeta.participants?.[0]?.identityId,
      name: "ChatGPT",
      role: "assistant",
    },
    {
      identityId: resolvedSourceMeta.participants?.[1]?.identityId,
    },
  ]);
});

test("resolveAiConversationParticipantIdentities links normalized turns to resolved participant identities", () => {
  let nextGeneratedIdentityId = 1;
  const resolvedSourceMeta = resolveAiConversationParticipantIdentities({
    generateIdentityId: () => `participant-generated-${nextGeneratedIdentityId++}`,
    historicalSourceMetas: [
      {
        participants: [
          {
            identityId: "participant-history-user",
            name: "Ada Lovelace",
            role: "user",
            sourceMetadata: {
              email: "ada@example.com",
            },
          },
        ],
        provider: "chatgpt",
      },
    ],
    sourceMeta: {
      participants: [
        {
          name: "User",
          role: "user",
          sourceMetadata: {
            email: "ada@example.com",
          },
        },
        {
          name: "ChatGPT",
          role: "assistant",
        },
      ],
      provider: "chatgpt",
      turns: [
        {
          capturedAt: "2024-04-11T00:00:00.000Z",
          participantIndex: 0,
          role: "user",
          sourceReference: "messages:0",
          text: "Connect this note to prior context.",
        },
        {
          capturedAt: "2024-04-11T00:00:05.000Z",
          participantIndex: 1,
          role: "assistant",
          sourceReference: "messages:1",
          text: "I'll surface the strongest semantic neighbors.",
        },
      ],
    },
  });

  assert.deepEqual(resolvedSourceMeta.turns, [
    {
      capturedAt: "2024-04-11T00:00:00.000Z",
      participantIdentityId: "participant-history-user",
      participantIndex: 0,
      role: "user",
      sourceReference: "messages:0",
      text: "Connect this note to prior context.",
    },
    {
      capturedAt: "2024-04-11T00:00:05.000Z",
      participantIdentityId: "participant-generated-1",
      participantIndex: 1,
      role: "assistant",
      sourceReference: "messages:1",
      text: "I'll surface the strongest semantic neighbors.",
    },
  ]);
});

test("createHistoricalAiConversationParticipantIdentityResolver loads history before resolving participants", async () => {
  const loadedUserIds: string[] = [];
  const resolver = createHistoricalAiConversationParticipantIdentityResolver(
    {
      async loadHistoricalSourceMetas(userId) {
        loadedUserIds.push(userId);

        return [
          {
            participants: [
              {
                identityId: "participant-history",
                name: "Ada",
                role: "user",
              },
            ],
            provider: "chatgpt",
          },
        ] satisfies CanonicalAiConversationSourceMeta[];
      },
    },
    {
      generateIdentityId: () => "participant-new",
    },
  );

  const resolvedSourceMeta = await resolver.resolve({
    sourceMeta: {
      participants: [
        {
          name: "Ada",
          role: "user",
        },
      ],
      provider: "claude",
    },
    userId: "user-identity",
  });

  assert.deepEqual(loadedUserIds, ["user-identity"]);
  assert.equal(
    resolvedSourceMeta.participants?.[0]?.identityId,
    "participant-history",
  );
});
