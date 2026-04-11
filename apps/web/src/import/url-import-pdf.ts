import { inflateSync } from "node:zlib";

export const URL_IMPORT_PDF_EXTRACTION_EMPTY_ERROR =
  "PDF did not contain extractable text.";

type PdfParseInvocationResult = {
  numpages?: unknown;
  text?: unknown;
};

type PdfParseFunction = (
  input: Buffer | Uint8Array,
) =>
  | PdfParseInvocationResult
  | Promise<PdfParseInvocationResult>;

type PdfToken =
  | {
      kind: "operand";
      value: PdfOperand;
    }
  | {
      kind: "operator";
      value: string;
    };

type PdfOperand = number | string | PdfOperand[];

export interface ExtractUrlImportPdfTextOptions {
  loadPdfParseModule?: () => Promise<PdfParseFunction | null>;
}

export interface ExtractUrlImportPdfTextResult {
  pageCount?: number;
  parser: "fallback" | "pdf-parse";
  text: string;
}

const PDF_NUMBER_PATTERN = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;

function readPositiveInteger(value: unknown): number | undefined {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : undefined;
}

function normalizeExtractedPdfText(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .replaceAll("\u0000", "")
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizePdfTextBytes(value: Uint8Array): Uint8Array {
  if (!(value instanceof Uint8Array)) {
    throw new TypeError("PDF bytes must be a Uint8Array.");
  }

  if (value.byteLength < 1) {
    throw new TypeError(URL_IMPORT_PDF_EXTRACTION_EMPTY_ERROR);
  }

  return value;
}

function isMissingPdfParseModuleError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const maybeCode = "code" in error ? error.code : undefined;

  return (
    maybeCode === "ERR_MODULE_NOT_FOUND" ||
    maybeCode === "MODULE_NOT_FOUND" ||
    /Cannot find package 'pdf-parse'/.test(error.message) ||
    /Cannot find module 'pdf-parse'/.test(error.message)
  );
}

async function defaultLoadPdfParseModule(): Promise<PdfParseFunction | null> {
  const pdfParseModuleId = "pdf-parse";

  try {
    const module = (await import(pdfParseModuleId)) as {
      default?: unknown;
    };

    return typeof module.default === "function"
      ? (module.default as PdfParseFunction)
      : null;
  } catch (error) {
    if (isMissingPdfParseModuleError(error)) {
      return null;
    }

    throw error;
  }
}

async function tryExtractPdfTextWithPdfParse(
  bytes: Uint8Array,
  loadPdfParseModule: () => Promise<PdfParseFunction | null>,
): Promise<ExtractUrlImportPdfTextResult | null> {
  const pdfParse = await loadPdfParseModule();

  if (pdfParse === null) {
    return null;
  }

  const result = await pdfParse(Buffer.from(bytes));
  const text = normalizeExtractedPdfText(result.text);

  if (text.length === 0) {
    return null;
  }

  return {
    ...(readPositiveInteger(result.numpages) === undefined
      ? {}
      : { pageCount: readPositiveInteger(result.numpages) }),
    parser: "pdf-parse",
    text,
  };
}

function decodePdfTextBytes(bytes: Uint8Array): string {
  if (
    bytes.byteLength >= 2 &&
    bytes[0] === 0xfe &&
    bytes[1] === 0xff &&
    (bytes.byteLength - 2) % 2 === 0
  ) {
    const littleEndian = new Uint8Array(bytes.byteLength - 2);

    for (let index = 2; index < bytes.byteLength; index += 2) {
      littleEndian[index - 2] = bytes[index + 1] ?? 0x00;
      littleEndian[index - 1] = bytes[index];
    }

    return Buffer.from(littleEndian).toString("utf16le");
  }

  if (bytes.byteLength >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return Buffer.from(bytes.subarray(2)).toString("utf16le");
  }

  return Buffer.from(bytes).toString("latin1");
}

function isPdfWhitespaceCharacter(character: string | undefined): boolean {
  return (
    character === "\u0000" ||
    character === "\t" ||
    character === "\n" ||
    character === "\f" ||
    character === "\r" ||
    character === " "
  );
}

function isPdfDelimiterCharacter(character: string | undefined): boolean {
  return (
    character === "(" ||
    character === ")" ||
    character === "<" ||
    character === ">" ||
    character === "[" ||
    character === "]" ||
    character === "{" ||
    character === "}" ||
    character === "/" ||
    character === "%"
  );
}

function skipPdfWhitespaceAndComments(source: string, startIndex: number): number {
  let cursor = startIndex;

  while (cursor < source.length) {
    const character = source[cursor];

    if (isPdfWhitespaceCharacter(character)) {
      cursor += 1;
      continue;
    }

    if (character === "%") {
      cursor += 1;

      while (
        cursor < source.length &&
        source[cursor] !== "\n" &&
        source[cursor] !== "\r"
      ) {
        cursor += 1;
      }

      continue;
    }

    break;
  }

  return cursor;
}

function normalizePdfTextSegment(value: string): string {
  return value
    .replaceAll("\u0000", "")
    .replace(/\r\n?/g, " ")
    .replace(/[^\S\n]+/g, " ")
    .trim();
}

function readPdfLiteralString(
  source: string,
  startIndex: number,
): {
  nextIndex: number;
  value: string;
} {
  const bytes: number[] = [];
  let cursor = startIndex + 1;
  let depth = 1;

  while (cursor < source.length) {
    const character = source[cursor];

    if (character === "\\") {
      const escapedCharacter = source[cursor + 1];

      if (escapedCharacter === undefined) {
        cursor += 1;
        break;
      }

      if (
        escapedCharacter >= "0" &&
        escapedCharacter <= "7"
      ) {
        let octalDigits = escapedCharacter;
        let octalCursor = cursor + 2;

        while (
          octalCursor < source.length &&
          octalDigits.length < 3 &&
          source[octalCursor] !== undefined &&
          source[octalCursor] >= "0" &&
          source[octalCursor] <= "7"
        ) {
          octalDigits += source[octalCursor];
          octalCursor += 1;
        }

        bytes.push(Number.parseInt(octalDigits, 8));
        cursor = octalCursor;
        continue;
      }

      switch (escapedCharacter) {
        case "n":
          bytes.push(0x0a);
          cursor += 2;
          continue;
        case "r":
          bytes.push(0x0d);
          cursor += 2;
          continue;
        case "t":
          bytes.push(0x09);
          cursor += 2;
          continue;
        case "b":
          bytes.push(0x08);
          cursor += 2;
          continue;
        case "f":
          bytes.push(0x0c);
          cursor += 2;
          continue;
        case "(":
        case ")":
        case "\\":
          bytes.push(escapedCharacter.charCodeAt(0));
          cursor += 2;
          continue;
        case "\r":
          cursor += 2;

          if (source[cursor] === "\n") {
            cursor += 1;
          }

          continue;
        case "\n":
          cursor += 2;
          continue;
        default:
          bytes.push(escapedCharacter.charCodeAt(0));
          cursor += 2;
          continue;
      }
    }

    if (character === "(") {
      depth += 1;
      bytes.push(character.charCodeAt(0));
      cursor += 1;
      continue;
    }

    if (character === ")") {
      depth -= 1;

      if (depth === 0) {
        return {
          nextIndex: cursor + 1,
          value: decodePdfTextBytes(Uint8Array.from(bytes)),
        };
      }

      bytes.push(character.charCodeAt(0));
      cursor += 1;
      continue;
    }

    bytes.push(character.charCodeAt(0));
    cursor += 1;
  }

  return {
    nextIndex: cursor,
    value: decodePdfTextBytes(Uint8Array.from(bytes)),
  };
}

function readPdfHexString(
  source: string,
  startIndex: number,
): {
  nextIndex: number;
  value: string;
} {
  let cursor = startIndex + 1;
  let hex = "";

  while (cursor < source.length && source[cursor] !== ">") {
    if (!isPdfWhitespaceCharacter(source[cursor])) {
      hex += source[cursor];
    }

    cursor += 1;
  }

  if (hex.length % 2 === 1) {
    hex += "0";
  }

  const bytes = new Uint8Array(hex.length / 2);

  for (let index = 0; index < hex.length; index += 2) {
    bytes[index / 2] = Number.parseInt(hex.slice(index, index + 2), 16);
  }

  return {
    nextIndex: cursor < source.length ? cursor + 1 : cursor,
    value: decodePdfTextBytes(bytes),
  };
}

function readPdfBareToken(source: string, startIndex: number): {
  nextIndex: number;
  value: string;
} {
  let cursor = startIndex;

  while (
    cursor < source.length &&
    !isPdfWhitespaceCharacter(source[cursor]) &&
    !isPdfDelimiterCharacter(source[cursor])
  ) {
    cursor += 1;
  }

  return {
    nextIndex: cursor,
    value: source.slice(startIndex, cursor),
  };
}

function readNextPdfToken(
  source: string,
  startIndex: number,
  insideArray = false,
): {
  nextIndex: number;
  token: PdfToken;
} | null {
  const cursor = skipPdfWhitespaceAndComments(source, startIndex);

  if (cursor >= source.length) {
    return null;
  }

  const character = source[cursor];

  if (character === "(") {
    const literalString = readPdfLiteralString(source, cursor);

    return {
      nextIndex: literalString.nextIndex,
      token: {
        kind: "operand",
        value: literalString.value,
      },
    };
  }

  if (character === "<" && source[cursor + 1] !== "<") {
    const hexString = readPdfHexString(source, cursor);

    return {
      nextIndex: hexString.nextIndex,
      token: {
        kind: "operand",
        value: hexString.value,
      },
    };
  }

  if (character === "[") {
    const array = readPdfArray(source, cursor);

    return {
      nextIndex: array.nextIndex,
      token: {
        kind: "operand",
        value: array.value,
      },
    };
  }

  if (character === "/") {
    const name = readPdfBareToken(source, cursor + 1);

    return {
      nextIndex: name.nextIndex,
      token: {
        kind: "operand",
        value: `/${name.value}`,
      },
    };
  }

  const bareToken = readPdfBareToken(source, cursor);
  const numericValue = Number.parseFloat(bareToken.value);

  if (
    bareToken.value.length > 0 &&
    PDF_NUMBER_PATTERN.test(bareToken.value) &&
    Number.isFinite(numericValue)
  ) {
    return {
      nextIndex: bareToken.nextIndex,
      token: {
        kind: "operand",
        value: numericValue,
      },
    };
  }

  if (insideArray || bareToken.value === "true" || bareToken.value === "false") {
    return {
      nextIndex: bareToken.nextIndex,
      token: {
        kind: "operand",
        value: bareToken.value,
      },
    };
  }

  return {
    nextIndex: bareToken.nextIndex,
    token: {
      kind: "operator",
      value: bareToken.value,
    },
  };
}

function readPdfArray(
  source: string,
  startIndex: number,
): {
  nextIndex: number;
  value: PdfOperand[];
} {
  const items: PdfOperand[] = [];
  let cursor = startIndex + 1;

  while (cursor < source.length) {
    cursor = skipPdfWhitespaceAndComments(source, cursor);

    if (cursor >= source.length) {
      break;
    }

    if (source[cursor] === "]") {
      return {
        nextIndex: cursor + 1,
        value: items,
      };
    }

    const token = readNextPdfToken(source, cursor, true);

    if (token === null) {
      break;
    }

    cursor = token.nextIndex;

    if (token.token.kind === "operand") {
      items.push(token.token.value);
    }
  }

  return {
    nextIndex: cursor,
    value: items,
  };
}

function appendPdfLineBreak(segments: string[]): void {
  if (segments[segments.length - 1] !== "\n") {
    segments.push("\n");
  }
}

function readPdfTextOperand(value: PdfOperand | undefined): string {
  if (typeof value === "string") {
    return normalizePdfTextSegment(value);
  }

  if (Array.isArray(value)) {
    return normalizePdfTextSegment(
      value
        .flatMap((item) =>
          typeof item === "string" ? [item] : Array.isArray(item) ? [] : [],
        )
        .join(""),
    );
  }

  return "";
}

function appendPdfTextSegment(segments: string[], value: PdfOperand | undefined): void {
  const text = readPdfTextOperand(value);

  if (text.length === 0) {
    return;
  }

  const lastSegment = segments[segments.length - 1];

  if (lastSegment !== undefined && lastSegment !== "\n") {
    segments.push(" ");
  }

  segments.push(text);
}

function extractPdfTextFromContentStream(content: string): string {
  const operandStack: PdfOperand[] = [];
  const segments: string[] = [];
  let cursor = 0;

  while (cursor < content.length) {
    const token = readNextPdfToken(content, cursor);

    if (token === null) {
      break;
    }

    cursor = token.nextIndex;

    if (token.token.kind === "operand") {
      operandStack.push(token.token.value);
      continue;
    }

    switch (token.token.value) {
      case "Tj":
      case "TJ":
        appendPdfTextSegment(segments, operandStack[operandStack.length - 1]);
        break;
      case "'":
      case "\"":
        appendPdfLineBreak(segments);
        appendPdfTextSegment(segments, operandStack[operandStack.length - 1]);
        break;
      case "T*":
      case "Td":
      case "TD":
      case "ET":
        appendPdfLineBreak(segments);
        break;
      default:
        break;
    }

    operandStack.length = 0;
  }

  return normalizeExtractedPdfText(segments.join(""));
}

function extractPdfStreamDictionary(
  pdfSource: string,
  streamMarkerIndex: number,
): string {
  const dictionaryStart = pdfSource.lastIndexOf("<<", streamMarkerIndex);
  const dictionaryEnd = pdfSource.lastIndexOf(">>", streamMarkerIndex);

  if (
    dictionaryStart === -1 ||
    dictionaryEnd === -1 ||
    dictionaryEnd < dictionaryStart
  ) {
    return "";
  }

  return pdfSource.slice(dictionaryStart, dictionaryEnd + 2);
}

function extractPdfContentStreams(pdfBytes: Uint8Array): Array<{
  bytes: Uint8Array;
  dictionary: string;
}> {
  const pdfSource = Buffer.from(pdfBytes).toString("latin1");
  const streams: Array<{
    bytes: Uint8Array;
    dictionary: string;
  }> = [];
  let searchIndex = 0;

  while (searchIndex < pdfSource.length) {
    const streamMarkerIndex = pdfSource.indexOf("stream", searchIndex);

    if (streamMarkerIndex === -1) {
      break;
    }

    let streamStartIndex = streamMarkerIndex + "stream".length;

    if (
      pdfSource[streamStartIndex] === "\r" &&
      pdfSource[streamStartIndex + 1] === "\n"
    ) {
      streamStartIndex += 2;
    } else if (
      pdfSource[streamStartIndex] === "\n" ||
      pdfSource[streamStartIndex] === "\r"
    ) {
      streamStartIndex += 1;
    }

    const endStreamMarkerIndex = pdfSource.indexOf("endstream", streamStartIndex);

    if (endStreamMarkerIndex === -1) {
      break;
    }

    let streamEndIndex = endStreamMarkerIndex;

    if (pdfSource[streamEndIndex - 1] === "\n") {
      streamEndIndex -= 1;

      if (pdfSource[streamEndIndex - 1] === "\r") {
        streamEndIndex -= 1;
      }
    } else if (pdfSource[streamEndIndex - 1] === "\r") {
      streamEndIndex -= 1;
    }

    streams.push({
      bytes: pdfBytes.slice(streamStartIndex, streamEndIndex),
      dictionary: extractPdfStreamDictionary(pdfSource, streamMarkerIndex),
    });

    searchIndex = endStreamMarkerIndex + "endstream".length;
  }

  return streams;
}

function decodePdfContentStream(
  stream: {
    bytes: Uint8Array;
    dictionary: string;
  },
): string | null {
  const normalizedDictionary = stream.dictionary.replace(/\s+/g, " ");
  const hasFlateDecode = /\/Filter\s*(?:\[[^\]]*\/FlateDecode[^\]]*\]|\/FlateDecode)\b/.test(
    normalizedDictionary,
  );
  const hasUnsupportedFilter =
    /\/Filter\b/.test(normalizedDictionary) && !hasFlateDecode;

  if (hasUnsupportedFilter) {
    return null;
  }

  try {
    const decodedBytes = hasFlateDecode ? inflateSync(stream.bytes) : stream.bytes;
    return Buffer.from(decodedBytes).toString("latin1");
  } catch {
    return null;
  }
}

function extractPdfTextFallback(
  bytes: Uint8Array,
): {
  pageCount?: number;
  text: string;
} {
  const pdfSource = Buffer.from(bytes).toString("latin1");
  const pageCount = readPositiveInteger(
    (pdfSource.match(/\/Type\s*\/Page\b/g) ?? []).length,
  );
  const extractedSegments = extractPdfContentStreams(bytes)
    .map((stream) => decodePdfContentStream(stream))
    .filter((stream): stream is string => typeof stream === "string")
    .map((stream) => extractPdfTextFromContentStream(stream))
    .filter((text) => text.length > 0);

  return {
    ...(pageCount === undefined ? {} : { pageCount }),
    text: normalizeExtractedPdfText(extractedSegments.join("\n\n")),
  };
}

export async function extractUrlImportPdfText(
  bytes: Uint8Array,
  options: ExtractUrlImportPdfTextOptions = {},
): Promise<ExtractUrlImportPdfTextResult> {
  const normalizedBytes = normalizePdfTextBytes(bytes);
  const loadPdfParseModule =
    options.loadPdfParseModule ?? defaultLoadPdfParseModule;
  let pdfParseFailure: unknown;

  try {
    const extractedWithPdfParse = await tryExtractPdfTextWithPdfParse(
      normalizedBytes,
      loadPdfParseModule,
    );

    if (extractedWithPdfParse !== null) {
      return extractedWithPdfParse;
    }
  } catch (error) {
    pdfParseFailure = error;
  }

  const fallbackResult = extractPdfTextFallback(normalizedBytes);

  if (fallbackResult.text.length > 0) {
    return {
      pageCount: fallbackResult.pageCount,
      parser: "fallback",
      text: fallbackResult.text,
    };
  }

  if (pdfParseFailure !== undefined) {
    throw pdfParseFailure;
  }

  throw new Error(URL_IMPORT_PDF_EXTRACTION_EMPTY_ERROR);
}
