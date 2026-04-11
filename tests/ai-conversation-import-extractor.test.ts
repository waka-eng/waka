import assert from "node:assert/strict";
import test from "node:test";

import {
  CHATGPT_CONVERSATION_BODY_REQUIRED_ERROR,
  createCanonicalAiConversationImport,
  extractAiConversationImportFromValidatedPayload,
  extractChatGptConversationImport,
  extractClaudeConversationImport,
  extractGeminiConversationImport,
} from "../apps/web/src/import/ai-conversation.ts";

test("createCanonicalAiConversationImport preserves the AI conversation source contract", () => {
  assert.deepEqual(
    createCanonicalAiConversationImport({
      rawContent: "User: Capture this.\nAssistant: It is persisted.",
      sourceMeta: {
        conversationTitle: "Capture reliability",
        provider: "other",
      },
      sourceUrl: "https://example.com/conversations/manual",
    }),
    {
      rawContent: "User: Capture this.\nAssistant: It is persisted.",
      sourceMeta: {
        conversationTitle: "Capture reliability",
        conversationUrl: "https://example.com/conversations/manual",
        provider: "other",
        sourceConversationRef:
          "ai-conversation-ref:v1:other:url=https://example.com/conversations/manual",
      },
      sourceType: "AI_CONVERSATION",
      sourceUrl: "https://example.com/conversations/manual",
    },
  );
});

test("createCanonicalAiConversationImport normalizes source identity and conversation context metadata", () => {
  assert.deepEqual(
    createCanonicalAiConversationImport({
      rawContent: "User: Preserve source metadata.\nAssistant: Normalize it.",
      sourceMeta: {
        assistant_name: "Claude",
        conversation_id: "conversation-123",
        message_count: 12,
        participant_count: 3,
        participant_names: ["Ada", "Claude"],
        participant_roles: ["user", "assistant", "system"],
        project_id: "project-9",
        provider: "other",
        share_id: "share-42",
        source_app: "browser-extension",
        source_id: "source-7",
        thread_id: "thread-88",
        workspace_id: "workspace-5",
        workflowPhase: "normalize",
      },
    }),
    {
      rawContent: "User: Preserve source metadata.\nAssistant: Normalize it.",
      sourceMeta: {
        assistantName: "Claude",
        conversationId: "conversation-123",
        messageCount: 12,
        participantCount: 3,
        participantNames: ["Ada", "Claude", "System"],
        participants: [
          {
            name: "Ada",
            role: "user",
          },
          {
            name: "Claude",
            role: "assistant",
          },
          {
            name: "System",
            role: "system",
          },
        ],
        participantRoles: ["user", "assistant", "system"],
        projectId: "project-9",
        provider: "other",
        shareId: "share-42",
        sourceConversationRef:
          "ai-conversation-ref:v1:other:conversation=conversation-123",
        sourceApp: "browser-extension",
        sourceId: "source-7",
        threadId: "thread-88",
        workspaceId: "workspace-5",
        workflowPhase: "normalize",
      },
      sourceType: "AI_CONVERSATION",
    },
  );
});

test("createCanonicalAiConversationImport translates source-specific participant roles into canonical roles and retains the original source role", () => {
  assert.deepEqual(
    createCanonicalAiConversationImport({
      rawContent: "User: Keep source roles traceable.\nAssistant: Normalize them.",
      sourceMeta: {
        participant_names: ["Analyst", "Gemini"],
        participant_roles: ["human", "model"],
        provider: "gemini",
      },
    }).sourceMeta,
    {
      participantCount: 2,
      participantNames: ["Analyst", "Gemini"],
      participants: [
        {
          name: "Analyst",
          role: "user",
          sourceMetadata: {
            sourceRole: "human",
          },
        },
        {
          name: "Gemini",
          role: "assistant",
          sourceMetadata: {
            sourceRole: "model",
          },
        },
      ],
      participantRoles: ["user", "assistant"],
      provider: "gemini",
    },
  );
});

test("createCanonicalAiConversationImport derives cleaned participant display names from metadata and provider fallbacks", () => {
  assert.deepEqual(
    createCanonicalAiConversationImport({
      rawContent: "User: Keep names readable.\nAssistant: Normalize them.",
      sourceMeta: {
        assistant_name: " ChatGPT ",
        participants: [
          {
            metadata: {
              email: "ada_lovelace@example.com",
            },
            name: " user ",
            role: "user",
          },
          {
            name: " assistant ",
            role: "assistant",
          },
          {
            display_name: "   ",
            role: "system",
          },
          {
            metadata: {
              locale: "en-US",
            },
            name: "   ",
          },
        ],
        provider: "chatgpt",
      },
    }).sourceMeta,
    {
      assistantName: "ChatGPT",
      participantCount: 4,
      participantNames: ["Ada Lovelace", "ChatGPT", "System"],
      participants: [
        {
          name: "Ada Lovelace",
          role: "user",
          sourceMetadata: {
            email: "ada_lovelace@example.com",
          },
        },
        {
          name: "ChatGPT",
          role: "assistant",
        },
        {
          name: "System",
          role: "system",
        },
        {
          sourceMetadata: {
            locale: "en-US",
          },
        },
      ],
      participantRoles: ["user", "assistant", "system"],
      provider: "chatgpt",
    },
  );
});

test("createCanonicalAiConversationImport preserves canonical participant linkage for normalized turns", () => {
  assert.deepEqual(
    createCanonicalAiConversationImport({
      rawContent: "User: Preserve turn linkage.",
      sourceMeta: {
        participants: [
          {
            aliases: ["Ada"],
            identityId: "participant-ada",
            name: "Ada",
            role: "user",
          },
        ],
        provider: "chatgpt",
        turns: [
          {
            participantIdentityId: "participant-ada",
            participantIndex: 0,
            role: "user",
            sourceReference: "messages:0",
            text: "Preserve turn linkage.",
          },
        ],
      },
    }).sourceMeta,
    {
      participantCount: 1,
      participantNames: ["Ada"],
      participants: [
        {
          aliases: ["Ada"],
          identityId: "participant-ada",
          name: "Ada",
          role: "user",
        },
      ],
      participantRoles: ["user"],
      provider: "chatgpt",
      turnCount: 1,
      turns: [
        {
          participantIdentityId: "participant-ada",
          participantIndex: 0,
          role: "user",
          sourceReference: "messages:0",
          text: "Preserve turn linkage.",
        },
      ],
    },
  );
});

test("createCanonicalAiConversationImport normalizes source timestamps and falls back to turn timestamps when source-level time data is missing", () => {
  assert.deepEqual(
    createCanonicalAiConversationImport({
      rawContent: "User: Normalize source timestamps.\nAssistant: Preserve them canonically.",
      sourceMeta: {
        provider: "chatgpt",
        published_at: "2026-04",
        turns: [
          {
            create_time: 1712793600,
            role: "user",
            text: "Normalize source timestamps.",
          },
          {
            captured_at: "2024-04-11 01:00:00",
            role: "assistant",
            text: "Preserve them canonically.",
          },
          {
            role: "assistant",
            text: "Leave missing timestamps unset.",
          },
        ],
      },
    }).sourceMeta,
    {
      capturedAt: "2024-04-11T00:00:00.000Z",
      provider: "chatgpt",
      publishedAt: "2026-04-01T00:00:00.000Z",
      turnCount: 3,
      turns: [
        {
          capturedAt: "2024-04-11T00:00:00.000Z",
          role: "user",
          text: "Normalize source timestamps.",
        },
        {
          capturedAt: "2024-04-11T01:00:00.000Z",
          role: "assistant",
          text: "Preserve them canonically.",
        },
        {
          role: "assistant",
          text: "Leave missing timestamps unset.",
        },
      ],
      updatedAt: "2024-04-11T01:00:00.000Z",
    },
  );
});

test("createCanonicalAiConversationImport assembles a self-consistent canonical capture record from normalized participants, turns, and timestamp aliases", () => {
  assert.deepEqual(
    createCanonicalAiConversationImport({
      rawContent:
        "User: Reconcile the canonical capture record.\nAssistant: Keep downstream metadata aligned.",
      sourceMeta: {
        participant_count: 99,
        participants: [
          {
            name: "Ada",
            role: "user",
          },
          {
            name: "ChatGPT",
            role: "assistant",
          },
        ],
        provider: "chatgpt",
        turn_count: 42,
        turns: [
          {
            create_time: 1712793600,
            participant_index: 0,
            role: "user",
            text: "Reconcile the canonical capture record.",
          },
          {
            captured_at: "2024-04-11 01:00:00",
            participant_index: 1,
            role: "assistant",
            text: "Keep downstream metadata aligned.",
          },
        ],
      },
    }).sourceMeta,
    {
      capturedAt: "2024-04-11T00:00:00.000Z",
      participantCount: 2,
      participantNames: ["Ada", "ChatGPT"],
      participantRoles: ["user", "assistant"],
      participants: [
        {
          name: "Ada",
          role: "user",
        },
        {
          name: "ChatGPT",
          role: "assistant",
        },
      ],
      provider: "chatgpt",
      turnCount: 2,
      turns: [
        {
          capturedAt: "2024-04-11T00:00:00.000Z",
          participantIndex: 0,
          role: "user",
          text: "Reconcile the canonical capture record.",
        },
        {
          capturedAt: "2024-04-11T01:00:00.000Z",
          participantIndex: 1,
          role: "assistant",
          text: "Keep downstream metadata aligned.",
        },
      ],
      updatedAt: "2024-04-11T01:00:00.000Z",
    },
  );
});

test("extractClaudeConversationImport converts Claude payload messages into a canonical AI conversation import", () => {
  assert.deepEqual(
    extractClaudeConversationImport({
      conversationTitle: "Reliability pass",
      conversationUrl: "https://claude.ai/share/abc123",
      messages: [
        {
          content: [
            {
              text: "Keep offline queue writes durable.",
              type: "text",
            },
          ],
          sender: "human",
        },
        {
          text: "Persist locally first, then retry sync in the background.",
          sender: "assistant",
        },
      ],
      model: "claude-sonnet-4-5",
      provider: "claude",
    }),
    {
      rawContent:
        "User: Keep offline queue writes durable.\nAssistant: Persist locally first, then retry sync in the background.",
      sourceMeta: {
        conversationTitle: "Reliability pass",
        conversationUrl: "https://claude.ai/share/abc123",
        model: "claude-sonnet-4-5",
        participantCount: 2,
        participantNames: ["User", "Claude"],
        participants: [
          {
            name: "User",
            role: "user",
            sourceMetadata: {
              sourceRole: "human",
            },
          },
          {
            name: "Claude",
            role: "assistant",
          },
        ],
        participantRoles: ["user", "assistant"],
        provider: "claude",
        sourceConversationRef:
          "ai-conversation-ref:v1:claude:url=https://claude.ai/share/abc123",
        turns: [
          {
            participantIndex: 0,
            role: "user",
            sourceReference: "messages:0",
            text: "Keep offline queue writes durable.",
          },
          {
            participantIndex: 1,
            role: "assistant",
            sourceReference: "messages:1",
            text: "Persist locally first, then retry sync in the background.",
          },
        ],
        turnCount: 2,
      },
      sourceType: "AI_CONVERSATION",
      sourceUrl: "https://claude.ai/share/abc123",
    },
  );
});

test("extractChatGptConversationImport pulls text from ChatGPT mapping payloads and infers the model", () => {
  assert.deepEqual(
    extractChatGptConversationImport({
      conversationTitle: "Clustering notes",
      conversationUrl: "https://chatgpt.com/share/cluster-notes",
      mapping: {
        root: {
          children: ["user-turn"],
          parent: null,
        },
        "user-turn": {
          children: ["assistant-turn"],
          message: {
            author: {
              role: "user",
            },
            content: {
              parts: ["How do we connect scattered inspirations?"],
            },
            create_time: 1,
            metadata: {
              model_slug: "gpt-4o",
            },
          },
          parent: "root",
        },
        "assistant-turn": {
          message: {
            author: {
              role: "assistant",
            },
            content: {
              parts: ["Embed each note, then surface the nearest neighbors."],
            },
            create_time: 2,
          },
          parent: "user-turn",
        },
      },
      provider: "chatgpt",
    }),
    {
      rawContent:
        "User: How do we connect scattered inspirations?\nAssistant: Embed each note, then surface the nearest neighbors.",
      sourceMeta: {
        capturedAt: "1970-01-01T00:00:01.000Z",
        conversationTitle: "Clustering notes",
        conversationUrl: "https://chatgpt.com/share/cluster-notes",
        model: "gpt-4o",
        participantCount: 2,
        participantNames: ["User", "ChatGPT"],
        participants: [
          {
            name: "User",
            role: "user",
          },
          {
            name: "ChatGPT",
            role: "assistant",
          },
        ],
        participantRoles: ["user", "assistant"],
        provider: "chatgpt",
        sourceConversationRef:
          "ai-conversation-ref:v1:chatgpt:url=https://chatgpt.com/share/cluster-notes",
        turns: [
          {
            capturedAt: "1970-01-01T00:00:01.000Z",
            participantIndex: 0,
            role: "user",
            sourceReference: "mapping:user-turn",
            text: "How do we connect scattered inspirations?",
          },
          {
            capturedAt: "1970-01-01T00:00:02.000Z",
            participantIndex: 1,
            role: "assistant",
            sourceReference: "mapping:assistant-turn",
            text: "Embed each note, then surface the nearest neighbors.",
          },
        ],
        turnCount: 2,
        updatedAt: "1970-01-01T00:00:02.000Z",
      },
      sourceType: "AI_CONVERSATION",
      sourceUrl: "https://chatgpt.com/share/cluster-notes",
    },
  );
});

test("extractChatGptConversationImport normalizes conversation and turn timestamps into canonical fields", () => {
  const canonicalImport = extractChatGptConversationImport({
    messages: [
      {
        author: {
          role: "user",
        },
        content: {
          parts: ["Keep the first turn timestamp canonical."],
        },
        create_time: 1712793600,
      },
      {
        author: {
          role: "assistant",
        },
        content: {
          parts: ["Use the latest available turn time as the conversation fallback."],
        },
        create_time: 1712797200,
      },
    ],
    provider: "chatgpt",
    published_at: "2026",
    updated_at: "2026-04-10 12:34:56",
  } as Parameters<typeof extractChatGptConversationImport>[0]);

  assert.equal(
    canonicalImport.sourceMeta.capturedAt,
    "2024-04-11T00:00:00.000Z",
  );
  assert.equal(
    canonicalImport.sourceMeta.publishedAt,
    "2026-01-01T00:00:00.000Z",
  );
  assert.equal(
    canonicalImport.sourceMeta.updatedAt,
    "2026-04-10T12:34:56.000Z",
  );
  assert.deepEqual(canonicalImport.sourceMeta.turns, [
    {
      capturedAt: "2024-04-11T00:00:00.000Z",
      participantIndex: 0,
      role: "user",
      sourceReference: "messages:0",
      text: "Keep the first turn timestamp canonical.",
    },
    {
      capturedAt: "2024-04-11T01:00:00.000Z",
      participantIndex: 1,
      role: "assistant",
      sourceReference: "messages:1",
      text: "Use the latest available turn time as the conversation fallback.",
    },
  ]);
});

test("extractChatGptConversationImport orders canonical turns by declared mapping child order while preserving turn text", () => {
  const canonicalImport = extractChatGptConversationImport({
    mapping: {
      "assistant-first": {
        message: {
          author: {
            role: "assistant",
          },
          content: {
            parts: ["Keep this reply second in the canonical transcript."],
          },
        },
        parent: "user-turn",
      },
      root: {
        children: ["user-turn"],
        parent: null,
      },
      "assistant-second": {
        message: {
          author: {
            role: "assistant",
          },
          content: {
            parts: ["Keep this reply first in the canonical transcript."],
          },
        },
        parent: "user-turn",
      },
      "user-turn": {
        children: ["assistant-second", "assistant-first"],
        message: {
          author: {
            role: "user",
          },
          content: {
            parts: ["Use the source graph order when timestamps are absent."],
          },
        },
        parent: "root",
      },
    },
    provider: "chatgpt",
  });

  assert.equal(
    canonicalImport.rawContent,
    "User: Use the source graph order when timestamps are absent.\nAssistant: Keep this reply first in the canonical transcript.\nAssistant: Keep this reply second in the canonical transcript.",
  );
  assert.deepEqual(canonicalImport.sourceMeta.turns, [
    {
      participantIndex: 0,
      role: "user",
      sourceReference: "mapping:user-turn",
      text: "Use the source graph order when timestamps are absent.",
    },
    {
      participantIndex: 1,
      role: "assistant",
      sourceReference: "mapping:assistant-second",
      text: "Keep this reply first in the canonical transcript.",
    },
    {
      participantIndex: 1,
      role: "assistant",
      sourceReference: "mapping:assistant-first",
      text: "Keep this reply second in the canonical transcript.",
    },
  ]);
});

test("extractChatGptConversationImport maps source identity and conversation context metadata into the canonical sourceMeta", () => {
  const canonicalImport = extractChatGptConversationImport({
    assistant_name: "ChatGPT",
    conversationTitle: "Imported context",
    conversationUrl: "https://chatgpt.com/share/imported-context",
    conversation_id: "conversation-123",
    id: "share-abc",
    message_count: 8,
    participant_names: ["User", "ChatGPT"],
    participant_roles: ["user", "assistant"],
    participants: {
      "participant-user": {
        display_name: "User",
        metadata: {
          locale: "en-US",
        },
        participant_role: "user",
      },
      "participant-assistant": {
        id: "assistant-1",
        metadata: {
          modelProvider: "openai",
        },
        model_slug: "gpt-4o",
        name: "ChatGPT",
        role: "assistant",
      },
    },
    provider: "chatgpt",
    source_app: "browser-extension",
    workspace_id: "workspace-9",
    messages: [
      {
        author: {
          role: "user",
        },
        content: {
          parts: ["Normalize the conversation metadata."],
        },
        metadata: {
          model_slug: "gpt-4o",
        },
      },
      {
        author: {
          role: "assistant",
        },
        content: {
          parts: ["Map source ids and participant context into canonical sourceMeta."],
        },
      },
    ],
  } as Parameters<typeof extractChatGptConversationImport>[0]);

  assert.deepEqual(canonicalImport.sourceMeta, {
    assistantName: "ChatGPT",
    conversationId: "conversation-123",
    conversationTitle: "Imported context",
    conversationUrl: "https://chatgpt.com/share/imported-context",
    messageCount: 8,
    model: "gpt-4o",
    participantCount: 2,
    participantNames: ["User", "ChatGPT"],
    participants: [
      {
        name: "User",
        role: "user",
        sourceId: "participant-user",
        sourceMetadata: {
          locale: "en-US",
        },
      },
      {
        name: "ChatGPT",
        role: "assistant",
        sourceId: "assistant-1",
        sourceMetadata: {
          modelProvider: "openai",
          model_slug: "gpt-4o",
        },
      },
    ],
    participantRoles: ["user", "assistant"],
    provider: "chatgpt",
    sourceConversationRef:
      "ai-conversation-ref:v1:chatgpt:conversation=conversation-123",
    sourceApp: "browser-extension",
    sourceId: "share-abc",
    turns: [
      {
        participantIndex: 0,
        role: "user",
        sourceReference: "messages:0",
        text: "Normalize the conversation metadata.",
      },
      {
        participantIndex: 1,
        role: "assistant",
        sourceReference: "messages:1",
        text: "Map source ids and participant context into canonical sourceMeta.",
      },
    ],
    turnCount: 2,
    workspaceId: "workspace-9",
  });
});

test("extractChatGptConversationImport overwrites stale summary counts with the assembled canonical conversation structure", () => {
  const canonicalImport = extractChatGptConversationImport({
    messages: [
      {
        author: {
          role: "user",
        },
        content: {
          parts: ["Recompute the canonical participant and turn counts."],
        },
      },
      {
        author: {
          role: "assistant",
        },
        content: {
          parts: ["Use the normalized transcript structure as the source of truth."],
        },
      },
    ],
    participant_count: 9,
    provider: "chatgpt",
    turn_count: 77,
  } as Parameters<typeof extractChatGptConversationImport>[0]);

  assert.equal(canonicalImport.sourceMeta.participantCount, 2);
  assert.equal(canonicalImport.sourceMeta.turnCount, 2);
});

test("extractGeminiConversationImport flattens Gemini turn payloads into the canonical body format", () => {
  assert.deepEqual(
    extractGeminiConversationImport({
      conversationTitle: "Discovery feed ideas",
      conversationUrl: "https://gemini.google.com/share/discovery-feed",
      modelName: "gemini-2.5-flash",
      provider: "gemini",
      turns: [
        {
          query: {
            text: "What should Waka resurface after save?",
          },
          response: {
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: "Show surprising links to older inspirations.",
                    },
                  ],
                },
              },
            ],
          },
        },
        {
          prompt: {
            parts: [
              {
                text: "How should the feed explain those links?",
              },
            ],
          },
          response: {
            text: "Summarize the connection in one concrete sentence.",
          },
        },
      ],
    }),
    {
      rawContent:
        "User: What should Waka resurface after save?\nAssistant: Show surprising links to older inspirations.\nUser: How should the feed explain those links?\nAssistant: Summarize the connection in one concrete sentence.",
      sourceMeta: {
        conversationTitle: "Discovery feed ideas",
        conversationUrl: "https://gemini.google.com/share/discovery-feed",
        model: "gemini-2.5-flash",
        participantCount: 2,
        participantNames: ["User", "Gemini"],
        participants: [
          {
            name: "User",
            role: "user",
          },
          {
            name: "Gemini",
            role: "assistant",
          },
        ],
        participantRoles: ["user", "assistant"],
        provider: "gemini",
        sourceConversationRef:
          "ai-conversation-ref:v1:gemini:url=https://gemini.google.com/share/discovery-feed",
        turns: [
          {
            participantIndex: 0,
            role: "user",
            sourceReference: "turns:0:query",
            text: "What should Waka resurface after save?",
          },
          {
            participantIndex: 1,
            role: "assistant",
            sourceReference: "turns:0:response",
            text: "Show surprising links to older inspirations.",
          },
          {
            participantIndex: 0,
            role: "user",
            sourceReference: "turns:1:query",
            text: "How should the feed explain those links?",
          },
          {
            participantIndex: 1,
            role: "assistant",
            sourceReference: "turns:1:response",
            text: "Summarize the connection in one concrete sentence.",
          },
        ],
        turnCount: 4,
      },
      sourceType: "AI_CONVERSATION",
      sourceUrl: "https://gemini.google.com/share/discovery-feed",
    },
  );
});

test("extractAiConversationImportFromValidatedPayload dispatches to the provider-specific extractor", () => {
  const canonicalImport = extractAiConversationImportFromValidatedPayload({
    messages: [
      {
        content: [
          {
            text: "Trace each capture before dispatching async work.",
            type: "text",
          },
        ],
        sender: "human",
      },
      {
        text: "That keeps retries observable across import sources.",
        sender: "assistant",
      },
    ],
    provider: "claude",
    title: "Tracing import flow",
  });

  assert.equal(canonicalImport.sourceMeta.provider, "claude");
  assert.equal(canonicalImport.sourceMeta.turnCount, 2);
  assert.match(canonicalImport.rawContent, /^User: Trace each capture/);
});

test("extractChatGptConversationImport rejects payloads without any usable conversation text", () => {
  assert.throws(
    () =>
      extractChatGptConversationImport({
        messages: [
          {
            author: {
              role: "user",
            },
            content: {
              parts: [],
            },
          },
        ],
        provider: "chatgpt",
      }),
    new TypeError(CHATGPT_CONVERSATION_BODY_REQUIRED_ERROR),
  );
});
