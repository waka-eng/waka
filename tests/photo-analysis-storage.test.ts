import assert from "node:assert/strict";
import test from "node:test";

import {
  PHOTO_ANALYSIS_STORAGE_MEDIA_URL_INVALID_ERROR,
  PHOTO_ANALYSIS_STORAGE_OBJECT_EMPTY_IMAGE_ERROR,
  PHOTO_ANALYSIS_STORAGE_OBJECT_INVALID_IMAGE_ERROR,
  PHOTO_ANALYSIS_STORAGE_OBJECT_UNSUPPORTED_IMAGE_ERROR,
  PhotoAnalysisStorageRetrievalError,
  PhotoAnalysisStorageValidationError,
  extractPhotoAnalysisStorageImageMetadata,
  resolvePhotoAnalysisStorageKey,
  retrievePhotoAnalysisStorageImageResult,
  retrievePhotoAnalysisStorageImageObject,
  retrievePhotoAnalysisStorageObject,
} from "../apps/web/src/jobs/photo-analysis-storage.ts";

const TEST_ENV = {
  APP_URL: "https://waka.app",
  AWS_ACCESS_KEY_ID: "AKIAEXAMPLE",
  AWS_REGION: "ap-northeast-2",
  AWS_SECRET_ACCESS_KEY: "secret-access-key",
  AWS_SESSION_TOKEN: "session-token",
  SST_RESOURCE_MediaBucket_name: "waka-dev-media-bucket",
} as const;

function toAsciiBytes(value: string): number[] {
  return [...Buffer.from(value, "ascii")];
}

function toUint16BigEndianBytes(value: number): number[] {
  return [(value >> 8) & 0xff, value & 0xff];
}

function toUint24LittleEndianBytes(value: number): number[] {
  return [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff];
}

function toUint32BigEndianBytes(value: number): number[] {
  return [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ];
}

function toUint32LittleEndianBytes(value: number): number[] {
  return [
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  ];
}

function createPngBytes(width: number, height: number): Uint8Array {
  return Uint8Array.from([
    0x89,
    ...toAsciiBytes("PNG"),
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    0x00,
    0x00,
    0x00,
    0x0d,
    ...toAsciiBytes("IHDR"),
    ...toUint32BigEndianBytes(width),
    ...toUint32BigEndianBytes(height),
  ]);
}

function createJpegBytes(width: number, height: number): Uint8Array {
  return Uint8Array.from([
    0xff,
    0xd8,
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    ...toUint16BigEndianBytes(height),
    ...toUint16BigEndianBytes(width),
    0x03,
    0x01,
    0x11,
    0x00,
    0x02,
    0x11,
    0x00,
    0x03,
    0x11,
    0x00,
    0xff,
    0xd9,
  ]);
}

function createWebpVp8xBytes(width: number, height: number): Uint8Array {
  const riffSize = 4 + 8 + 10;

  return Uint8Array.from([
    ...toAsciiBytes("RIFF"),
    ...toUint32LittleEndianBytes(riffSize),
    ...toAsciiBytes("WEBP"),
    ...toAsciiBytes("VP8X"),
    ...toUint32LittleEndianBytes(10),
    0x00,
    0x00,
    0x00,
    0x00,
    ...toUint24LittleEndianBytes(width - 1),
    ...toUint24LittleEndianBytes(height - 1),
  ]);
}

function createIsoBmffBox(type: string, content: number[]): number[] {
  return [
    ...toUint32BigEndianBytes(8 + content.length),
    ...toAsciiBytes(type),
    ...content,
  ];
}

function createAvifBytes(width: number, height: number): Uint8Array {
  const ispeBox = createIsoBmffBox("ispe", [
    0x00,
    0x00,
    0x00,
    0x00,
    ...toUint32BigEndianBytes(width),
    ...toUint32BigEndianBytes(height),
  ]);
  const ipcoBox = createIsoBmffBox("ipco", ispeBox);
  const iprpBox = createIsoBmffBox("iprp", ipcoBox);
  const metaBox = createIsoBmffBox("meta", [0x00, 0x00, 0x00, 0x00, ...iprpBox]);
  const ftypBox = createIsoBmffBox("ftyp", [
    ...toAsciiBytes("avif"),
    0x00,
    0x00,
    0x00,
    0x00,
    ...toAsciiBytes("avif"),
    ...toAsciiBytes("mif1"),
  ]);

  return Uint8Array.from([...ftypBox, ...metaBox]);
}

test("resolvePhotoAnalysisStorageKey derives the uploaded S3 key from the internal media route", () => {
  assert.equal(
    resolvePhotoAnalysisStorageKey(
      "https://waka.app/api/media/photos/users/user-photo/photos/1775793906000-moodboard-upload.webp",
      {
        env: TEST_ENV,
      },
    ),
    "users/user-photo/photos/1775793906000-moodboard-upload.webp",
  );
});

test("retrievePhotoAnalysisStorageObject downloads the uploaded image bytes and surfaces object headers", async () => {
  const requests: Array<{
    init?: RequestInit;
    input: string | URL | Request;
  }> = [];
  const fetchImplementation: typeof fetch = async (input, init) => {
    requests.push({
      init,
      input,
    });

    return new Response(new Uint8Array([1, 2, 3, 4]), {
      headers: {
        "cache-control": "max-age=31536000",
        "content-disposition": 'inline; filename="moodboard.webp"',
        "content-length": "4",
        "content-type": "image/webp",
        etag: '"etag-123"',
        "last-modified": "Fri, 10 Apr 2026 12:00:00 GMT",
        "x-amz-version-id": "version-7",
      },
      status: 200,
      statusText: "OK",
    });
  };

  const result = await retrievePhotoAnalysisStorageObject(
    "https://waka.app/api/media/photos/users/user-photo/photos/1775793906000-moodboard-upload.webp",
    {
      env: TEST_ENV,
      fetch: fetchImplementation,
      now: () => new Date("2026-04-10T12:34:56.000Z"),
    },
  );

  assert.equal(result.storageKey, "users/user-photo/photos/1775793906000-moodboard-upload.webp");
  assert.deepEqual([...result.bytes], [1, 2, 3, 4]);
  assert.deepEqual(result.headers, {
    cacheControl: "max-age=31536000",
    contentDisposition: 'inline; filename="moodboard.webp"',
    contentLength: 4,
    contentType: "image/webp",
    eTag: '"etag-123"',
    lastModified: "Fri, 10 Apr 2026 12:00:00 GMT",
    versionId: "version-7",
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.init?.method, "GET");

  const requestUrl = new URL(String(requests[0]?.input));

  assert.equal(
    requestUrl.origin,
    "https://waka-dev-media-bucket.s3.ap-northeast-2.amazonaws.com",
  );
  assert.equal(
    requestUrl.pathname,
    "/users/user-photo/photos/1775793906000-moodboard-upload.webp",
  );
  assert.equal(
    requestUrl.searchParams.get("X-Amz-Algorithm"),
    "AWS4-HMAC-SHA256",
  );
  assert.equal(requestUrl.searchParams.get("X-Amz-SignedHeaders"), "host");
  assert.equal(
    requestUrl.searchParams.get("X-Amz-Security-Token"),
    "session-token",
  );
  assert.match(
    String(requestUrl.searchParams.get("X-Amz-Signature")),
    /^[a-f0-9]{64}$/u,
  );
});

test("retrievePhotoAnalysisStorageImageObject validates the downloaded image bytes and derives normalized metadata", async () => {
  const pngBytes = createPngBytes(320, 200);
  const fetchImplementation: typeof fetch = async () =>
    new Response(pngBytes, {
      headers: {
        "content-length": String(pngBytes.byteLength),
        "content-type": "image/png; charset=binary",
      },
      status: 200,
      statusText: "OK",
    });

  const result = await retrievePhotoAnalysisStorageImageObject(
    "https://waka.app/api/media/photos/users/user-photo/photos/1775793906000-moodboard-upload.png",
    {
      env: TEST_ENV,
      fetch: fetchImplementation,
    },
  );

  assert.deepEqual(result.image, {
    height: 200,
    mimeType: "image/png",
    sizeBytes: pngBytes.byteLength,
    width: 320,
  });
});

test("retrievePhotoAnalysisStorageImageResult returns a stable validated image interface for downstream workers", async () => {
  const pngBytes = createPngBytes(512, 256);
  const result = await retrievePhotoAnalysisStorageImageResult(
    "https://waka.app/api/media/photos/users/user-photo/photos/validated-moodboard.png",
    {
      env: TEST_ENV,
      fetch: async () =>
        new Response(pngBytes, {
          headers: {
            "content-length": String(pngBytes.byteLength),
            "content-type": "image/png",
          },
          status: 200,
          statusText: "OK",
        }),
    },
  );

  assert.equal(result.status, "validated");

  if (result.status !== "validated") {
    throw new Error("Expected a validated photo analysis retrieval result.");
  }

  assert.deepEqual(result.image.image, {
    height: 256,
    mimeType: "image/png",
    sizeBytes: pngBytes.byteLength,
    width: 512,
  });
  assert.equal(
    result.image.storageKey,
    "users/user-photo/photos/validated-moodboard.png",
  );
});

test("extractPhotoAnalysisStorageImageMetadata parses JPEG dimensions and normalizes the MIME type", () => {
  const jpegBytes = createJpegBytes(43, 42);

  assert.deepEqual(
    extractPhotoAnalysisStorageImageMetadata({
      bytes: jpegBytes,
      headers: {
        contentType: "image/jpg",
      },
    }),
    {
      height: 42,
      mimeType: "image/jpeg",
      sizeBytes: jpegBytes.byteLength,
      width: 43,
    },
  );
});

test("extractPhotoAnalysisStorageImageMetadata parses WebP dimensions from the binary payload", () => {
  const webpBytes = createWebpVp8xBytes(801, 603);

  assert.deepEqual(
    extractPhotoAnalysisStorageImageMetadata({
      bytes: webpBytes,
      headers: {
        contentType: "image/webp",
      },
    }),
    {
      height: 603,
      mimeType: "image/webp",
      sizeBytes: webpBytes.byteLength,
      width: 801,
    },
  );
});

test("extractPhotoAnalysisStorageImageMetadata parses AVIF dimensions from ISO BMFF metadata", () => {
  const avifBytes = createAvifBytes(1440, 900);

  assert.deepEqual(
    extractPhotoAnalysisStorageImageMetadata({
      bytes: avifBytes,
      headers: {},
    }),
    {
      height: 900,
      mimeType: "image/avif",
      sizeBytes: avifBytes.byteLength,
      width: 1440,
    },
  );
});

test("extractPhotoAnalysisStorageImageMetadata rejects empty image payloads", () => {
  assert.throws(
    () =>
      extractPhotoAnalysisStorageImageMetadata({
        bytes: new Uint8Array(0),
        headers: {},
      }),
    {
      message: PHOTO_ANALYSIS_STORAGE_OBJECT_EMPTY_IMAGE_ERROR,
      name: "TypeError",
    },
  );
});

test("extractPhotoAnalysisStorageImageMetadata rejects malformed supported image payloads", () => {
  assert.throws(
    () =>
      extractPhotoAnalysisStorageImageMetadata({
        bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47]),
        headers: {
          contentType: "image/png",
        },
      }),
    {
      message: PHOTO_ANALYSIS_STORAGE_OBJECT_INVALID_IMAGE_ERROR,
      name: "TypeError",
    },
  );
});

test("extractPhotoAnalysisStorageImageMetadata rejects unsupported non-image payloads", () => {
  assert.throws(
    () =>
      extractPhotoAnalysisStorageImageMetadata({
        bytes: Uint8Array.from(Buffer.from("not-an-image", "utf8")),
        headers: {
          contentType: "text/plain",
        },
      }),
    {
      message: PHOTO_ANALYSIS_STORAGE_OBJECT_UNSUPPORTED_IMAGE_ERROR,
      name: "TypeError",
    },
  );
});

test("retrievePhotoAnalysisStorageObject rejects media URLs outside the configured photo media route", async () => {
  await assert.rejects(
    () =>
      retrievePhotoAnalysisStorageObject(
        "https://waka.app/api/media/audio/users/user-photo/photos/1775793906000-moodboard-upload.webp",
        {
          env: TEST_ENV,
        },
      ),
    new RegExp(PHOTO_ANALYSIS_STORAGE_MEDIA_URL_INVALID_ERROR),
  );
});

test("retrievePhotoAnalysisStorageObject surfaces failed S3 downloads with the resolved object key", async () => {
  const fetchImplementation: typeof fetch = async () =>
    new Response("missing", {
      status: 404,
      statusText: "Not Found",
    });

  await assert.rejects(
    () =>
      retrievePhotoAnalysisStorageObject(
        "https://waka.app/api/media/photos/users/user-photo/photos/1775793906000-moodboard-upload.webp",
        {
          env: TEST_ENV,
          fetch: fetchImplementation,
        },
      ),
    /Failed to download photo object "users\/user-photo\/photos\/1775793906000-moodboard-upload\.webp" from S3 \(404 Not Found\)\./,
  );
});

test("retrievePhotoAnalysisStorageImageResult returns an explicit retrieval error when the storage object cannot be downloaded", async () => {
  const result = await retrievePhotoAnalysisStorageImageResult(
    "https://waka.app/api/media/photos/users/user-photo/photos/missing.webp",
    {
      env: TEST_ENV,
      fetch: async () =>
        new Response("missing", {
          status: 404,
          statusText: "Not Found",
        }),
    },
  );

  assert.equal(result.status, "error");

  if (result.status !== "error") {
    throw new Error("Expected an explicit photo retrieval error.");
  }

  assert.equal(result.error instanceof PhotoAnalysisStorageRetrievalError, true);
  assert.equal(result.error.stage, "retrieval");
  assert.equal(
    result.error.storageKey,
    "users/user-photo/photos/missing.webp",
  );
  assert.equal(
    result.error.mediaUrl,
    "https://waka.app/api/media/photos/users/user-photo/photos/missing.webp",
  );
  assert.match(result.error.message, /404 Not Found/);
});

test("retrievePhotoAnalysisStorageImageResult returns an explicit validation error when the downloaded bytes are not a valid image", async () => {
  const malformedPngBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47]);
  const result = await retrievePhotoAnalysisStorageImageResult(
    "https://waka.app/api/media/photos/users/user-photo/photos/malformed.png",
    {
      env: TEST_ENV,
      fetch: async () =>
        new Response(malformedPngBytes, {
          headers: {
            "content-length": String(malformedPngBytes.byteLength),
            "content-type": "image/png",
          },
          status: 200,
          statusText: "OK",
        }),
    },
  );

  assert.equal(result.status, "error");

  if (result.status !== "error") {
    throw new Error("Expected an explicit photo validation error.");
  }

  assert.equal(result.error instanceof PhotoAnalysisStorageValidationError, true);
  assert.equal(result.error.stage, "validation");
  assert.equal(
    result.error.storageKey,
    "users/user-photo/photos/malformed.png",
  );
  assert.equal(
    result.error.mediaUrl,
    "https://waka.app/api/media/photos/users/user-photo/photos/malformed.png",
  );
  assert.equal(result.error.message, PHOTO_ANALYSIS_STORAGE_OBJECT_INVALID_IMAGE_ERROR);
});
