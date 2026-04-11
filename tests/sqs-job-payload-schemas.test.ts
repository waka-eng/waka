import assert from "node:assert/strict";
import test from "node:test";

import {
  SQS_JOB_PAYLOAD_SCHEMAS,
  parseSqsJobPayload,
  parseSqsJobPayloadByDiscriminant,
} from "../packages/shared/schemas.ts";
import { SUPPORTED_SQS_JOB_TYPES } from "../packages/shared/types.ts";

test("registered SQS payload schemas cover every supported job type", () => {
  assert.deepEqual(
    Object.keys(SQS_JOB_PAYLOAD_SCHEMAS).sort(),
    [...SUPPORTED_SQS_JOB_TYPES].sort(),
  );
});

test("every supported SQS job payload type validates its expected payload shape", () => {
  assert.deepEqual(
    parseSqsJobPayload("ai_enrichment", {
      inspirationId: "insp_1",
      fieldNames: ["summary", "embedding", "summary"],
    }),
    {
      jobType: "ai_enrichment",
      inspirationId: "insp_1",
      fieldNames: ["summary", "embedding"],
    },
  );
  assert.deepEqual(
    parseSqsJobPayload("url_import", {
      inspirationId: "insp_url",
      sourceUrl: "https://example.com/article",
    }),
    {
      jobType: "url_import",
      inspirationId: "insp_url",
      sourceUrl: "https://example.com/article",
    },
  );
  assert.deepEqual(
    parseSqsJobPayload("voice_transcription", {
      inspirationId: "insp_voice",
      audio: {
        mediaUrl: "https://cdn.example.com/audio.wav",
        storageKey: "users/user-1/voice-notes/audio.wav",
      },
    }),
    {
      jobType: "voice_transcription",
      inspirationId: "insp_voice",
      audio: {
        mediaUrl: "https://cdn.example.com/audio.wav",
        storageKey: "users/user-1/voice-notes/audio.wav",
      },
    },
  );
  assert.deepEqual(
    parseSqsJobPayload("photo_analysis", {
      inspirationId: "insp_photo",
      mediaUrl: "https://cdn.example.com/photo.jpg",
    }),
    {
      jobType: "photo_analysis",
      inspirationId: "insp_photo",
      mediaUrl: "https://cdn.example.com/photo.jpg",
    },
  );
  assert.deepEqual(
    parseSqsJobPayload("ai_conversation_import", {
      inspirationId: "insp_conversation",
      transcript: "The user refined a clustering prompt for Waka.",
    }),
    {
      jobType: "ai_conversation_import",
      inspirationId: "insp_conversation",
      transcript: "The user refined a clustering prompt for Waka.",
    },
  );
  assert.deepEqual(
    parseSqsJobPayload("connection_analysis", {
      inspirationId: "insp_connection",
      userId: "user_1",
      maxConnections: 5,
      similarityThreshold: 0.78,
    }),
    {
      jobType: "connection_analysis",
      inspirationId: "insp_connection",
      userId: "user_1",
      maxConnections: 5,
      similarityThreshold: 0.78,
    },
  );
  assert.deepEqual(
    parseSqsJobPayload("cluster_rebuild", {
      userId: "user_1",
      triggerInspirationId: "insp_cluster",
    }),
    {
      jobType: "cluster_rebuild",
      userId: "user_1",
      triggerInspirationId: "insp_cluster",
    },
  );
  assert.deepEqual(
    parseSqsJobPayload("reflection_reembedding", {
      inspirationId: "insp_reflection",
    }),
    {
      jobType: "reflection_reembedding",
      inspirationId: "insp_reflection",
    },
  );
});

test("discriminated payload parsing resolves the registered schema from jobType", () => {
  assert.deepEqual(
    parseSqsJobPayloadByDiscriminant({
      jobType: "connection_analysis",
      inspirationId: "insp_connection",
      userId: "user_7",
    }),
    {
      jobType: "connection_analysis",
      inspirationId: "insp_connection",
      userId: "user_7",
    },
  );
});

test("registered SQS payload schemas reject invalid payloads with type-specific errors", () => {
  assert.throws(
    () =>
      parseSqsJobPayload("ai_enrichment", {
        inspirationId: "   ",
      }),
    /ai_enrichment SQS job payload inspirationId must be a non-empty string/,
  );
  assert.throws(
    () =>
      parseSqsJobPayload("ai_enrichment", {
        inspirationId: "insp_1",
        fieldNames: ["not-a-field"],
      }),
    /ai_enrichment SQS job payload fieldNames\[0\] must be one of: embedding, title, summary, tags, domain, mood, actionability/,
  );
  assert.throws(
    () =>
      parseSqsJobPayload("url_import", {
        inspirationId: "insp_url",
        sourceUrl: "/relative/path",
      }),
    /url_import SQS job payload sourceUrl must be a valid absolute URL/,
  );
  assert.throws(
    () =>
      parseSqsJobPayload("voice_transcription", {
        inspirationId: "insp_voice",
        audio: {
          mediaUrl: "https://cdn.example.com/audio.wav",
        },
      }),
    /voice_transcription SQS job payload audio.storageKey must be a non-empty string/,
  );
  assert.throws(
    () =>
      parseSqsJobPayload("voice_transcription", {
        inspirationId: "insp_voice",
        audio: {
          storageKey: "users/user-1/voice-notes/audio.wav",
        },
      }),
    /voice_transcription SQS job payload audio.mediaUrl must be a non-empty string/,
  );
  assert.throws(
    () =>
      parseSqsJobPayload("photo_analysis", {
        inspirationId: "insp_photo",
        mediaUrl: "not-a-url",
      }),
    /photo_analysis SQS job payload mediaUrl must be a valid absolute URL/,
  );
  assert.throws(
    () =>
      parseSqsJobPayload("ai_conversation_import", {
        inspirationId: "insp_conversation",
      }),
    /ai_conversation_import SQS job payload must include either shareUrl or transcript/,
  );
  assert.throws(
    () =>
      parseSqsJobPayload("connection_analysis", {
        inspirationId: "insp_connection",
        userId: "user_1",
        maxConnections: 0,
      }),
    /connection_analysis SQS job payload maxConnections must be a positive integer/,
  );
  assert.throws(
    () =>
      parseSqsJobPayload("cluster_rebuild", {
        userId: "",
      }),
    /cluster_rebuild SQS job payload userId must be a non-empty string/,
  );
  assert.throws(
    () =>
      parseSqsJobPayload("reflection_reembedding", {
        jobType: "ai_enrichment",
        inspirationId: "insp_reflection",
      }),
    /reflection_reembedding SQS job payload jobType must be "reflection_reembedding"/,
  );
});
