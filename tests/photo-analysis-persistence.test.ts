import assert from "node:assert/strict";
import test from "node:test";

import {
  PHOTO_ANALYSIS_PERSISTENCE_CAPTURE_NOT_FOUND_ERROR,
  PHOTO_ANALYSIS_PERSISTENCE_SOURCE_TYPE_INVALID_ERROR,
  buildPersistPhotoAnalysisResultArgs,
  buildReadPhotoAnalysisRecordArgs,
  persistPhotoAnalysisResult,
  type PhotoAnalysisPersistenceClient,
  type PhotoAnalysisPersistenceRecord,
} from "../apps/web/src/jobs/photo-analysis-persistence.ts";
import { PHOTO_ANALYSIS_EXTRACTION_EMPTY_ERROR } from "../apps/web/src/jobs/photo-analysis-text.ts";
import type { PhotoAnalysisStorageImageObject } from "../apps/web/src/jobs/photo-analysis-storage.ts";

function createValidatedImage(): PhotoAnalysisStorageImageObject {
  return {
    bytes: Uint8Array.from([1, 2, 3, 4]),
    headers: {
      contentLength: 4,
      contentType: "image/webp",
    },
    image: {
      height: 720,
      mimeType: "image/webp",
      sizeBytes: 4,
      width: 1280,
    },
    mediaUrl:
      "https://waka.app/api/media/photos/users/user-photo/photos/moodboard.webp",
    storageKey: "users/user-photo/photos/moodboard.webp",
  };
}

test("buildReadPhotoAnalysisRecordArgs scopes photo-analysis reads to the requested inspiration id", () => {
  assert.deepEqual(buildReadPhotoAnalysisRecordArgs(" insp-photo-42 "), {
    select: {
      id: true,
      rawContent: true,
      sourceMeta: true,
      sourceType: true,
      transcript: true,
    },
    where: {
      id: "insp-photo-42",
    },
  });
});

test("buildPersistPhotoAnalysisResultArgs replaces the placeholder photo rawContent with the generated description and persists photo metadata", () => {
  const record: PhotoAnalysisPersistenceRecord = {
    id: "insp-photo-42",
    rawContent: "moodboard.webp",
    sourceMeta: {
      fileName: "moodboard.webp",
      mimeType: "image/png",
      source: "camera",
    },
    sourceType: "PHOTO",
    transcript: null,
  };

  assert.deepEqual(
    buildPersistPhotoAnalysisResultArgs(
      record,
      createValidatedImage(),
      "  Queue   retries \r\n\tOffline drafts\u00A0\r\n\r\n\r\n  Saved locally  ",
    ),
    {
      data: {
        generatedDescription: "Queue retries\nOffline drafts\n\nSaved locally",
        ocrText: "Queue retries\nOffline drafts\n\nSaved locally",
        processingState: {
          fields: {
            generatedDescription: {
              status: "COMPLETED",
            },
            ocrText: {
              status: "COMPLETED",
            },
          },
          status: "COMPLETED",
        },
        rawContent: "Queue retries\nOffline drafts\n\nSaved locally",
        sourceMeta: {
          description: "Queue retries\nOffline drafts\n\nSaved locally",
          fileName: "moodboard.webp",
          height: 720,
          mimeType: "image/webp",
          ocrText: "Queue retries\nOffline drafts\n\nSaved locally",
          sizeBytes: 4,
          source: "camera",
          width: 1280,
        },
        transcript: "Queue retries\nOffline drafts\n\nSaved locally",
      },
      select: {
        id: true,
      },
      where: {
        id: "insp-photo-42",
      },
    },
  );
});

test("buildPersistPhotoAnalysisResultArgs leaves user-edited photo rawContent untouched while still storing the generated description", () => {
  const record: PhotoAnalysisPersistenceRecord = {
    id: "insp-photo-edited",
    rawContent: "User added a manual caption after upload.",
    sourceMeta: {
      fileName: "moodboard.webp",
      mimeType: "image/png",
      source: "camera",
    },
    sourceType: "PHOTO",
    transcript: null,
  };

  assert.deepEqual(
    buildPersistPhotoAnalysisResultArgs(
      record,
      createValidatedImage(),
      "  Queue   retries \r\n\tOffline drafts\u00A0\r\n\r\n\r\n  Saved locally  ",
    ),
    {
      data: {
        generatedDescription: "Queue retries\nOffline drafts\n\nSaved locally",
        ocrText: "Queue retries\nOffline drafts\n\nSaved locally",
        processingState: {
          fields: {
            generatedDescription: {
              status: "COMPLETED",
            },
            ocrText: {
              status: "COMPLETED",
            },
          },
          status: "COMPLETED",
        },
        sourceMeta: {
          description: "Queue retries\nOffline drafts\n\nSaved locally",
          fileName: "moodboard.webp",
          height: 720,
          mimeType: "image/webp",
          ocrText: "Queue retries\nOffline drafts\n\nSaved locally",
          sizeBytes: 4,
          source: "camera",
          width: 1280,
        },
        transcript: "Queue retries\nOffline drafts\n\nSaved locally",
      },
      select: {
        id: true,
      },
      where: {
        id: "insp-photo-edited",
      },
    },
  );
});

test("buildPersistPhotoAnalysisResultArgs rejects OCR payloads that become empty after whitespace normalization", () => {
  assert.throws(
    () =>
      buildPersistPhotoAnalysisResultArgs(
        {
          id: "insp-photo-42",
          rawContent: "moodboard.webp",
          sourceType: "PHOTO",
        },
        createValidatedImage(),
        " \r\n\t\u00A0\r\n\u200B ",
      ),
    new TypeError(PHOTO_ANALYSIS_EXTRACTION_EMPTY_ERROR),
  );
});

test("buildPersistPhotoAnalysisResultArgs rejects non-photo inspirations", () => {
  assert.throws(
    () =>
      buildPersistPhotoAnalysisResultArgs(
        {
          id: "insp-text-1",
          rawContent: "Text note",
          sourceType: "TEXT_NOTE",
        },
        createValidatedImage(),
        "Visible OCR text",
      ),
    new TypeError(PHOTO_ANALYSIS_PERSISTENCE_SOURCE_TYPE_INVALID_ERROR),
  );
});

test("persistPhotoAnalysisResult reads the photo capture and writes back the normalized extraction text", async () => {
  const readCalls: Array<ReturnType<typeof buildReadPhotoAnalysisRecordArgs>> = [];
  const updateCalls: Array<
    ReturnType<typeof buildPersistPhotoAnalysisResultArgs>
  > = [];
  const client: PhotoAnalysisPersistenceClient = {
    inspiration: {
      async findUnique(args) {
        readCalls.push(args);
        return {
          id: "insp-photo-42",
          rawContent: "moodboard.webp",
          sourceMeta: {
            fileName: "moodboard.webp",
          },
          sourceType: "PHOTO",
          transcript: null,
        };
      },
      async update(args) {
        updateCalls.push(args);
        return {
          id: "insp-photo-42",
        };
      },
    },
  };

  await persistPhotoAnalysisResult(
    client,
    " insp-photo-42 ",
    createValidatedImage(),
    "  OCR text for the uploaded board  ",
  );

  assert.deepEqual(readCalls, [buildReadPhotoAnalysisRecordArgs("insp-photo-42")]);
  assert.deepEqual(updateCalls, [
    buildPersistPhotoAnalysisResultArgs(
      {
        id: "insp-photo-42",
        rawContent: "moodboard.webp",
        sourceMeta: {
          fileName: "moodboard.webp",
        },
        sourceType: "PHOTO",
        transcript: null,
      },
      createValidatedImage(),
      "OCR text for the uploaded board",
    ),
  ]);
  assert.equal(updateCalls[0]?.data.rawContent, "OCR text for the uploaded board");
});

test("persistPhotoAnalysisResult fails clearly when the queued inspiration cannot be found", async () => {
  const client: PhotoAnalysisPersistenceClient = {
    inspiration: {
      async findUnique() {
        return null;
      },
      async update() {
        throw new Error("update should not be called when the inspiration is missing");
      },
    },
  };

  await assert.rejects(
    persistPhotoAnalysisResult(
      client,
      "insp-photo-missing",
      createValidatedImage(),
      "Visible OCR text",
    ),
    new Error(PHOTO_ANALYSIS_PERSISTENCE_CAPTURE_NOT_FOUND_ERROR),
  );
});
