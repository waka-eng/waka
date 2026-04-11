import { createHash, createHmac, randomUUID } from "node:crypto";

import {
  INITIATE_PHOTO_INGESTION_EXISTING_UPLOAD_MEDIA_URL_INVALID_ERROR,
  INITIATE_PHOTO_INGESTION_EXISTING_UPLOAD_MEDIA_URL_MISMATCH_ERROR,
  INITIATE_PHOTO_INGESTION_EXISTING_UPLOAD_OBJECT_KEY_INVALID_ERROR,
  INITIATE_PHOTO_INGESTION_EXISTING_UPLOAD_SCOPE_INVALID_ERROR,
  INITIATE_PHOTO_INGESTION_EXISTING_UPLOAD_STORAGE_KEY_INVALID_ERROR,
  INITIATE_PHOTO_INGESTION_EXISTING_UPLOAD_STORAGE_KEY_MISMATCH_ERROR,
} from "./photo-ingestion-init-route.ts";
import type {
  InitiatePhotoIngestionExistingUploadIdentity,
  InitiatePhotoIngestionResponseBody,
  InitiatePhotoIngestionUploadSetupInput,
  PhotoIngestionUploadSetupGenerator,
} from "./photo-ingestion-init-route.ts";
import {
  PHOTO_UPLOAD_APP_URL_ENVIRONMENT_KEY,
  buildPhotoUploadMediaUrl,
  buildPhotoUploadObjectKey,
  normalizePhotoUploadUserScopeSegment,
  resolvePhotoUploadStorageConfig,
  type PhotoUploadStorageConfig,
} from "./photo-upload-config.ts";

export const PHOTO_UPLOAD_AWS_ACCESS_KEY_ID_ENVIRONMENT_KEY =
  "AWS_ACCESS_KEY_ID";
export const PHOTO_UPLOAD_AWS_SECRET_ACCESS_KEY_ENVIRONMENT_KEY =
  "AWS_SECRET_ACCESS_KEY";
export const PHOTO_UPLOAD_AWS_SESSION_TOKEN_ENVIRONMENT_KEY =
  "AWS_SESSION_TOKEN";
export const PHOTO_UPLOAD_SIGNING_ALGORITHM = "AWS4-HMAC-SHA256";
export const PHOTO_UPLOAD_SIGNING_SERVICE = "s3";
export const PHOTO_UPLOAD_SIGNED_HEADERS = "content-type;host";
export const PHOTO_UPLOAD_UNSIGNED_PAYLOAD = "UNSIGNED-PAYLOAD";

export interface PhotoUploadAwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export interface BuildPhotoUploadSetupOptions {
  credentials?: PhotoUploadAwsCredentials;
  env?: NodeJS.ProcessEnv;
  keyId?: string;
  now?: Date;
  storageConfig?: PhotoUploadStorageConfig;
}

export interface CreatePhotoUploadSetupGeneratorOptions
  extends Omit<BuildPhotoUploadSetupOptions, "keyId" | "now"> {
  keyIdFactory?: () => string;
  now?: () => Date;
}

function readRequiredNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} must be configured as a non-empty string.`);
  }

  return value.trim();
}

function readRequiredTrimmedString(value: unknown, errorMessage: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(errorMessage);
  }

  return value.trim();
}

function readRequiredAbsoluteUrl(value: unknown, errorMessage: string): string {
  const normalizedValue = readRequiredTrimmedString(value, errorMessage);

  try {
    return new URL(normalizedValue).toString();
  } catch {
    throw new TypeError(errorMessage);
  }
}

function normalizeExistingUploadIdentity(
  value: InitiatePhotoIngestionUploadSetupInput["existingUpload"],
): InitiatePhotoIngestionExistingUploadIdentity | undefined {
  if (value === undefined) {
    return undefined;
  }

  const objectKey = readRequiredTrimmedString(
    value.objectKey,
    INITIATE_PHOTO_INGESTION_EXISTING_UPLOAD_OBJECT_KEY_INVALID_ERROR,
  );
  const storageKey = readRequiredTrimmedString(
    value.storageKey,
    INITIATE_PHOTO_INGESTION_EXISTING_UPLOAD_STORAGE_KEY_INVALID_ERROR,
  );

  if (storageKey !== objectKey) {
    throw new TypeError(
      INITIATE_PHOTO_INGESTION_EXISTING_UPLOAD_STORAGE_KEY_MISMATCH_ERROR,
    );
  }

  return {
    mediaUrl: readRequiredAbsoluteUrl(
      value.mediaUrl,
      INITIATE_PHOTO_INGESTION_EXISTING_UPLOAD_MEDIA_URL_INVALID_ERROR,
    ),
    objectKey,
    storageKey,
  };
}

function normalizeUploadRequestInput(
  input: InitiatePhotoIngestionUploadSetupInput,
): InitiatePhotoIngestionUploadSetupInput {
  const existingUpload = normalizeExistingUploadIdentity(input.existingUpload);
  const normalizedContentType = readRequiredNonEmptyString(
    input.contentType,
    "contentType",
  ).toLowerCase();

  if (!/^image\/[a-z0-9.+-]+$/u.test(normalizedContentType)) {
    throw new Error(`contentType "${input.contentType}" must be a valid image MIME type.`);
  }

  const normalizedFileName = readRequiredNonEmptyString(input.fileName, "fileName");
  const normalizedUserId = readRequiredNonEmptyString(input.userId, "userId");

  if (!Number.isInteger(input.sizeBytes) || input.sizeBytes <= 0) {
    throw new Error("sizeBytes must be a positive integer.");
  }

  return {
    contentType: normalizedContentType,
    ...(existingUpload === undefined ? {} : { existingUpload }),
    fileName: normalizedFileName,
    sizeBytes: input.sizeBytes,
    userId: normalizedUserId,
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

function resolvePhotoUploadObjectKey(
  input: InitiatePhotoIngestionUploadSetupInput,
  storageConfig: PhotoUploadStorageConfig,
  env: NodeJS.ProcessEnv,
  now: Date,
  keyId: string | undefined,
): string {
  if (input.existingUpload === undefined) {
    return buildPhotoUploadObjectKey({
      contentType: input.contentType,
      fileName: input.fileName,
      keyId,
      now,
      userId: input.userId,
    });
  }

  const expectedPrefix = [
    "users",
    normalizePhotoUploadUserScopeSegment(input.userId),
    "photos",
    "",
  ].join("/");

  if (!input.existingUpload.objectKey.startsWith(expectedPrefix)) {
    throw new TypeError(INITIATE_PHOTO_INGESTION_EXISTING_UPLOAD_SCOPE_INVALID_ERROR);
  }

  const expectedMediaUrl = buildPhotoUploadMediaUrl(input.existingUpload.objectKey, {
    ...env,
    [PHOTO_UPLOAD_APP_URL_ENVIRONMENT_KEY]: storageConfig.appUrl,
  });

  if (input.existingUpload.mediaUrl !== expectedMediaUrl) {
    throw new TypeError(
      INITIATE_PHOTO_INGESTION_EXISTING_UPLOAD_MEDIA_URL_MISMATCH_ERROR,
    );
  }

  return input.existingUpload.objectKey;
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

function buildCanonicalQueryString(
  query: Record<string, string>,
): string {
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
    .map(
      ([key, value]) => `${encodeRfc3986(key)}=${encodeRfc3986(value)}`,
    )
    .join("&");
}

function buildSigningKey(
  credentials: PhotoUploadAwsCredentials,
  dateStamp: string,
  region: string,
): Buffer {
  const dateKey = hmacSha256(
    `AWS4${credentials.secretAccessKey}`,
    dateStamp,
  );
  const regionKey = hmacSha256(dateKey, region);
  const serviceKey = hmacSha256(regionKey, PHOTO_UPLOAD_SIGNING_SERVICE);

  return hmacSha256(serviceKey, "aws4_request");
}

function buildPresignedUploadUrl(input: {
  contentType: string;
  credentials: PhotoUploadAwsCredentials;
  objectKey: string;
  now: Date;
  storageConfig: PhotoUploadStorageConfig;
}): string {
  const { amzDate, dateStamp } = formatAmzDate(input.now);
  const scope = [
    dateStamp,
    input.storageConfig.region,
    PHOTO_UPLOAD_SIGNING_SERVICE,
    "aws4_request",
  ].join("/");
  const host =
    `${input.storageConfig.bucketName}.s3.${input.storageConfig.region}.amazonaws.com`;
  const canonicalUri = `/${encodeObjectKeyPath(input.objectKey)}`;
  const query: Record<string, string> = {
    "X-Amz-Algorithm": PHOTO_UPLOAD_SIGNING_ALGORITHM,
    "X-Amz-Credential": `${input.credentials.accessKeyId}/${scope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(input.storageConfig.signing.expiresInSeconds),
    "X-Amz-SignedHeaders": PHOTO_UPLOAD_SIGNED_HEADERS,
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
    PHOTO_UPLOAD_SIGNED_HEADERS,
    PHOTO_UPLOAD_UNSIGNED_PAYLOAD,
  ].join("\n");
  const stringToSign = [
    PHOTO_UPLOAD_SIGNING_ALGORITHM,
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

export function resolvePhotoUploadAwsCredentials(
  env: NodeJS.ProcessEnv = process.env,
): PhotoUploadAwsCredentials {
  const accessKeyId = readRequiredNonEmptyString(
    env[PHOTO_UPLOAD_AWS_ACCESS_KEY_ID_ENVIRONMENT_KEY],
    PHOTO_UPLOAD_AWS_ACCESS_KEY_ID_ENVIRONMENT_KEY,
  );
  const secretAccessKey = readRequiredNonEmptyString(
    env[PHOTO_UPLOAD_AWS_SECRET_ACCESS_KEY_ENVIRONMENT_KEY],
    PHOTO_UPLOAD_AWS_SECRET_ACCESS_KEY_ENVIRONMENT_KEY,
  );
  const sessionToken =
    typeof env[PHOTO_UPLOAD_AWS_SESSION_TOKEN_ENVIRONMENT_KEY] === "string" &&
    env[PHOTO_UPLOAD_AWS_SESSION_TOKEN_ENVIRONMENT_KEY]!.trim().length > 0
      ? env[PHOTO_UPLOAD_AWS_SESSION_TOKEN_ENVIRONMENT_KEY]!.trim()
      : undefined;

  return {
    accessKeyId,
    secretAccessKey,
    ...(sessionToken === undefined ? {} : { sessionToken }),
  };
}

export function buildPhotoUploadSetup(
  input: InitiatePhotoIngestionUploadSetupInput,
  options: BuildPhotoUploadSetupOptions = {},
): InitiatePhotoIngestionResponseBody {
  const normalizedInput = normalizeUploadRequestInput(input);
  const env = options.env ?? process.env;
  const storageConfig =
    options.storageConfig ?? resolvePhotoUploadStorageConfig(env);
  const credentials =
    options.credentials ?? resolvePhotoUploadAwsCredentials(env);
  const now = normalizeDate(options.now);
  const objectKey = resolvePhotoUploadObjectKey(
    normalizedInput,
    storageConfig,
    env,
    now,
    options.keyId,
  );
  const mediaUrl = buildPhotoUploadMediaUrl(objectKey, {
    ...env,
    [PHOTO_UPLOAD_APP_URL_ENVIRONMENT_KEY]: storageConfig.appUrl,
  });

  return {
    image: {
      contentType: normalizedInput.contentType,
      fileName: normalizedInput.fileName,
      mediaUrl,
      sizeBytes: normalizedInput.sizeBytes,
      storageKey: objectKey,
    },
    mediaUrl,
    objectKey,
    storageKey: objectKey,
    upload: {
      fields: {},
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

export function createPhotoUploadSetupGenerator(
  options: CreatePhotoUploadSetupGeneratorOptions = {},
): PhotoIngestionUploadSetupGenerator {
  return {
    async generateUploadSetup(
      input: InitiatePhotoIngestionUploadSetupInput,
    ): Promise<InitiatePhotoIngestionResponseBody> {
      return buildPhotoUploadSetup(input, {
        credentials: options.credentials,
        env: options.env,
        keyId: (options.keyIdFactory ?? randomUUID)(),
        now: (options.now ?? (() => new Date()))(),
        storageConfig: options.storageConfig,
      });
    },
  };
}
