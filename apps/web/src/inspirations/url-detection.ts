export type UrlDetectionSourceType = "TEXT_NOTE" | "URL_IMPORT";

export interface NormalizeUrlDetectedCaptureInput {
  rawContent: string;
  sourceType: UrlDetectionSourceType;
  sourceUrl?: string;
}

export interface NormalizeUrlDetectedCaptureResult {
  rawContent: string;
  sourceType: UrlDetectionSourceType;
  sourceUrl?: string;
}

interface DetectedCaptureUrl {
  index: number;
  matchedText: string;
  normalizedUrl: string;
}

const DETECTABLE_CAPTURE_URL_PATTERN = /\bhttps?:\/\/[^\s<>"']+/giu;
const TRAILING_DETECTED_URL_PUNCTUATION_PATTERN = /[)\]}.,!?;:]/u;
const EDGE_COMMENTARY_SEPARATOR_PATTERN =
  /^[\s\-–—:;,.()[\]{}]+|[\s\-–—:;,.()[\]{}]+$/gu;

function normalizeDetectedUrlCandidate(candidate: string): string | undefined {
  let normalizedCandidate = candidate;

  while (normalizedCandidate.length > 0) {
    try {
      return new URL(normalizedCandidate).toString();
    } catch {
      const trailingCharacter = normalizedCandidate.at(-1);

      if (
        trailingCharacter === undefined ||
        !TRAILING_DETECTED_URL_PUNCTUATION_PATTERN.test(trailingCharacter)
      ) {
        return undefined;
      }

      normalizedCandidate = normalizedCandidate.slice(0, -1);
    }
  }

  return undefined;
}

function detectCaptureUrls(rawContent: string): DetectedCaptureUrl[] {
  const detections: DetectedCaptureUrl[] = [];

  for (const match of rawContent.matchAll(DETECTABLE_CAPTURE_URL_PATTERN)) {
    const matchedText = match[0];
    const index = match.index;

    if (typeof matchedText !== "string" || typeof index !== "number") {
      continue;
    }

    const normalizedUrl = normalizeDetectedUrlCandidate(matchedText);

    if (normalizedUrl === undefined) {
      continue;
    }

    detections.push({
      index,
      matchedText,
      normalizedUrl,
    });
  }

  return detections;
}

function normalizeDetectedCommentary(value: string): string | undefined {
  const normalizedValue = value
    .trim()
    .replaceAll(EDGE_COMMENTARY_SEPARATOR_PATTERN, "")
    .trim();

  return normalizedValue.length > 0 ? normalizedValue : undefined;
}

export function normalizeUrlDetectedCapture(
  input: NormalizeUrlDetectedCaptureInput,
): NormalizeUrlDetectedCaptureResult {
  if (input.sourceType !== "TEXT_NOTE" && input.sourceType !== "URL_IMPORT") {
    return input;
  }

  if (input.sourceUrl !== undefined) {
    return {
      rawContent: input.rawContent,
      sourceType: "URL_IMPORT",
      sourceUrl: input.sourceUrl,
    };
  }

  const detections = detectCaptureUrls(input.rawContent);

  if (detections.length !== 1) {
    return {
      rawContent: input.rawContent,
      sourceType: input.sourceType,
    };
  }

  const detectedUrl = detections[0];
  const commentary = normalizeDetectedCommentary(
    `${input.rawContent.slice(0, detectedUrl.index)} ${input.rawContent.slice(
      detectedUrl.index + detectedUrl.matchedText.length,
    )}`,
  );

  return {
    rawContent: commentary ?? detectedUrl.normalizedUrl,
    sourceType: "URL_IMPORT",
    sourceUrl: detectedUrl.normalizedUrl,
  };
}
