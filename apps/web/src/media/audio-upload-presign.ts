import { createHash, createHmac, randomUUID } from "node:crypto";

import type {
  AudioIngestionUploadSetupGenerator,
  InitiateAudioIngestionResponseBody,
  InitiateAudioIngestionUploadSetupInput,
} from "./audio-ingestion-init-route.ts";
import {
  AUDIO_UPLOAD_APP_URL_ENVIRONMENT_KEY,
  buildAudioUploadMediaUrl,
  buildAudioUploadObjectKey,
  normalizeAudioUploadContentType,
  resolveAudioUploadStorageConfig,
  validateAudioUploadFormat,
  type AudioUploadStorageConfig,
} from "./audio-upload-config.ts";

export const AUDIO_UPLOAD_AWS_ACCESS_KEY_ID_ENVIRONMENT_KEY =
  "AWS_ACCESS_KEY_ID";
export const AUDIO_UPLOAD_AWS_SECRET_ACCESS_KEY_ENVIRONMENT_KEY =
  "AWS_SECRET_ACCESS_KEY";
export const AUDIO_UPLOAD_AWS_SESSION_TOKEN_ENVIRONMENT_KEY =
  "AWS_SESSION_TOKEN";
export const AUDIO_UPLOAD_SIGNING_ALGORITHM = "AWS4-HMAC-SHA256";
export const AUDIO_UPLOAD_SIGNING_SERVICE = "s3";
export const AUDIO_UPLOAD_SIGNED_HEADERS = "content-type;host";
export const AUDIO_UPLOAD_UNSIGNED_PAYLOAD = "UNSIGNED-PAYLOAD";

export interface AudioUploadAwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export interface BuildAudioUploadSetupOptions {
  credentials?: AudioUploadAwsCredentials;
  env?: NodeJS.ProcessEnv;
  keyId?: string;
  now?: Date;
  storageConfig?: AudioUploadStorageConfig;
}

export interface CreateAudioUploadSetupGeneratorOptions
  extends Omit<BuildAudioUploadSetupOptions, "keyId" | "now"> {
  keyIdFactory?: () => string;
  now?: () => Date;
}

function readRequiredNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} must be configured as a non-empty string.`);
  }

  return value.trim();
}

function normalizeUploadRequestInput(
  input: InitiateAudioIngestionUploadSetupInput,
): InitiateAudioIngestionUploadSetupInput {
  const normalizedContentType = normalizeAudioUploadContentType(
    readRequiredNonEmptyString(input.contentType, "contentType"),
  );
  const normalizedFileName =
    typeof input.fileName === "string" && input.fileName.trim().length > 0
      ? input.fileName.trim()
      : undefined;
  const normalizedUserId = readRequiredNonEmptyString(input.userId, "userId");
  const normalizedVoiceCaptureId = readRequiredNonEmptyString(
    input.voiceCaptureId,
    "voiceCaptureId",
  );

  validateAudioUploadFormat(normalizedContentType, normalizedFileName);

  return {
    contentType: normalizedContentType,
    ...(normalizedFileName === undefined ? {} : { fileName: normalizedFileName }),
    userId: normalizedUserId,
    voiceCaptureId: normalizedVoiceCaptureId,
  };
}

function normalizeDate(value: Date | undefined): Date {
  if (value === undefined) {
    return new Date();
  }

  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error("now must resolve to a valid Date.");
  }

  return value;
}

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/gu,
    (character) =>
      `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function encodeObjectKeyPath(objectKey: string): string {
  return objectKey
    .split("/")
    .map((segment) => encodeRfc3986(segment))
    .join("/");
}

function hashSha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hmacSha256(key: Buffer | string, value: string): Buffer {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

function formatAmzDate(now: Date): {
  amzDate: string;
  dateStamp: string;
} {
  const iso = now.toISOString();
  const dateStamp = iso.slice(0, 10).replaceAll("-", "");
  const amzDate =
    `${dateStamp}T${iso.slice(11, 19).replaceAll(":", "")}Z`;

  return {
    amzDate,
    dateStamp,
  };
}

function buildCanonicalQueryString(query: Record<string, string>): string {
  return Object.entries(query)
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
      const normalizedLeftKey = encodeRfc3986(leftKey);
      const normalizedRightKey = encodeRfc3986(rightKey);

      if (normalizedLeftKey === normalizedRightKey) {
        return encodeRfc3986(leftValue).localeCompare(
          encodeRfc3986(rightValue),
        );
      }

      return normalizedLeftKey.localeCompare(normalizedRightKey);
    })
    .map(([key, value]) => `${encodeRfc3986(key)}=${encodeRfc3986(value)}`)
    .join("&");
}

function buildSigningKey(
  credentials: AudioUploadAwsCredentials,
  dateStamp: string,
  region: string,
): Buffer {
  const dateKey = hmacSha256(
    `AWS4${credentials.secretAccessKey}`,
    dateStamp,
  );
  const regionKey = hmacSha256(dateKey, region);
  const serviceKey = hmacSha256(regionKey, AUDIO_UPLOAD_SIGNING_SERVICE);

  return hmacSha256(serviceKey, "aws4_request");
}

function buildPresignedUploadUrl(input: {
  contentType: string;
  credentials: AudioUploadAwsCredentials;
  objectKey: string;
  now: Date;
  storageConfig: AudioUploadStorageConfig;
}): string {
  const { amzDate, dateStamp } = formatAmzDate(input.now);
  const scope = [
    dateStamp,
    input.storageConfig.region,
    AUDIO_UPLOAD_SIGNING_SERVICE,
    "aws4_request",
  ].join("/");
  const host =
    `${input.storageConfig.bucketName}.s3.${input.storageConfig.region}.amazonaws.com`;
  const canonicalUri = `/${encodeObjectKeyPath(input.objectKey)}`;
  const query: Record<string, string> = {
    "X-Amz-Algorithm": AUDIO_UPLOAD_SIGNING_ALGORITHM,
    "X-Amz-Credential": `${input.credentials.accessKeyId}/${scope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(input.storageConfig.signing.expiresInSeconds),
    "X-Amz-SignedHeaders": AUDIO_UPLOAD_SIGNED_HEADERS,
  };

  if (input.credentials.sessionToken) {
    query["X-Amz-Security-Token"] = input.credentials.sessionToken;
  }

  const canonicalQueryString = buildCanonicalQueryString(query);
  const canonicalHeaders =
    `content-type:${input.contentType}\nhost:${host}\n`;
  const canonicalRequest = [
    input.storageConfig.signing.method,
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    AUDIO_UPLOAD_SIGNED_HEADERS,
    AUDIO_UPLOAD_UNSIGNED_PAYLOAD,
  ].join("\n");
  const stringToSign = [
    AUDIO_UPLOAD_SIGNING_ALGORITHM,
    amzDate,
    scope,
    hashSha256Hex(canonicalRequest),
  ].join("\n");
  const signature = createHmac(
    "sha256",
    buildSigningKey(input.credentials, dateStamp, input.storageConfig.region),
  )
    .update(stringToSign, "utf8")
    .digest("hex");

  return `https://${host}${canonicalUri}?${canonicalQueryString}&X-Amz-Signature=${signature}`;
}

export function resolveAudioUploadAwsCredentials(
  env: NodeJS.ProcessEnv = process.env,
): AudioUploadAwsCredentials {
  const accessKeyId = readRequiredNonEmptyString(
    env[AUDIO_UPLOAD_AWS_ACCESS_KEY_ID_ENVIRONMENT_KEY],
    AUDIO_UPLOAD_AWS_ACCESS_KEY_ID_ENVIRONMENT_KEY,
  );
  const secretAccessKey = readRequiredNonEmptyString(
    env[AUDIO_UPLOAD_AWS_SECRET_ACCESS_KEY_ENVIRONMENT_KEY],
    AUDIO_UPLOAD_AWS_SECRET_ACCESS_KEY_ENVIRONMENT_KEY,
  );
  const sessionToken =
    typeof env[AUDIO_UPLOAD_AWS_SESSION_TOKEN_ENVIRONMENT_KEY] === "string" &&
    env[AUDIO_UPLOAD_AWS_SESSION_TOKEN_ENVIRONMENT_KEY]!.trim().length > 0
      ? env[AUDIO_UPLOAD_AWS_SESSION_TOKEN_ENVIRONMENT_KEY]!.trim()
      : undefined;

  return {
    accessKeyId,
    secretAccessKey,
    ...(sessionToken === undefined ? {} : { sessionToken }),
  };
}

export function buildAudioUploadSetup(
  input: InitiateAudioIngestionUploadSetupInput,
  options: BuildAudioUploadSetupOptions = {},
): InitiateAudioIngestionResponseBody {
  const normalizedInput = normalizeUploadRequestInput(input);
  const env = options.env ?? process.env;
  const storageConfig =
    options.storageConfig ?? resolveAudioUploadStorageConfig(env);
  const credentials =
    options.credentials ?? resolveAudioUploadAwsCredentials(env);
  const now = normalizeDate(options.now);
  const objectKey = buildAudioUploadObjectKey({
    contentType: normalizedInput.contentType,
    fileName: normalizedInput.fileName,
    keyId: options.keyId,
    now,
    userId: normalizedInput.userId,
  });

  return {
    mediaUrl: buildAudioUploadMediaUrl(objectKey, {
      ...env,
      [AUDIO_UPLOAD_APP_URL_ENVIRONMENT_KEY]: storageConfig.appUrl,
    }),
    objectKey,
    upload: {
      headers: {
        "content-type": normalizedInput.contentType,
      },
      method: storageConfig.signing.method,
      url: buildPresignedUploadUrl({
        contentType: normalizedInput.contentType,
        credentials,
        objectKey,
        now,
        storageConfig,
      }),
    },
  };
}

export function createAudioUploadSetupGenerator(
  options: CreateAudioUploadSetupGeneratorOptions = {},
): AudioIngestionUploadSetupGenerator {
  return {
    async generateUploadSetup(
      input: InitiateAudioIngestionUploadSetupInput,
    ): Promise<InitiateAudioIngestionResponseBody> {
      return buildAudioUploadSetup(input, {
        credentials: options.credentials,
        env: options.env,
        keyId: (options.keyIdFactory ?? randomUUID)(),
        now: (options.now ?? (() => new Date()))(),
        storageConfig: options.storageConfig,
      });
    },
  };
}
