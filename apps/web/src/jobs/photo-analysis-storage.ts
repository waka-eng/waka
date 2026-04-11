import { createHash, createHmac } from "node:crypto";

import {
  PHOTO_UPLOAD_MEDIA_ROUTE_PREFIX,
  resolvePhotoUploadStorageConfig,
  type PhotoUploadStorageConfig,
} from "../media/photo-upload-config.ts";
import {
  PHOTO_UPLOAD_SIGNING_ALGORITHM,
  PHOTO_UPLOAD_SIGNING_SERVICE,
  resolvePhotoUploadAwsCredentials,
  type PhotoUploadAwsCredentials,
} from "../media/photo-upload-presign.ts";

export const PHOTO_ANALYSIS_STORAGE_DOWNLOAD_SIGNING_METHOD = "GET";
export const PHOTO_ANALYSIS_STORAGE_DOWNLOAD_SIGNED_HEADERS = "host";
export const PHOTO_ANALYSIS_STORAGE_DOWNLOAD_UNSIGNED_PAYLOAD =
  "UNSIGNED-PAYLOAD";
export const PHOTO_ANALYSIS_STORAGE_DOWNLOAD_EXPIRES_IN_SECONDS = 300;
export const PHOTO_ANALYSIS_STORAGE_MEDIA_URL_INVALID_ERROR =
  "photo_analysis mediaUrl must resolve to a valid uploaded photo storage URL.";

export interface PhotoAnalysisStorageObjectHeaders {
  cacheControl?: string;
  contentDisposition?: string;
  contentEncoding?: string;
  contentLanguage?: string;
  contentLength?: number;
  contentType?: string;
  eTag?: string;
  lastModified?: string;
  versionId?: string;
}

export interface PhotoAnalysisStorageObject {
  bytes: Uint8Array;
  headers: PhotoAnalysisStorageObjectHeaders;
  mediaUrl: string;
  storageKey: string;
}

export const SUPPORTED_PHOTO_ANALYSIS_IMAGE_MIME_TYPES = [
  "image/avif",
  "image/gif",
  "image/heic",
  "image/heif",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type SupportedPhotoAnalysisImageMimeType =
  (typeof SUPPORTED_PHOTO_ANALYSIS_IMAGE_MIME_TYPES)[number];

export interface PhotoAnalysisStorageImageMetadata {
  height: number;
  mimeType: SupportedPhotoAnalysisImageMimeType;
  sizeBytes: number;
  width: number;
}

export interface PhotoAnalysisStorageImageObject
  extends PhotoAnalysisStorageObject {
  image: PhotoAnalysisStorageImageMetadata;
}

export const PHOTO_ANALYSIS_STORAGE_ERROR_STAGE_RETRIEVAL = "retrieval";
export const PHOTO_ANALYSIS_STORAGE_ERROR_STAGE_VALIDATION = "validation";

export type PhotoAnalysisStorageErrorStage =
  | typeof PHOTO_ANALYSIS_STORAGE_ERROR_STAGE_RETRIEVAL
  | typeof PHOTO_ANALYSIS_STORAGE_ERROR_STAGE_VALIDATION;

export interface PhotoAnalysisStorageErrorContext {
  cause?: unknown;
  mediaUrl: string;
  storageKey?: string;
}

export abstract class PhotoAnalysisStorageError extends Error {
  override readonly cause?: unknown;
  readonly mediaUrl: string;
  abstract readonly stage: PhotoAnalysisStorageErrorStage;
  readonly storageKey?: string;

  constructor(message: string, context: PhotoAnalysisStorageErrorContext) {
    super(message);

    this.cause = context.cause;
    this.mediaUrl = context.mediaUrl;
    this.storageKey = context.storageKey;
  }
}

export class PhotoAnalysisStorageRetrievalError extends PhotoAnalysisStorageError {
  readonly name = "PhotoAnalysisStorageRetrievalError";
  readonly stage = PHOTO_ANALYSIS_STORAGE_ERROR_STAGE_RETRIEVAL;
}

export class PhotoAnalysisStorageValidationError extends TypeError {
  override readonly cause?: unknown;
  readonly mediaUrl: string;
  readonly name = "PhotoAnalysisStorageValidationError";
  readonly stage = PHOTO_ANALYSIS_STORAGE_ERROR_STAGE_VALIDATION;
  readonly storageKey?: string;

  constructor(message: string, context: PhotoAnalysisStorageErrorContext) {
    super(message);

    this.cause = context.cause;
    this.mediaUrl = context.mediaUrl;
    this.storageKey = context.storageKey;
  }
}

export type PhotoAnalysisStorageImageResultError =
  | PhotoAnalysisStorageRetrievalError
  | PhotoAnalysisStorageValidationError;

export interface RetrievePhotoAnalysisStorageImageValidatedResult {
  image: PhotoAnalysisStorageImageObject;
  status: "validated";
}

export interface RetrievePhotoAnalysisStorageImageErrorResult {
  error: PhotoAnalysisStorageImageResultError;
  status: "error";
}

export type RetrievePhotoAnalysisStorageImageResult =
  | RetrievePhotoAnalysisStorageImageValidatedResult
  | RetrievePhotoAnalysisStorageImageErrorResult;

export const PHOTO_ANALYSIS_STORAGE_OBJECT_EMPTY_IMAGE_ERROR =
  "photo_analysis storage object must contain at least 1 byte before image analysis.";
export const PHOTO_ANALYSIS_STORAGE_OBJECT_INVALID_IMAGE_ERROR =
  "photo_analysis storage object must contain a valid image payload.";
export const PHOTO_ANALYSIS_STORAGE_OBJECT_UNSUPPORTED_IMAGE_ERROR =
  "photo_analysis storage object must be a supported image format (PNG, JPEG, GIF, WebP, AVIF, HEIC, or HEIF).";

export interface RetrievePhotoAnalysisStorageObjectOptions {
  credentials?: PhotoUploadAwsCredentials;
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  now?: () => Date;
  storageConfig?: PhotoUploadStorageConfig;
}

function readErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  if (typeof error === "string") {
    const normalizedError = error.trim();

    if (normalizedError.length > 0) {
      return normalizedError;
    }
  }

  return fallback;
}

function createSha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function createHmacBuffer(key: Buffer | string, value: string): Buffer {
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

function encodeS3ObjectKeyPath(storageKey: string): string {
  return storageKey
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function buildCanonicalQueryString(query: Record<string, string>): string {
  return Object.entries(query)
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
      const normalizedLeftKey = encodeURIComponent(leftKey);
      const normalizedRightKey = encodeURIComponent(rightKey);

      if (normalizedLeftKey === normalizedRightKey) {
        return encodeURIComponent(leftValue).localeCompare(
          encodeURIComponent(rightValue),
        );
      }

      return normalizedLeftKey.localeCompare(normalizedRightKey);
    })
    .map(
      ([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
    )
    .join("&");
}

function createAwsSigningKey(
  credentials: PhotoUploadAwsCredentials,
  dateStamp: string,
  region: string,
): Buffer {
  const dateKey = createHmacBuffer(
    `AWS4${credentials.secretAccessKey}`,
    dateStamp,
  );
  const regionKey = createHmacBuffer(dateKey, region);
  const serviceKey = createHmacBuffer(regionKey, PHOTO_UPLOAD_SIGNING_SERVICE);

  return createHmacBuffer(serviceKey, "aws4_request");
}

function createPresignedPhotoDownloadUrl(input: {
  credentials: PhotoUploadAwsCredentials;
  expiresInSeconds: number;
  now: Date;
  storageConfig: PhotoUploadStorageConfig;
  storageKey: string;
}): string {
  const amzDate = normalizeAwsDate(input.now);
  const dateStamp = normalizeAwsDateStamp(input.now);
  const host =
    `${input.storageConfig.bucketName}.s3.${input.storageConfig.region}.amazonaws.com`;
  const canonicalUri = `/${encodeS3ObjectKeyPath(input.storageKey)}`;
  const credentialScope = [
    dateStamp,
    input.storageConfig.region,
    PHOTO_UPLOAD_SIGNING_SERVICE,
    "aws4_request",
  ].join("/");
  const query: Record<string, string> = {
    "X-Amz-Algorithm": PHOTO_UPLOAD_SIGNING_ALGORITHM,
    "X-Amz-Credential": `${input.credentials.accessKeyId}/${credentialScope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(input.expiresInSeconds),
    "X-Amz-SignedHeaders": PHOTO_ANALYSIS_STORAGE_DOWNLOAD_SIGNED_HEADERS,
  };

  if (input.credentials.sessionToken) {
    query["X-Amz-Security-Token"] = input.credentials.sessionToken;
  }

  const canonicalQueryString = buildCanonicalQueryString(query);
  const canonicalHeaders = `host:${host}\n`;
  const canonicalRequest = [
    PHOTO_ANALYSIS_STORAGE_DOWNLOAD_SIGNING_METHOD,
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    PHOTO_ANALYSIS_STORAGE_DOWNLOAD_SIGNED_HEADERS,
    PHOTO_ANALYSIS_STORAGE_DOWNLOAD_UNSIGNED_PAYLOAD,
  ].join("\n");
  const stringToSign = [
    PHOTO_UPLOAD_SIGNING_ALGORITHM,
    amzDate,
    credentialScope,
    createSha256Hex(canonicalRequest),
  ].join("\n");
  const signature = createHmacHex(
    createAwsSigningKey(
      input.credentials,
      dateStamp,
      input.storageConfig.region,
    ),
    stringToSign,
  );

  return `https://${host}${canonicalUri}?${canonicalQueryString}&X-Amz-Signature=${signature}`;
}

function readRequiredTrimmedString(value: string, label: string): string {
  const normalizedValue = value.trim();

  if (normalizedValue.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return normalizedValue;
}

function readOptionalHeader(
  headers: Pick<Headers, "get">,
  name: string,
): string | undefined {
  const value = headers.get(name);

  if (typeof value !== "string") {
    return undefined;
  }

  const normalizedValue = value.trim();

  return normalizedValue.length > 0 ? normalizedValue : undefined;
}

function readOptionalIntegerHeader(
  headers: Pick<Headers, "get">,
  name: string,
): number | undefined {
  const value = readOptionalHeader(headers, name);

  if (value === undefined) {
    return undefined;
  }

  const normalizedValue = Number.parseInt(value, 10);

  return Number.isFinite(normalizedValue) ? normalizedValue : undefined;
}

function normalizePhotoAnalysisStorageObjectHeaders(
  headers: Pick<Headers, "get">,
): PhotoAnalysisStorageObjectHeaders {
  return {
    ...(readOptionalHeader(headers, "cache-control") === undefined
      ? {}
      : {
          cacheControl: readOptionalHeader(headers, "cache-control"),
        }),
    ...(readOptionalHeader(headers, "content-disposition") === undefined
      ? {}
      : {
          contentDisposition: readOptionalHeader(headers, "content-disposition"),
        }),
    ...(readOptionalHeader(headers, "content-encoding") === undefined
      ? {}
      : {
          contentEncoding: readOptionalHeader(headers, "content-encoding"),
        }),
    ...(readOptionalHeader(headers, "content-language") === undefined
      ? {}
      : {
          contentLanguage: readOptionalHeader(headers, "content-language"),
        }),
    ...(readOptionalIntegerHeader(headers, "content-length") === undefined
      ? {}
      : {
          contentLength: readOptionalIntegerHeader(headers, "content-length"),
        }),
    ...(readOptionalHeader(headers, "content-type") === undefined
      ? {}
      : {
          contentType: readOptionalHeader(headers, "content-type"),
        }),
    ...(readOptionalHeader(headers, "etag") === undefined
      ? {}
      : {
          eTag: readOptionalHeader(headers, "etag"),
        }),
    ...(readOptionalHeader(headers, "last-modified") === undefined
      ? {}
      : {
          lastModified: readOptionalHeader(headers, "last-modified"),
        }),
    ...(readOptionalHeader(headers, "x-amz-version-id") === undefined
      ? {}
      : {
          versionId: readOptionalHeader(headers, "x-amz-version-id"),
        }),
  };
}

function readAscii(
  bytes: Uint8Array,
  offset: number,
  length: number,
): string | null {
  if (offset < 0 || length < 0 || offset + length > bytes.byteLength) {
    return null;
  }

  return Buffer.from(
    bytes.buffer,
    bytes.byteOffset + offset,
    length,
  ).toString("ascii");
}

function readUint16BigEndian(
  bytes: Uint8Array,
  offset: number,
): number | undefined {
  if (offset < 0 || offset + 2 > bytes.byteLength) {
    return undefined;
  }

  return (bytes[offset]! << 8) | bytes[offset + 1]!;
}

function readUint16LittleEndian(
  bytes: Uint8Array,
  offset: number,
): number | undefined {
  if (offset < 0 || offset + 2 > bytes.byteLength) {
    return undefined;
  }

  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function readUint24LittleEndian(
  bytes: Uint8Array,
  offset: number,
): number | undefined {
  if (offset < 0 || offset + 3 > bytes.byteLength) {
    return undefined;
  }

  return (
    bytes[offset]! |
    (bytes[offset + 1]! << 8) |
    (bytes[offset + 2]! << 16)
  );
}

function readUint32BigEndian(
  bytes: Uint8Array,
  offset: number,
): number | undefined {
  if (offset < 0 || offset + 4 > bytes.byteLength) {
    return undefined;
  }

  return (
    bytes[offset]! * 0x1000000 +
    (bytes[offset + 1]! << 16) +
    (bytes[offset + 2]! << 8) +
    bytes[offset + 3]!
  );
}

function readUint64BigEndian(
  bytes: Uint8Array,
  offset: number,
): bigint | undefined {
  if (offset < 0 || offset + 8 > bytes.byteLength) {
    return undefined;
  }

  return (
    (BigInt(bytes[offset]!) << 56n) |
    (BigInt(bytes[offset + 1]!) << 48n) |
    (BigInt(bytes[offset + 2]!) << 40n) |
    (BigInt(bytes[offset + 3]!) << 32n) |
    (BigInt(bytes[offset + 4]!) << 24n) |
    (BigInt(bytes[offset + 5]!) << 16n) |
    (BigInt(bytes[offset + 6]!) << 8n) |
    BigInt(bytes[offset + 7]!)
  );
}

function normalizePositiveDimensions(input: {
  height: number | undefined;
  mimeType: SupportedPhotoAnalysisImageMimeType;
  width: number | undefined;
}): PhotoAnalysisStorageImageMetadata | null {
  if (
    input.width === undefined ||
    input.height === undefined ||
    !Number.isInteger(input.width) ||
    !Number.isInteger(input.height) ||
    input.width < 1 ||
    input.height < 1
  ) {
    return null;
  }

  return {
    height: input.height,
    mimeType: input.mimeType,
    sizeBytes: 0,
    width: input.width,
  };
}

function detectPngImageMetadata(
  bytes: Uint8Array,
): PhotoAnalysisStorageImageMetadata | null {
  if (
    bytes.byteLength < 24 ||
    bytes[0] !== 0x89 ||
    readAscii(bytes, 1, 3) !== "PNG" ||
    bytes[4] !== 0x0d ||
    bytes[5] !== 0x0a ||
    bytes[6] !== 0x1a ||
    bytes[7] !== 0x0a ||
    readAscii(bytes, 12, 4) !== "IHDR"
  ) {
    return null;
  }

  return normalizePositiveDimensions({
    height: readUint32BigEndian(bytes, 20),
    mimeType: "image/png",
    width: readUint32BigEndian(bytes, 16),
  });
}

function detectGifImageMetadata(
  bytes: Uint8Array,
): PhotoAnalysisStorageImageMetadata | null {
  const header = readAscii(bytes, 0, 6);

  if (bytes.byteLength < 10 || (header !== "GIF87a" && header !== "GIF89a")) {
    return null;
  }

  return normalizePositiveDimensions({
    height: readUint16LittleEndian(bytes, 8),
    mimeType: "image/gif",
    width: readUint16LittleEndian(bytes, 6),
  });
}

function isJpegStartOfFrameMarker(marker: number): boolean {
  return (
    (marker >= 0xc0 && marker <= 0xc3) ||
    (marker >= 0xc5 && marker <= 0xc7) ||
    (marker >= 0xc9 && marker <= 0xcb) ||
    (marker >= 0xcd && marker <= 0xcf)
  );
}

function detectJpegImageMetadata(
  bytes: Uint8Array,
): PhotoAnalysisStorageImageMetadata | null {
  if (bytes.byteLength < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null;
  }

  let offset = 2;

  while (offset + 1 < bytes.byteLength) {
    while (offset < bytes.byteLength && bytes[offset] === 0xff) {
      offset += 1;
    }

    if (offset >= bytes.byteLength) {
      return null;
    }

    const marker = bytes[offset]!;
    offset += 1;

    if (marker === 0xd9 || marker === 0xda) {
      return null;
    }

    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }

    const segmentLength = readUint16BigEndian(bytes, offset);

    if (segmentLength === undefined || segmentLength < 2) {
      return null;
    }

    if (isJpegStartOfFrameMarker(marker)) {
      return normalizePositiveDimensions({
        height: readUint16BigEndian(bytes, offset + 3),
        mimeType: "image/jpeg",
        width: readUint16BigEndian(bytes, offset + 5),
      });
    }

    offset += segmentLength;
  }

  return null;
}

function detectWebpImageMetadata(
  bytes: Uint8Array,
): PhotoAnalysisStorageImageMetadata | null {
  if (
    bytes.byteLength < 25 ||
    readAscii(bytes, 0, 4) !== "RIFF" ||
    readAscii(bytes, 8, 4) !== "WEBP"
  ) {
    return null;
  }

  const chunkType = readAscii(bytes, 12, 4);

  switch (chunkType) {
    case "VP8X":
      return normalizePositiveDimensions({
        height:
          readUint24LittleEndian(bytes, 27) === undefined
            ? undefined
            : readUint24LittleEndian(bytes, 27)! + 1,
        mimeType: "image/webp",
        width:
          readUint24LittleEndian(bytes, 24) === undefined
            ? undefined
            : readUint24LittleEndian(bytes, 24)! + 1,
      });
    case "VP8L": {
      if (bytes[20] !== 0x2f) {
        return null;
      }

      const byte0 = bytes[21];
      const byte1 = bytes[22];
      const byte2 = bytes[23];
      const byte3 = bytes[24];

      if (
        byte0 === undefined ||
        byte1 === undefined ||
        byte2 === undefined ||
        byte3 === undefined
      ) {
        return null;
      }

      return normalizePositiveDimensions({
        height:
          1 +
          (((byte3 & 0x0f) << 10) | (byte2 << 2) | ((byte1 & 0xc0) >> 6)),
        mimeType: "image/webp",
        width: 1 + (((byte1 & 0x3f) << 8) | byte0),
      });
    }
    case "VP8 ": {
      if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) {
        return null;
      }

      const widthBits = readUint16LittleEndian(bytes, 26);
      const heightBits = readUint16LittleEndian(bytes, 28);

      return normalizePositiveDimensions({
        height:
          heightBits === undefined ? undefined : heightBits & 0x3fff,
        mimeType: "image/webp",
        width: widthBits === undefined ? undefined : widthBits & 0x3fff,
      });
    }
    default:
      return null;
  }
}

interface ParsedIsoBmffBoxHeader {
  contentOffset: number;
  endOffset: number;
  type: string;
}

function parseIsoBmffBoxHeader(
  bytes: Uint8Array,
  offset: number,
  endOffset: number,
): ParsedIsoBmffBoxHeader | null {
  const size = readUint32BigEndian(bytes, offset);
  const type = readAscii(bytes, offset + 4, 4);

  if (size === undefined || type === null) {
    return null;
  }

  if (size === 0) {
    if (offset + 8 > endOffset) {
      return null;
    }

    return {
      contentOffset: offset + 8,
      endOffset,
      type,
    };
  }

  if (size === 1) {
    const largeSize = readUint64BigEndian(bytes, offset + 8);

    if (
      largeSize === undefined ||
      largeSize < 16n ||
      largeSize > BigInt(Number.MAX_SAFE_INTEGER)
    ) {
      return null;
    }

    const resolvedEndOffset = offset + Number(largeSize);

    if (resolvedEndOffset > endOffset) {
      return null;
    }

    return {
      contentOffset: offset + 16,
      endOffset: resolvedEndOffset,
      type,
    };
  }

  if (size < 8) {
    return null;
  }

  const resolvedEndOffset = offset + size;

  if (resolvedEndOffset > endOffset) {
    return null;
  }

  return {
    contentOffset: offset + 8,
    endOffset: resolvedEndOffset,
    type,
  };
}

function resolveIsoBmffImageMimeType(
  brands: readonly string[],
): SupportedPhotoAnalysisImageMimeType | null {
  if (brands.some((brand) => brand === "avif" || brand === "avis")) {
    return "image/avif";
  }

  if (
    brands.some((brand) =>
      ["heic", "heix", "hevc", "hevx"].includes(brand),
    )
  ) {
    return "image/heic";
  }

  if (
    brands.some((brand) =>
      ["heif", "heim", "heis", "mif1", "msf1"].includes(brand),
    )
  ) {
    return "image/heif";
  }

  return null;
}

function readIsoBmffBrands(
  bytes: Uint8Array,
  box: ParsedIsoBmffBoxHeader,
): string[] | null {
  if (box.contentOffset + 8 > box.endOffset) {
    return null;
  }

  const majorBrand = readAscii(bytes, box.contentOffset, 4);

  if (majorBrand === null) {
    return null;
  }

  const compatibleBrands: string[] = [];

  for (
    let offset = box.contentOffset + 8;
    offset + 4 <= box.endOffset;
    offset += 4
  ) {
    const compatibleBrand = readAscii(bytes, offset, 4);

    if (compatibleBrand === null) {
      return null;
    }

    compatibleBrands.push(compatibleBrand);
  }

  return [majorBrand, ...compatibleBrands];
}

function findIsoBmffImageDimensions(
  bytes: Uint8Array,
  offset: number,
  endOffset: number,
): PhotoAnalysisStorageImageMetadata | null {
  let cursor = offset;

  while (cursor + 8 <= endOffset) {
    const box = parseIsoBmffBoxHeader(bytes, cursor, endOffset);

    if (box === null || box.endOffset <= cursor) {
      return null;
    }

    if (box.type === "ispe") {
      return normalizePositiveDimensions({
        height: readUint32BigEndian(bytes, box.contentOffset + 8),
        mimeType: "image/heif",
        width: readUint32BigEndian(bytes, box.contentOffset + 4),
      });
    }

    if (box.type === "meta") {
      const nested = findIsoBmffImageDimensions(
        bytes,
        box.contentOffset + 4,
        box.endOffset,
      );

      if (nested !== null) {
        return nested;
      }
    }

    if (box.type === "iprp" || box.type === "ipco") {
      const nested = findIsoBmffImageDimensions(
        bytes,
        box.contentOffset,
        box.endOffset,
      );

      if (nested !== null) {
        return nested;
      }
    }

    cursor = box.endOffset;
  }

  return null;
}

function detectIsoBmffImageMetadata(
  bytes: Uint8Array,
): PhotoAnalysisStorageImageMetadata | null {
  const firstBox = parseIsoBmffBoxHeader(bytes, 0, bytes.byteLength);

  if (firstBox?.type !== "ftyp") {
    return null;
  }

  const brands = readIsoBmffBrands(bytes, firstBox);
  const mimeType = brands === null ? null : resolveIsoBmffImageMimeType(brands);

  if (mimeType === null) {
    return null;
  }

  const dimensions = findIsoBmffImageDimensions(
    bytes,
    firstBox.endOffset,
    bytes.byteLength,
  );

  if (dimensions === null) {
    return null;
  }

  return {
    ...dimensions,
    mimeType,
  };
}

function normalizeDeclaredImageMimeType(
  headers: PhotoAnalysisStorageObjectHeaders,
): string | undefined {
  const contentType = headers.contentType?.split(";")[0]?.trim().toLowerCase();

  if (!contentType) {
    return undefined;
  }

  if (contentType === "image/jpg") {
    return "image/jpeg";
  }

  return contentType;
}

export function extractPhotoAnalysisStorageImageMetadata(
  storageObject: Pick<PhotoAnalysisStorageObject, "bytes" | "headers">,
): PhotoAnalysisStorageImageMetadata {
  const sizeBytes = storageObject.bytes.byteLength;

  if (sizeBytes < 1) {
    throw new TypeError(PHOTO_ANALYSIS_STORAGE_OBJECT_EMPTY_IMAGE_ERROR);
  }

  const detectedImageMetadata =
    detectPngImageMetadata(storageObject.bytes) ??
    detectGifImageMetadata(storageObject.bytes) ??
    detectJpegImageMetadata(storageObject.bytes) ??
    detectWebpImageMetadata(storageObject.bytes) ??
    detectIsoBmffImageMetadata(storageObject.bytes);

  if (detectedImageMetadata === null) {
    const declaredImageMimeType = normalizeDeclaredImageMimeType(
      storageObject.headers,
    );

    if (
      declaredImageMimeType !== undefined &&
      declaredImageMimeType.startsWith("image/") &&
      SUPPORTED_PHOTO_ANALYSIS_IMAGE_MIME_TYPES.includes(
        declaredImageMimeType as SupportedPhotoAnalysisImageMimeType,
      )
    ) {
      throw new TypeError(PHOTO_ANALYSIS_STORAGE_OBJECT_INVALID_IMAGE_ERROR);
    }

    throw new TypeError(PHOTO_ANALYSIS_STORAGE_OBJECT_UNSUPPORTED_IMAGE_ERROR);
  }

  return {
    ...detectedImageMetadata,
    sizeBytes,
  };
}

export function resolvePhotoAnalysisStorageKey(
  mediaUrl: string,
  options: {
    env?: NodeJS.ProcessEnv;
    storageConfig?: PhotoUploadStorageConfig;
  } = {},
): string {
  const storageConfig =
    options.storageConfig ?? resolvePhotoUploadStorageConfig(options.env);
  let parsedMediaUrl: URL;

  try {
    parsedMediaUrl = new URL(readRequiredTrimmedString(mediaUrl, "mediaUrl"));
  } catch {
    throw new TypeError(PHOTO_ANALYSIS_STORAGE_MEDIA_URL_INVALID_ERROR);
  }

  if (
    parsedMediaUrl.origin !== storageConfig.appUrl ||
    parsedMediaUrl.search.length > 0 ||
    parsedMediaUrl.hash.length > 0
  ) {
    throw new TypeError(PHOTO_ANALYSIS_STORAGE_MEDIA_URL_INVALID_ERROR);
  }

  const pathnamePrefix = `${PHOTO_UPLOAD_MEDIA_ROUTE_PREFIX}/`;

  if (!parsedMediaUrl.pathname.startsWith(pathnamePrefix)) {
    throw new TypeError(PHOTO_ANALYSIS_STORAGE_MEDIA_URL_INVALID_ERROR);
  }

  const encodedStorageKeyPath = parsedMediaUrl.pathname.slice(
    pathnamePrefix.length,
  );

  if (encodedStorageKeyPath.length === 0) {
    throw new TypeError(PHOTO_ANALYSIS_STORAGE_MEDIA_URL_INVALID_ERROR);
  }

  const segments = encodedStorageKeyPath.split("/");

  if (segments.some((segment) => segment.length === 0)) {
    throw new TypeError(PHOTO_ANALYSIS_STORAGE_MEDIA_URL_INVALID_ERROR);
  }

  try {
    return segments.map((segment) => decodeURIComponent(segment)).join("/");
  } catch {
    throw new TypeError(PHOTO_ANALYSIS_STORAGE_MEDIA_URL_INVALID_ERROR);
  }
}

export async function retrievePhotoAnalysisStorageObject(
  mediaUrl: string,
  options: RetrievePhotoAnalysisStorageObjectOptions = {},
): Promise<PhotoAnalysisStorageObject> {
  const env = options.env ?? process.env;
  const storageConfig =
    options.storageConfig ?? resolvePhotoUploadStorageConfig(env);
  const storageKey = resolvePhotoAnalysisStorageKey(mediaUrl, {
    storageConfig,
  });
  const credentials =
    options.credentials ?? resolvePhotoUploadAwsCredentials(env);
  const now = options.now ?? (() => new Date());
  const fetchImplementation = options.fetch ?? fetch;
  const downloadUrl = createPresignedPhotoDownloadUrl({
    credentials,
    expiresInSeconds: PHOTO_ANALYSIS_STORAGE_DOWNLOAD_EXPIRES_IN_SECONDS,
    now: now(),
    storageConfig,
    storageKey,
  });
  const response = await fetchImplementation(downloadUrl, {
    method: PHOTO_ANALYSIS_STORAGE_DOWNLOAD_SIGNING_METHOD,
  });

  if (!response.ok) {
    throw new Error(
      `Failed to download photo object "${storageKey}" from S3 (${response.status} ${response.statusText}).`,
    );
  }

  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    headers: normalizePhotoAnalysisStorageObjectHeaders(response.headers),
    mediaUrl: new URL(mediaUrl).toString(),
    storageKey,
  };
}

export async function retrievePhotoAnalysisStorageImageResult(
  mediaUrl: string,
  options: RetrievePhotoAnalysisStorageObjectOptions = {},
): Promise<RetrievePhotoAnalysisStorageImageResult> {
  const env = options.env ?? process.env;
  const storageConfig =
    options.storageConfig ?? resolvePhotoUploadStorageConfig(env);
  let storageKey: string | undefined;

  try {
    storageKey = resolvePhotoAnalysisStorageKey(mediaUrl, {
      storageConfig,
    });
  } catch (error) {
    return {
      error: new PhotoAnalysisStorageValidationError(
        readErrorMessage(error, PHOTO_ANALYSIS_STORAGE_MEDIA_URL_INVALID_ERROR),
        {
          cause: error,
          mediaUrl,
        },
      ),
      status: "error",
    };
  }

  let storageObject: PhotoAnalysisStorageObject;

  try {
    storageObject = await retrievePhotoAnalysisStorageObject(mediaUrl, {
      ...options,
      env,
      storageConfig,
    });
  } catch (error) {
    return {
      error: new PhotoAnalysisStorageRetrievalError(
        readErrorMessage(
          error,
          `Failed to download photo object "${storageKey}" from S3.`,
        ),
        {
          cause: error,
          mediaUrl,
          storageKey,
        },
      ),
      status: "error",
    };
  }

  try {
    return {
      image: {
        ...storageObject,
        image: extractPhotoAnalysisStorageImageMetadata(storageObject),
      },
      status: "validated",
    };
  } catch (error) {
    return {
      error: new PhotoAnalysisStorageValidationError(
        readErrorMessage(
          error,
          PHOTO_ANALYSIS_STORAGE_OBJECT_INVALID_IMAGE_ERROR,
        ),
        {
          cause: error,
          mediaUrl: storageObject.mediaUrl,
          storageKey: storageObject.storageKey,
        },
      ),
      status: "error",
    };
  }
}

export async function retrievePhotoAnalysisStorageImageObject(
  mediaUrl: string,
  options: RetrievePhotoAnalysisStorageObjectOptions = {},
): Promise<PhotoAnalysisStorageImageObject> {
  const retrievalResult = await retrievePhotoAnalysisStorageImageResult(
    mediaUrl,
    options,
  );

  if (retrievalResult.status === "error") {
    throw retrievalResult.error;
  }

  return retrievalResult.image;
}
