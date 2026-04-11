import { resolveLLMRuntimeConfig } from "../packages/shared/llm/runtime.ts";
import {
  INSPIRATION_PROCESSOR_ALLOWED_RUNTIME_MS_ENVIRONMENT_KEY,
  JOBS_DEAD_LETTER_QUEUE_URL_ENVIRONMENT_KEY,
} from "../packages/shared/types.ts";

export const JOBS_QUEUE_RESOURCE_NAME = "JobsQueue";
export const JOBS_DEAD_LETTER_QUEUE_RESOURCE_NAME = "JobsDeadLetterQueue";
export const JOBS_QUEUE_VISIBILITY_TIMEOUT = "5 minutes";
export const JOBS_QUEUE_MESSAGE_RETENTION = "14 days";
export const JOBS_DEAD_LETTER_QUEUE_MESSAGE_RETENTION =
  JOBS_QUEUE_MESSAGE_RETENTION;
export const JOBS_QUEUE_REDRIVE_RETRY_LIMIT = 3;
export const INSPIRATION_PROCESSOR_QUEUE_ACCESS_ACTIONS = [
  "sqs:DeleteMessage",
  "sqs:GetQueueAttributes",
  "sqs:ReceiveMessage",
] as const;
export const INSPIRATION_PROCESSOR_DEAD_LETTER_QUEUE_ACCESS_ACTIONS = [
  "sqs:SendMessage",
] as const;
export const INSPIRATION_PROCESSOR_FUNCTION_NAME = "InspirationProcessor";
export const INSPIRATION_PROCESSOR_HANDLER_PACKAGE = "apps/web";
export const INSPIRATION_PROCESSOR_HANDLER_ENTRYPOINT =
  "src/jobs/inspiration-queue-subscriber.handler";
export const INSPIRATION_PROCESSOR_HANDLER =
  `${INSPIRATION_PROCESSOR_HANDLER_PACKAGE}/${INSPIRATION_PROCESSOR_HANDLER_ENTRYPOINT}`;
export const INSPIRATION_PROCESSOR_EXECUTION_ROLE_NAME =
  "InspirationProcessorExecutionRole";
export const INSPIRATION_PROCESSOR_RUNTIME = "nodejs20.x";
export const INSPIRATION_PROCESSOR_MEMORY = "2048 MB";
export const INSPIRATION_PROCESSOR_TIMEOUT = "1 minute";
export const INSPIRATION_PROCESSOR_ALLOWED_RUNTIME_MS = 55_000;
export const INSPIRATION_PROCESSOR_RESERVED_CONCURRENCY = 10;
export const INSPIRATION_PROCESSOR_EVENT_SOURCE_BATCH_SIZE = 1;
export const INSPIRATION_PROCESSOR_EVENT_SOURCE_BATCH_WINDOW = "0 seconds";
export const INSPIRATION_PROCESSOR_EVENT_SOURCE_MAX_CONCURRENCY =
  INSPIRATION_PROCESSOR_RESERVED_CONCURRENCY;
export const INSPIRATION_PROCESSOR_EVENT_SOURCE_FUNCTION_RESPONSE_TYPES = [
  "ReportBatchItemFailures",
] as const;
export const JOBS_SUBSCRIBER_DATABASE_URL_SECRET_RESOURCE_NAME =
  "JobsSubscriberDatabaseUrl";
export const JOBS_SUBSCRIBER_OPENAI_API_KEY_SECRET_RESOURCE_NAME =
  "JobsSubscriberOpenAiApiKey";
export const JOBS_SUBSCRIBER_GEMINI_API_KEY_SECRET_RESOURCE_NAME =
  "JobsSubscriberGeminiApiKey";

export interface JobsSubscriberSecretReference<TValue = unknown> {
  value: TValue;
}

export interface JobsSubscriberSecrets<
  TSecret extends JobsSubscriberSecretReference = JobsSubscriberSecretReference,
> {
  databaseUrl: TSecret;
  openAiApiKey: TSecret;
  geminiApiKey?: TSecret;
}

export interface JobsStackInput {
  appUrl: string;
  region: string;
  llmProvider?: string;
}

function readRequiredLambdaSecretReference<TValue>(
  secret: JobsSubscriberSecretReference<TValue> | undefined,
  field: string,
): TValue {
  if (!secret) {
    throw new Error(
      `${field} secret reference is required to configure the jobs subscriber`,
    );
  }

  return secret.value;
}

function readRequiredQueueBinding(
  value: string | undefined,
  field: string,
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(
      `${field} queue binding is required to configure the jobs subscriber`,
    );
  }

  return value.trim();
}

export function resolveJobsSubscriberEnvironment<
  TSecret extends JobsSubscriberSecretReference,
>(
  appUrl: string,
  region: string,
  llmProviderInput: string | undefined,
  secrets: JobsSubscriberSecrets<TSecret>,
  jobsDeadLetterQueueUrl: string,
) {
  const llmProvider = resolveLLMRuntimeConfig({
    LLM_PROVIDER: llmProviderInput,
  }).nonEmbeddingProvider;

  return {
    APP_URL: appUrl,
    AWS_REGION: region,
    DATABASE_URL: readRequiredLambdaSecretReference(
      secrets.databaseUrl,
      "DATABASE_URL",
    ),
    [INSPIRATION_PROCESSOR_ALLOWED_RUNTIME_MS_ENVIRONMENT_KEY]: String(
      INSPIRATION_PROCESSOR_ALLOWED_RUNTIME_MS,
    ),
    [JOBS_DEAD_LETTER_QUEUE_URL_ENVIRONMENT_KEY]: readRequiredQueueBinding(
      jobsDeadLetterQueueUrl,
      JOBS_DEAD_LETTER_QUEUE_URL_ENVIRONMENT_KEY,
    ),
    LLM_PROVIDER: llmProvider,
    OPENAI_API_KEY: readRequiredLambdaSecretReference(
      secrets.openAiApiKey,
      "OPENAI_API_KEY",
    ),
    ...(llmProvider === "gemini"
      ? {
          GEMINI_API_KEY: readRequiredLambdaSecretReference(
            secrets.geminiApiKey,
            "GEMINI_API_KEY",
          ),
        }
      : {}),
  };
}

export function createJobsSubscriberSecrets(
  llmProviderInput?: string,
): JobsSubscriberSecrets<sst.Secret> {
  const llmProvider = resolveLLMRuntimeConfig({
    LLM_PROVIDER: llmProviderInput,
  }).nonEmbeddingProvider;

  return {
    databaseUrl: new sst.Secret(
      JOBS_SUBSCRIBER_DATABASE_URL_SECRET_RESOURCE_NAME,
    ),
    openAiApiKey: new sst.Secret(
      JOBS_SUBSCRIBER_OPENAI_API_KEY_SECRET_RESOURCE_NAME,
    ),
    ...(llmProvider === "gemini"
      ? {
          geminiApiKey: new sst.Secret(
            JOBS_SUBSCRIBER_GEMINI_API_KEY_SECRET_RESOURCE_NAME,
          ),
        }
      : {}),
  };
}

export function resolveJobsSubscriberSecretReferences<
  TSecret extends JobsSubscriberSecretReference,
>(secrets: JobsSubscriberSecrets<TSecret>): TSecret[] {
  return [
    secrets.databaseUrl,
    secrets.openAiApiKey,
    ...(secrets.geminiApiKey ? [secrets.geminiApiKey] : []),
  ];
}

export function resolveInspirationProcessorQueuePermissions<TQueueArn>(
  queueArn: TQueueArn,
  deadLetterQueueArn: TQueueArn,
) {
  return [
    {
      actions: [...INSPIRATION_PROCESSOR_QUEUE_ACCESS_ACTIONS],
      resources: [queueArn],
    },
    {
      actions: [...INSPIRATION_PROCESSOR_DEAD_LETTER_QUEUE_ACCESS_ACTIONS],
      resources: [deadLetterQueueArn],
    },
  ];
}

export function resolveInspirationProcessorExecutionRole<TQueueArn>(
  queueArn: TQueueArn,
  deadLetterQueueArn: TQueueArn,
) {
  return {
    name: INSPIRATION_PROCESSOR_EXECUTION_ROLE_NAME,
    permissions: resolveInspirationProcessorQueuePermissions(
      queueArn,
      deadLetterQueueArn,
    ),
  };
}

export function resolveJobsQueueDeadLetterConfiguration<TQueueArn>(
  deadLetterQueueArn: TQueueArn,
) {
  return {
    queue: deadLetterQueueArn,
    retry: JOBS_QUEUE_REDRIVE_RETRY_LIMIT,
  };
}

export function resolveInspirationProcessorEventSourceMapping() {
  return {
    batch: {
      size: INSPIRATION_PROCESSOR_EVENT_SOURCE_BATCH_SIZE,
      window: INSPIRATION_PROCESSOR_EVENT_SOURCE_BATCH_WINDOW,
    },
    transform: {
      eventSourceMapping: {
        functionResponseTypes: [
          ...INSPIRATION_PROCESSOR_EVENT_SOURCE_FUNCTION_RESPONSE_TYPES,
        ],
        scalingConfig: {
          maximumConcurrency:
            INSPIRATION_PROCESSOR_EVENT_SOURCE_MAX_CONCURRENCY,
        },
      },
    },
  };
}

export function createJobsStack({
  appUrl,
  region,
  llmProvider,
}: JobsStackInput) {
  const jobsSubscriberSecrets = createJobsSubscriberSecrets(llmProvider);
  const jobsDeadLetterQueue = new sst.aws.Queue(
    JOBS_DEAD_LETTER_QUEUE_RESOURCE_NAME,
    {
      // Preserve failed jobs long enough for investigation and manual replay.
      retention: JOBS_DEAD_LETTER_QUEUE_MESSAGE_RETENTION,
    },
  );
  const jobsQueue = new sst.aws.Queue(JOBS_QUEUE_RESOURCE_NAME, {
    // Route poison messages to a DLQ after a bounded number of receive attempts.
    dlq: resolveJobsQueueDeadLetterConfiguration(jobsDeadLetterQueue.arn),
    // Async AI enrichment jobs can take longer than a single HTTP request.
    visibilityTimeout: JOBS_QUEUE_VISIBILITY_TIMEOUT,
    // Keep messages durable long enough for retries and downstream recovery.
    retention: JOBS_QUEUE_MESSAGE_RETENTION,
  });
  const inspirationProcessorExecutionRole =
    resolveInspirationProcessorExecutionRole(
      jobsQueue.arn,
      jobsDeadLetterQueue.arn,
    );
  const inspirationProcessor = new sst.aws.Function(
    INSPIRATION_PROCESSOR_FUNCTION_NAME,
    {
      concurrency: {
        reserved: INSPIRATION_PROCESSOR_RESERVED_CONCURRENCY,
      },
      environment: resolveJobsSubscriberEnvironment(
        appUrl,
        region,
        llmProvider,
        jobsSubscriberSecrets,
        jobsDeadLetterQueue.url,
      ),
      handler: INSPIRATION_PROCESSOR_HANDLER,
      link: [
        jobsQueue,
        ...resolveJobsSubscriberSecretReferences(jobsSubscriberSecrets),
      ],
      permissions: inspirationProcessorExecutionRole.permissions,
      memory: INSPIRATION_PROCESSOR_MEMORY,
      runtime: INSPIRATION_PROCESSOR_RUNTIME,
      timeout: INSPIRATION_PROCESSOR_TIMEOUT,
    },
  );

  const inspirationProcessorSubscription = jobsQueue.subscribe(
    inspirationProcessor.arn,
    resolveInspirationProcessorEventSourceMapping(),
  );

  return {
    jobsDeadLetterQueue,
    jobsQueue,
    inspirationProcessor,
    inspirationProcessorSubscription,
  };
}
