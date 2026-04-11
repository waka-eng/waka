import assert from "node:assert/strict";
import test from "node:test";

import {
  INSPIRATION_PROCESSOR_ALLOWED_RUNTIME_MS_ENVIRONMENT_KEY,
  JOBS_DEAD_LETTER_QUEUE_URL_ENVIRONMENT_KEY,
} from "../packages/shared/types.ts";
import {
  INSPIRATION_PROCESSOR_ALLOWED_RUNTIME_MS,
  resolveJobsSubscriberEnvironment,
  resolveJobsSubscriberSecretReferences,
} from "../infra/jobs-stack.ts";

test("jobs subscriber environment pins APP_URL, AWS_REGION, and OpenAI credentials", () => {
  const environment = resolveJobsSubscriberEnvironment(
    "https://waka.app",
    "us-east-1",
    undefined,
    {
      databaseUrl: { value: "postgresql://waka.example/db" },
      openAiApiKey: { value: "openai-key" },
    },
    "https://sqs.us-east-1.amazonaws.com/123456789012/JobsDeadLetterQueue",
  );

  assert.deepEqual(environment, {
    APP_URL: "https://waka.app",
    AWS_REGION: "us-east-1",
    DATABASE_URL: "postgresql://waka.example/db",
    [INSPIRATION_PROCESSOR_ALLOWED_RUNTIME_MS_ENVIRONMENT_KEY]: String(
      INSPIRATION_PROCESSOR_ALLOWED_RUNTIME_MS,
    ),
    [JOBS_DEAD_LETTER_QUEUE_URL_ENVIRONMENT_KEY]:
      "https://sqs.us-east-1.amazonaws.com/123456789012/JobsDeadLetterQueue",
    LLM_PROVIDER: "openai",
    OPENAI_API_KEY: "openai-key",
  });
});

test("jobs subscriber environment includes Gemini credentials when enabled", () => {
  const environment = resolveJobsSubscriberEnvironment(
    "https://waka.app",
    "ap-northeast-2",
    " Gemini ",
    {
      databaseUrl: { value: "postgresql://waka.example/db" },
      geminiApiKey: { value: "gemini-key" },
      openAiApiKey: { value: "openai-key" },
    },
    "https://sqs.ap-northeast-2.amazonaws.com/123456789012/JobsDeadLetterQueue",
  );

  assert.deepEqual(environment, {
    APP_URL: "https://waka.app",
    AWS_REGION: "ap-northeast-2",
    DATABASE_URL: "postgresql://waka.example/db",
    GEMINI_API_KEY: "gemini-key",
    [INSPIRATION_PROCESSOR_ALLOWED_RUNTIME_MS_ENVIRONMENT_KEY]: String(
      INSPIRATION_PROCESSOR_ALLOWED_RUNTIME_MS,
    ),
    [JOBS_DEAD_LETTER_QUEUE_URL_ENVIRONMENT_KEY]:
      "https://sqs.ap-northeast-2.amazonaws.com/123456789012/JobsDeadLetterQueue",
    LLM_PROVIDER: "gemini",
    OPENAI_API_KEY: "openai-key",
  });
});

test("jobs subscriber environment rejects missing required credentials", () => {
  assert.throws(
    () =>
      resolveJobsSubscriberEnvironment(
        "https://waka.app",
        "us-east-1",
        undefined,
        {
          openAiApiKey: { value: "openai-key" },
        },
        "https://sqs.us-east-1.amazonaws.com/123456789012/JobsDeadLetterQueue",
      ),
    /DATABASE_URL secret reference is required to configure the jobs subscriber/,
  );

  assert.throws(
    () =>
      resolveJobsSubscriberEnvironment(
        "https://waka.app",
        "us-east-1",
        "gemini",
        {
          databaseUrl: { value: "postgresql://waka.example/db" },
          openAiApiKey: { value: "openai-key" },
        },
        "https://sqs.us-east-1.amazonaws.com/123456789012/JobsDeadLetterQueue",
      ),
    /GEMINI_API_KEY secret reference is required to configure the jobs subscriber/,
  );

  assert.throws(
    () =>
      resolveJobsSubscriberEnvironment(
        "https://waka.app",
        "us-east-1",
        undefined,
        {
          databaseUrl: { value: "postgresql://waka.example/db" },
          openAiApiKey: { value: "openai-key" },
        },
        "   ",
      ),
    /JOBS_DEAD_LETTER_QUEUE_URL queue binding is required to configure the jobs subscriber/,
  );
});

test("jobs subscriber environment rejects unsupported providers", () => {
  assert.throws(
    () =>
      resolveJobsSubscriberEnvironment(
        "https://waka.app",
        "us-east-1",
        "anthropic",
        {
          databaseUrl: { value: "postgresql://waka.example/db" },
          openAiApiKey: { value: "openai-key" },
        },
        "https://sqs.us-east-1.amazonaws.com/123456789012/JobsDeadLetterQueue",
      ),
    /LLM_PROVIDER must be either "openai" or "gemini"/,
  );
});

test("jobs subscriber secret references only include the configured secrets", () => {
  const databaseUrl = { value: "postgresql://waka.example/db" };
  const openAiApiKey = { value: "openai-key" };
  const geminiApiKey = { value: "gemini-key" };

  assert.deepEqual(
    resolveJobsSubscriberSecretReferences({
      databaseUrl,
      openAiApiKey,
    }),
    [databaseUrl, openAiApiKey],
  );

  assert.deepEqual(
    resolveJobsSubscriberSecretReferences({
      databaseUrl,
      geminiApiKey,
      openAiApiKey,
    }),
    [databaseUrl, openAiApiKey, geminiApiKey],
  );
});
