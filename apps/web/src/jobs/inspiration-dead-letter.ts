import { createHmac, createHash } from "node:crypto";

import {
  JOBS_DEAD_LETTER_QUEUE_URL_ENVIRONMENT_KEY,
  type SupportedSqsJobPayload,
  type SupportedSqsJobType,
} from "../../../../packages/shared/types.ts";
import { serializeInspirationEnrichmentError } from "./inspiration-embedding-persistence.ts";
import type {
  InspirationQueueJobMetadata,
  InspirationQueueRecord,
  InspirationQueueRecordProcessingRequest,
} from "./inspiration-queue.ts";
import type { InspirationJobFailureRetryability } from "./inspiration-job-failure.ts";

export const INSPIRATION_QUEUE_DEAD_LETTER_TERMINAL_REASON_NON_RETRYABLE =
  "non_retryable";
export const INSPIRATION_QUEUE_DEAD_LETTER_TERMINAL_REASON_MAX_ATTEMPTS_EXHAUSTED =
  "max_attempts_exhausted";
export const SQS_SEND_MESSAGE_ACTION = "SendMessage";
export const SQS_SEND_MESSAGE_API_VERSION = "2012-11-05";

export type InspirationQueueDeadLetterTerminalReason =
  | typeof INSPIRATION_QUEUE_DEAD_LETTER_TERMINAL_REASON_NON_RETRYABLE
  | typeof INSPIRATION_QUEUE_DEAD_LETTER_TERMINAL_REASON_MAX_ATTEMPTS_EXHAUSTED;

export interface InspirationQueueDeadLetterInput {
  attemptCount?: number;
  error: unknown;
  failureKind: "dispatch" | "non-dispatch";
  maxAttemptCount?: number;
  processingRequest?: InspirationQueueRecordProcessingRequest;
  record: InspirationQueueRecord;
  retryability: InspirationJobFailureRetryability;
  terminalReason: InspirationQueueDeadLetterTerminalReason;
}

export interface InspirationQueueDeadLetterProcessingRequestSnapshot {
  body: string;
  jobType?: SupportedSqsJobType;
  metadata: InspirationQueueJobMetadata;
  payload?: SupportedSqsJobPayload;
}

export interface InspirationQueueDeadLetterMessage {
  deadLetteredAt: string;
  failure: {
    attemptCount?: number;
    error: ReturnType<typeof serializeInspirationEnrichmentError>;
    kind: "dispatch" | "non-dispatch";
    maxAttemptCount?: number;
    retryability: InspirationJobFailureRetryability;
    terminalReason: InspirationQueueDeadLetterTerminalReason;
  };
  processingRequest?: InspirationQueueDeadLetterProcessingRequestSnapshot;
  record: InspirationQueueRecord;
  schemaVersion: 1;
}

export interface InspirationQueueDeadLetterPublisher {
  publish(message: InspirationQueueDeadLetterMessage): Promise<void>;
}

export interface AwsRequestSigningCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export interface BuildSignedSqsSendMessageRequestInput {
  credentials: AwsRequestSigningCredentials;
  message: InspirationQueueDeadLetterMessage;
  now: Date;
  queueUrl: string;
  region: string;
}

export interface SignedSqsSendMessageRequest {
  body: string;
  headers: Record<string, string>;
  url: string;
}

export interface CreateEnvironmentInspirationQueueDeadLetterPublisherOptions {
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  now?: () => Date;
}

function createSha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function createHmacBuffer(
  key: Buffer | string,
  value: string,
): Buffer {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

function createHmacHex(key: Buffer | string, value: string): string {
  return createHmac("sha256", key).update(value, "utf8").digest("hex");
}

function normalizeAwsDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function normalizeAwsDateStamp(date: Date): string {
  return normalizeAwsDate(date).slice(0, 8);
}

function normalizeAwsHeaderValue(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function createCanonicalQueryString(url: URL): string {
  return [...url.searchParams.entries()]
    .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
      leftKey === rightKey
        ? leftValue.localeCompare(rightValue)
        : leftKey.localeCompare(rightKey),
    )
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
    )
    .join("&");
}

function createSqsMessageAttributeEntries(
  message: InspirationQueueDeadLetterMessage,
): Array<{ name: string; value: string }> {
  const entries: Array<{ name: string; value: string }> = [
    {
      name: "failureKind",
      value: message.failure.kind,
    },
    {
      name: "retryability",
      value: message.failure.retryability,
    },
    {
      name: "terminalReason",
      value: message.failure.terminalReason,
    },
  ];
  const jobType =
    message.processingRequest?.jobType ??
    message.record.messageAttributes?.jobType?.stringValue;

  if (jobType) {
    entries.push({
      name: "jobType",
      value: jobType,
    });
  }

  return entries;
}

function createSqsSendMessageBody(
  message: InspirationQueueDeadLetterMessage,
): string {
  const params = new URLSearchParams();

  params.set("Action", SQS_SEND_MESSAGE_ACTION);
  params.set("MessageBody", JSON.stringify(message));
  params.set("Version", SQS_SEND_MESSAGE_API_VERSION);

  for (const [index, entry] of createSqsMessageAttributeEntries(message).entries()) {
    const position = String(index + 1);
    params.set(`MessageAttribute.${position}.Name`, entry.name);
    params.set(`MessageAttribute.${position}.Value.DataType`, "String");
    params.set(`MessageAttribute.${position}.Value.StringValue`, entry.value);
  }

  return params.toString();
}

function createAwsSigningKey(
  credentials: AwsRequestSigningCredentials,
  dateStamp: string,
  region: string,
): Buffer {
  const dateKey = createHmacBuffer(
    `AWS4${credentials.secretAccessKey}`,
    dateStamp,
  );
  const regionKey = createHmacBuffer(dateKey, region);
  const serviceKey = createHmacBuffer(regionKey, "sqs");

  return createHmacBuffer(serviceKey, "aws4_request");
}

function resolveAwsSigningHeaders(
  url: URL,
  amzDate: string,
  payload: string,
  sessionToken?: string,
): Record<string, string> {
  return {
    "content-type": "application/x-www-form-urlencoded; charset=utf-8",
    host: url.host,
    ...(sessionToken
      ? {
          "x-amz-security-token": sessionToken,
        }
      : {}),
    "x-amz-date": amzDate,
    "x-amz-content-sha256": createSha256Hex(payload),
  };
}

export function buildSignedSqsSendMessageRequest({
  credentials,
  message,
  now,
  queueUrl,
  region,
}: BuildSignedSqsSendMessageRequestInput): SignedSqsSendMessageRequest {
  const url = new URL(queueUrl);
  const body = createSqsSendMessageBody(message);
  const amzDate = normalizeAwsDate(now);
  const dateStamp = normalizeAwsDateStamp(now);
  const headers = resolveAwsSigningHeaders(
    url,
    amzDate,
    body,
    credentials.sessionToken,
  );
  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames
    .map((headerName) => {
      const headerValue = headers[headerName];

      return `${headerName}:${normalizeAwsHeaderValue(headerValue ?? "")}\n`;
    })
    .join("");
  const signedHeaders = signedHeaderNames.join(";");
  const canonicalRequest = [
    "POST",
    url.pathname || "/",
    createCanonicalQueryString(url),
    canonicalHeaders,
    signedHeaders,
    headers["x-amz-content-sha256"] ?? createSha256Hex(body),
  ].join("\n");
  const credentialScope = `${dateStamp}/${region}/sqs/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    createSha256Hex(canonicalRequest),
  ].join("\n");
  const authorization = [
    "AWS4-HMAC-SHA256",
    `Credential=${credentials.accessKeyId}/${credentialScope},`,
    `SignedHeaders=${signedHeaders},`,
    `Signature=${createHmacHex(createAwsSigningKey(credentials, dateStamp, region), stringToSign)}`,
  ].join(" ");

  return {
    body,
    headers: {
      Authorization: authorization,
      "Content-Type": headers["content-type"] ?? "",
      "X-Amz-Content-Sha256": headers["x-amz-content-sha256"] ?? "",
      "X-Amz-Date": amzDate,
      ...(credentials.sessionToken
        ? {
            "X-Amz-Security-Token": credentials.sessionToken,
          }
        : {}),
    },
    url: url.toString(),
  };
}

function readRequiredEnvironmentValue(
  value: string | undefined,
  label: string,
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be configured for DLQ publishing.`);
  }

  return value.trim();
}

function resolveDeadLetterQueueUrl(env: NodeJS.ProcessEnv): string {
  return readRequiredEnvironmentValue(
    env[JOBS_DEAD_LETTER_QUEUE_URL_ENVIRONMENT_KEY],
    JOBS_DEAD_LETTER_QUEUE_URL_ENVIRONMENT_KEY,
  );
}

function resolveAwsRegion(env: NodeJS.ProcessEnv): string {
  return readRequiredEnvironmentValue(env.AWS_REGION, "AWS_REGION");
}

function resolveAwsRequestSigningCredentials(
  env: NodeJS.ProcessEnv,
): AwsRequestSigningCredentials {
  return {
    accessKeyId: readRequiredEnvironmentValue(
      env.AWS_ACCESS_KEY_ID,
      "AWS_ACCESS_KEY_ID",
    ),
    secretAccessKey: readRequiredEnvironmentValue(
      env.AWS_SECRET_ACCESS_KEY,
      "AWS_SECRET_ACCESS_KEY",
    ),
    ...(env.AWS_SESSION_TOKEN
      ? {
          sessionToken: env.AWS_SESSION_TOKEN.trim(),
        }
      : {}),
  };
}

export function createInspirationQueueDeadLetterMessage(
  input: InspirationQueueDeadLetterInput,
  deadLetteredAt: Date = new Date(),
): InspirationQueueDeadLetterMessage {
  return {
    deadLetteredAt: deadLetteredAt.toISOString(),
    failure: {
      ...(input.attemptCount === undefined
        ? {}
        : {
            attemptCount: input.attemptCount,
          }),
      error: serializeInspirationEnrichmentError(input.error, deadLetteredAt, {
        attemptCount: input.attemptCount,
        maxAttemptCount: input.maxAttemptCount,
      }),
      kind: input.failureKind,
      ...(input.maxAttemptCount === undefined
        ? {}
        : {
            maxAttemptCount: input.maxAttemptCount,
          }),
      retryability: input.retryability,
      terminalReason: input.terminalReason,
    },
    ...(input.processingRequest
      ? {
          processingRequest: {
            body: input.processingRequest.body,
            jobType: input.processingRequest.jobType,
            metadata: input.processingRequest.metadata,
            payload: input.processingRequest.payload,
          },
        }
      : {}),
    record: input.record,
    schemaVersion: 1,
  };
}

export function createEnvironmentInspirationQueueDeadLetterPublisher(
  options: CreateEnvironmentInspirationQueueDeadLetterPublisherOptions = {},
): InspirationQueueDeadLetterPublisher {
  const env = options.env ?? process.env;
  const fetchImplementation = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date());

  return {
    async publish(message) {
      const request = buildSignedSqsSendMessageRequest({
        credentials: resolveAwsRequestSigningCredentials(env),
        message,
        now: now(),
        queueUrl: resolveDeadLetterQueueUrl(env),
        region: resolveAwsRegion(env),
      });
      const response = await fetchImplementation(request.url, {
        body: request.body,
        headers: request.headers,
        method: "POST",
      });

      if (!response.ok) {
        throw new Error(
          `Failed to publish inspiration dead-letter message (${response.status}): ${await response.text()}`,
        );
      }
    },
  };
}
