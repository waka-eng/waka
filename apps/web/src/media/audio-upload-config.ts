import { randomUUID } from "node:crypto";

export const AUDIO_UPLOAD_BUCKET_NAME_ENVIRONMENT_KEY =
  "SST_RESOURCE_MediaBucket_name";
export const AUDIO_UPLOAD_REGION_ENVIRONMENT_KEY = "AWS_REGION";
export const AUDIO_UPLOAD_APP_URL_ENVIRONMENT_KEY = "APP_URL";
export const AUDIO_UPLOAD_OBJECT_KEY_ROOT = "users";
export const AUDIO_UPLOAD_OBJECT_KEY_COLLECTION = "voice-notes";
export const AUDIO_UPLOAD_MEDIA_ROUTE_PREFIX = "/api/media/audio";
export const AUDIO_UPLOAD_SIGNING_METHOD = "PUT";
export const AUDIO_UPLOAD_SIGNING_EXPIRES_IN_SECONDS = 900;
export const AUDIO_UPLOAD_DEFAULT_FILE_STEM = "voice-note";
export const AUDIO_UPLOAD_DEFAULT_APP_URL = "http://localhost:3000";

const AWS_REGION_PATTERN = /^[a-z]{2}(?:-gov)?-[a-z0-9-]+-\d$/iu;
const AUDIO_CONTENT_TYPE_PATTERN = /^audio\/([a-z0-9.+-]+)(?:\s*;.*)?$/iu;

const AUDIO_ALLOWED_EXTENSIONS_BY_CONTENT_TYPE = {
  "audio/aac": ["aac"],
  "audio/flac": ["flac"],
  "audio/mpeg": ["mp3"],
  "audio/mp4": ["m4a"],
  "audio/ogg": ["ogg"],
  "audio/wav": ["wav"],
  "audio/webm": ["webm"],
  "audio/x-m4a": ["m4a"],
  "audio/x-wav": ["wav"],
} as const;

const AUDIO_EXTENSION_BY_SUBTYPE: Record<string, string> = {
  aac: AUDIO_ALLOWED_EXTENSIONS_BY_CONTENT_TYPE["audio/aac"][0],
  flac: AUDIO_ALLOWED_EXTENSIONS_BY_CONTENT_TYPE["audio/flac"][0],
  mpeg: AUDIO_ALLOWED_EXTENSIONS_BY_CONTENT_TYPE["audio/mpeg"][0],
  mp4: AUDIO_ALLOWED_EXTENSIONS_BY_CONTENT_TYPE["audio/mp4"][0],
  ogg: AUDIO_ALLOWED_EXTENSIONS_BY_CONTENT_TYPE["audio/ogg"][0],
  wav: AUDIO_ALLOWED_EXTENSIONS_BY_CONTENT_TYPE["audio/wav"][0],
  webm: AUDIO_ALLOWED_EXTENSIONS_BY_CONTENT_TYPE["audio/webm"][0],
  "x-m4a": AUDIO_ALLOWED_EXTENSIONS_BY_CONTENT_TYPE["audio/x-m4a"][0],
  "x-wav": AUDIO_ALLOWED_EXTENSIONS_BY_CONTENT_TYPE["audio/x-wav"][0],
};
const AUDIO_FILE_EXTENSIONS = new Set(
  Object.values(AUDIO_ALLOWED_EXTENSIONS_BY_CONTENT_TYPE).flat(),
);

export interface AudioUploadSigningOptions {
  expiresInSeconds: number;
  method: typeof AUDIO_UPLOAD_SIGNING_METHOD;
}

export interface AudioUploadStorageConfig {
  appUrl: string;
  bucketName: string;
  region: string;
  signing: AudioUploadSigningOptions;
}

export interface BuildAudioUploadObjectKeyInput {
  contentType: string;
  fileName?: string;
  keyId?: string;
  now?: Date | number;
  userId: string;
}

function readRequiredNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} must be configured as a non-empty string.`);
  }

  return value.trim();
}

function readAwsRegion(env: NodeJS.ProcessEnv): string {
  const region = readRequiredNonEmptyString(
    env[AUDIO_UPLOAD_REGION_ENVIRONMENT_KEY],
    AUDIO_UPLOAD_REGION_ENVIRONMENT_KEY,
  );

  if (!AWS_REGION_PATTERN.test(region)) {
    throw new Error(
      `${AUDIO_UPLOAD_REGION_ENVIRONMENT_KEY} "${region}" is not a valid AWS region.`,
    );
  }

  return region;
}

function readAppUrl(env: NodeJS.ProcessEnv): string {
  const appUrl =
    typeof env[AUDIO_UPLOAD_APP_URL_ENVIRONMENT_KEY] === "string" &&
    env[AUDIO_UPLOAD_APP_URL_ENVIRONMENT_KEY]!.trim().length > 0
      ? env[AUDIO_UPLOAD_APP_URL_ENVIRONMENT_KEY]!.trim()
      : AUDIO_UPLOAD_DEFAULT_APP_URL;

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(appUrl);
  } catch {
    throw new Error(
      `${AUDIO_UPLOAD_APP_URL_ENVIRONMENT_KEY} "${appUrl}" must be a valid absolute URL.`,
    );
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error(
      `${AUDIO_UPLOAD_APP_URL_ENVIRONMENT_KEY} "${appUrl}" must use http or https.`,
    );
  }

  if (
    parsedUrl.pathname !== "/" ||
    parsedUrl.search.length > 0 ||
    parsedUrl.hash.length > 0
  ) {
    throw new Error(
      `${AUDIO_UPLOAD_APP_URL_ENVIRONMENT_KEY} "${appUrl}" must be an origin without a path, query, or hash.`,
    );
  }

  return parsedUrl.origin;
}

export function normalizeAudioUploadContentType(contentType: string): string {
  const normalizedContentType = readRequiredNonEmptyString(
    contentType,
    "contentType",
  ).toLowerCase();
  const match = AUDIO_CONTENT_TYPE_PATTERN.exec(normalizedContentType);

  if (!match) {
    throw new Error(`contentType "${contentType}" must be a valid audio MIME type.`);
  }

  const normalizedBaseContentType = `audio/${match[1]}`;

  if (!(normalizedBaseContentType in AUDIO_ALLOWED_EXTENSIONS_BY_CONTENT_TYPE)) {
    throw new Error(
      `contentType "${contentType}" must be a supported audio MIME type.`,
    );
  }

  return normalizedBaseContentType;
}

function normalizeAudioSubtype(contentType: string): string {
  return normalizeAudioUploadContentType(contentType).slice("audio/".length);
}

function readAudioFileNameExtension(fileName: string | undefined): string | null {
  if (typeof fileName !== "string") {
    return null;
  }

  const trimmedFileName = fileName.trim();

  if (trimmedFileName.length === 0) {
    return null;
  }

  const basename = trimmedFileName
    .replaceAll("\\", "/")
    .split("/")
    .filter((segment) => segment.length > 0)
    .at(-1);
  const extensionMatch = basename?.match(/\.([a-z0-9]{1,10})$/iu);

  if (!extensionMatch) {
    return null;
  }

  const normalizedExtension = extensionMatch[1].toLowerCase();

  if (!AUDIO_FILE_EXTENSIONS.has(normalizedExtension)) {
    throw new Error(
      `fileName "${fileName}" must use a supported audio extension.`,
    );
  }

  return normalizedExtension;
}

export function validateAudioUploadFormat(
  contentType: string,
  fileName?: string,
): void {
  const normalizedContentType = normalizeAudioUploadContentType(contentType);
  const fileExtension = readAudioFileNameExtension(fileName);

  if (fileExtension === null) {
    return;
  }

  const allowedExtensions =
    AUDIO_ALLOWED_EXTENSIONS_BY_CONTENT_TYPE[normalizedContentType];

  if (allowedExtensions.includes(fileExtension)) {
    return;
  }

  throw new Error(
    `fileName "${fileName}" does not match contentType "${contentType}".`,
  );
}

function sanitizeFileNameSegment(fileName: string | undefined): string {
  if (typeof fileName !== "string") {
    return AUDIO_UPLOAD_DEFAULT_FILE_STEM;
  }

  const trimmedFileName = fileName.trim();

  if (trimmedFileName.length === 0) {
    return AUDIO_UPLOAD_DEFAULT_FILE_STEM;
  }

  const basename = trimmedFileName
    .replaceAll("\\", "/")
    .split("/")
    .filter((segment) => segment.length > 0)
    .at(-1);

  if (!basename) {
    return AUDIO_UPLOAD_DEFAULT_FILE_STEM;
  }

  const withoutExtension = basename.replace(/\.[^.]+$/u, "");
  const slug = withoutExtension
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");

  return slug.length > 0 ? slug : AUDIO_UPLOAD_DEFAULT_FILE_STEM;
}

function sanitizeKeyId(keyId: string | undefined): string {
  const rawKeyId = typeof keyId === "string" ? keyId : randomUUID();

  const normalizedKeyId = rawKeyId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");

  return normalizedKeyId.length > 0 ? normalizedKeyId : "upload";
}

function normalizeTimestamp(value: Date | number | undefined): number {
  if (value instanceof Date) {
    const timestamp = value.getTime();

    if (!Number.isFinite(timestamp) || timestamp < 0) {
      throw new Error("now must resolve to a valid non-negative timestamp.");
    }

    return Math.trunc(timestamp);
  }

  if (value === undefined) {
    return Date.now();
  }

  if (!Number.isFinite(value) || value < 0) {
    throw new Error("now must resolve to a valid non-negative timestamp.");
  }

  return Math.trunc(value);
}

export function resolveAudioUploadFileExtension(
  contentType: string,
  fileName?: string,
): string {
  validateAudioUploadFormat(contentType, fileName);
  const normalizedSubtype = normalizeAudioSubtype(contentType);
  const fileExtension = readAudioFileNameExtension(fileName);

  if (fileExtension !== null) {
    return fileExtension;
  }

  return AUDIO_EXTENSION_BY_SUBTYPE[normalizedSubtype] ??
    normalizedSubtype.replace(/^x-/u, "").split("+")[0];
}

export function resolveAudioUploadSigningOptions(): AudioUploadSigningOptions {
  return {
    expiresInSeconds: AUDIO_UPLOAD_SIGNING_EXPIRES_IN_SECONDS,
    method: AUDIO_UPLOAD_SIGNING_METHOD,
  };
}

export function resolveAudioUploadStorageConfig(
  env: NodeJS.ProcessEnv = process.env,
): AudioUploadStorageConfig {
  return {
    appUrl: readAppUrl(env),
    bucketName: readRequiredNonEmptyString(
      env[AUDIO_UPLOAD_BUCKET_NAME_ENVIRONMENT_KEY],
      AUDIO_UPLOAD_BUCKET_NAME_ENVIRONMENT_KEY,
    ),
    region: readAwsRegion(env),
    signing: resolveAudioUploadSigningOptions(),
  };
}

export function buildAudioUploadObjectKey({
  contentType,
  fileName,
  keyId,
  now,
  userId,
}: BuildAudioUploadObjectKeyInput): string {
  const normalizedUserId = readRequiredNonEmptyString(userId, "userId")
    .replaceAll("\\", "-")
    .replaceAll("/", "-");
  const timestamp = normalizeTimestamp(now);
  const sanitizedStem = sanitizeFileNameSegment(fileName);
  const sanitizedKeyId = sanitizeKeyId(keyId);
  const extension = resolveAudioUploadFileExtension(contentType, fileName);

  return [
    AUDIO_UPLOAD_OBJECT_KEY_ROOT,
    normalizedUserId,
    AUDIO_UPLOAD_OBJECT_KEY_COLLECTION,
    `${timestamp}-${sanitizedStem}-${sanitizedKeyId}.${extension}`,
  ].join("/");
}

export function buildAudioUploadMediaUrl(
  objectKey: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const normalizedObjectKey = readRequiredNonEmptyString(objectKey, "objectKey");
  const encodedObjectKeyPath = normalizedObjectKey
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  return new URL(
    `${AUDIO_UPLOAD_MEDIA_ROUTE_PREFIX}/${encodedObjectKeyPath}`,
    readAppUrl(env),
  ).toString();
}
