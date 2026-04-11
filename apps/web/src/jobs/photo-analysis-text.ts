export const PHOTO_ANALYSIS_EXTRACTION_EMPTY_ERROR =
  "Photo analysis must produce a non-empty OCR extraction result.";

export function normalizePhotoAnalysisPlainText(value: unknown): string {
  if (typeof value !== "string") {
    throw new TypeError(PHOTO_ANALYSIS_EXTRACTION_EMPTY_ERROR);
  }

  // Preserve paragraph boundaries while stripping common OCR spacing noise.
  const normalizedValue = value
    .replace(/[\u200B-\u200D\uFEFF]/gu, "")
    .replace(/\r\n?|\u2028|\u2029/gu, "\n")
    .replace(/[^\S\n]+/gu, " ")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();

  if (normalizedValue.length === 0) {
    throw new TypeError(PHOTO_ANALYSIS_EXTRACTION_EMPTY_ERROR);
  }

  return normalizedValue;
}
