export const PHOTO_UPLOAD_BUCKET_NAME_ENVIRONMENT_KEY =
  "SST_RESOURCE_MediaBucket_name";
export const PHOTO_UPLOAD_REGION_ENVIRONMENT_KEY = "AWS_REGION";
export const PHOTO_UPLOAD_APP_URL_ENVIRONMENT_KEY = "APP_URL";
export const PHOTO_UPLOAD_OBJECT_KEY_ROOT = "users";
export const PHOTO_UPLOAD_OBJECT_KEY_COLLECTION = "photos";
export const PHOTO_UPLOAD_MEDIA_ROUTE_PREFIX = "/api/media/photos";
export const PHOTO_UPLOAD_SIGNING_METHOD = "PUT";
export const PHOTO_UPLOAD_SIGNING_EXPIRES_IN_SECONDS = 900;
export const PHOTO_UPLOAD_DEFAULT_FILE_STEM = "photo";
export const PHOTO_UPLOAD_DEFAULT_APP_URL = "http://localhost:3000";

const AWS_REGION_PATTERN = /^[a-z]{2}(?:-gov)?-[a-z0-9-]+-\d$/iu;
const IMAGE_CONTENT_TYPE_PATTERN = /^image\/([a-z0-9.+-]+)(?:\s*;.*)?$/iu;

const PHOTO_EXTENSION_BY_SUBTYPE: Record<string, string> = {
  avif: "avif",
  gif: "gif",
  jpeg: "jpg",
  jpg: "jpg",
  png: "png",
  webp: "webp",
  "x-icon": "ico",
};

export interface PhotoUploadSigningOptions {
  expiresInSeconds: number;
  method: typeof PHOTO_UPLOAD_SIGNING_METHOD;
}

export interface PhotoUploadStorageConfig {
  appUrl: string;
  bucketName: string;
  region: string;
  signing: PhotoUploadSigningOptions;
}

export interface BuildPhotoUploadObjectKeyInput {
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
    env[PHOTO_UPLOAD_REGION_ENVIRONMENT_KEY],
    PHOTO_UPLOAD_REGION_ENVIRONMENT_KEY,
  );

  if (!AWS_REGION_PATTERN.test(region)) {
    throw new Error(
      `${PHOTO_UPLOAD_REGION_ENVIRONMENT_KEY} "${region}" is not a valid AWS region.`,
    );
  }

  return region;
}

function readAppUrl(env: NodeJS.ProcessEnv): string {
  const appUrl =
    typeof env[PHOTO_UPLOAD_APP_URL_ENVIRONMENT_KEY] === "string" &&
    env[PHOTO_UPLOAD_APP_URL_ENVIRONMENT_KEY]!.trim().length > 0
      ? env[PHOTO_UPLOAD_APP_URL_ENVIRONMENT_KEY]!.trim()
      : PHOTO_UPLOAD_DEFAULT_APP_URL;

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(appUrl);
  } catch {
    throw new Error(
      `${PHOTO_UPLOAD_APP_URL_ENVIRONMENT_KEY} "${appUrl}" must be a valid absolute URL.`,
    );
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error(
      `${PHOTO_UPLOAD_APP_URL_ENVIRONMENT_KEY} "${appUrl}" must use http or https.`,
    );
  }

  if (
    parsedUrl.pathname !== "/" ||
    parsedUrl.search.length > 0 ||
    parsedUrl.hash.length > 0
  ) {
    throw new Error(
      `${PHOTO_UPLOAD_APP_URL_ENVIRONMENT_KEY} "${appUrl}" must be an origin without a path, query, or hash.`,
    );
  }

  return parsedUrl.origin;
}

function normalizeImageSubtype(contentType: string): string {
  const normalizedContentType = readRequiredNonEmptyString(
    contentType,
    "contentType",
  ).toLowerCase();
  const match = IMAGE_CONTENT_TYPE_PATTERN.exec(normalizedContentType);

  if (!match) {
    throw new Error(`contentType "${contentType}" must be a valid image MIME type.`);
  }

  return match[1];
}

function sanitizeFileNameSegment(fileName: string | undefined): string {
  if (typeof fileName !== "string") {
    return PHOTO_UPLOAD_DEFAULT_FILE_STEM;
  }

  const trimmedFileName = fileName.trim();

  if (trimmedFileName.length === 0) {
    return PHOTO_UPLOAD_DEFAULT_FILE_STEM;
  }

  const basename = trimmedFileName
    .replaceAll("\\", "/")
    .split("/")
    .filter((segment) => segment.length > 0)
    .at(-1);

  if (!basename) {
    return PHOTO_UPLOAD_DEFAULT_FILE_STEM;
  }

  const withoutExtension = basename.replace(/\.[^.]+$/u, "");
  const slug = withoutExtension
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");

  return slug.length > 0 ? slug : PHOTO_UPLOAD_DEFAULT_FILE_STEM;
}

function sanitizeKeyId(keyId: string | undefined): string {
  if (typeof keyId !== "string") {
    return "upload";
  }

  const normalizedKeyId = keyId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");

  return normalizedKeyId.length > 0 ? normalizedKeyId : "upload";
}

export function normalizePhotoUploadUserScopeSegment(userId: string): string {
  return readRequiredNonEmptyString(userId, "userId")
    .replaceAll("\\", "-")
    .replaceAll("/", "-");
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

export function resolvePhotoUploadFileExtension(
  contentType: string,
  fileName?: string,
): string {
  const normalizedSubtype = normalizeImageSubtype(contentType);

  if (typeof fileName === "string") {
    const trimmedFileName = fileName.trim();
    const basename = trimmedFileName
      .replaceAll("\\", "/")
      .split("/")
      .filter((segment) => segment.length > 0)
      .at(-1);
    const extensionMatch = basename?.match(/\.([a-z0-9]{1,10})$/iu);

    if (extensionMatch) {
      return extensionMatch[1].toLowerCase();
    }
  }

  return PHOTO_EXTENSION_BY_SUBTYPE[normalizedSubtype] ??
    normalizedSubtype.replace(/^x-/u, "").split("+")[0];
}

export function resolvePhotoUploadSigningOptions(): PhotoUploadSigningOptions {
  return {
    expiresInSeconds: PHOTO_UPLOAD_SIGNING_EXPIRES_IN_SECONDS,
    method: PHOTO_UPLOAD_SIGNING_METHOD,
  };
}

export function resolvePhotoUploadStorageConfig(
  env: NodeJS.ProcessEnv = process.env,
): PhotoUploadStorageConfig {
  return {
    appUrl: readAppUrl(env),
    bucketName: readRequiredNonEmptyString(
      env[PHOTO_UPLOAD_BUCKET_NAME_ENVIRONMENT_KEY],
      PHOTO_UPLOAD_BUCKET_NAME_ENVIRONMENT_KEY,
    ),
    region: readAwsRegion(env),
    signing: resolvePhotoUploadSigningOptions(),
  };
}

export function buildPhotoUploadObjectKey({
  contentType,
  fileName,
  keyId,
  now,
  userId,
}: BuildPhotoUploadObjectKeyInput): string {
  const normalizedUserId = normalizePhotoUploadUserScopeSegment(userId);
  const timestamp = normalizeTimestamp(now);
  const sanitizedStem = sanitizeFileNameSegment(fileName);
  const sanitizedKeyId = sanitizeKeyId(keyId);
  const extension = resolvePhotoUploadFileExtension(contentType, fileName);

  return [
    PHOTO_UPLOAD_OBJECT_KEY_ROOT,
    normalizedUserId,
    PHOTO_UPLOAD_OBJECT_KEY_COLLECTION,
    `${timestamp}-${sanitizedStem}-${sanitizedKeyId}.${extension}`,
  ].join("/");
}

export function buildPhotoUploadMediaUrl(
  objectKey: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const normalizedObjectKey = readRequiredNonEmptyString(objectKey, "objectKey");
  const encodedObjectKeyPath = normalizedObjectKey
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  return new URL(
    `${PHOTO_UPLOAD_MEDIA_ROUTE_PREFIX}/${encodedObjectKeyPath}`,
    readAppUrl(env),
  ).toString();
}
