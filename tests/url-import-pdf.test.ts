import assert from "node:assert/strict";
import test from "node:test";
import { deflateSync } from "node:zlib";

import {
  URL_IMPORT_PDF_EXTRACTION_EMPTY_ERROR,
  extractUrlImportPdfText,
} from "../apps/web/src/import/url-import-pdf.ts";

function escapePdfLiteralString(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

function createPdfContentStream(text: string): string {
  return `BT\n/F1 12 Tf\n72 720 Td\n(${escapePdfLiteralString(text)}) Tj\nET`;
}

function createCompressedPdfContentStream(parts: string[]): string {
  const arrayItems = parts.map((part) => `(${escapePdfLiteralString(part)})`).join(" -120 ");

  return `BT\n/F1 12 Tf\n72 720 Td\n[${arrayItems}] TJ\nET`;
}

function buildPdfDocument(
  streamContent: Uint8Array,
  options: {
    compressed?: boolean;
  } = {},
): Uint8Array {
  const contentStream = options.compressed ? deflateSync(streamContent) : streamContent;
  const streamDictionary = `<< /Length ${contentStream.byteLength}${options.compressed ? " /Filter /FlateDecode" : ""} >>`;
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n",
    `4 0 obj\n${streamDictionary}\nstream\n${Buffer.from(contentStream).toString("latin1")}\nendstream\nendobj\n`,
    "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
  ];
  let pdfDocument = "%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n";
  const offsets = [0];

  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdfDocument, "latin1"));
    pdfDocument += object;
  }

  const xrefOffset = Buffer.byteLength(pdfDocument, "latin1");

  pdfDocument += `xref\n0 ${objects.length + 1}\n`;
  pdfDocument += "0000000000 65535 f \n";

  for (let index = 1; index <= objects.length; index += 1) {
    pdfDocument += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }

  pdfDocument += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Uint8Array.from(Buffer.from(pdfDocument, "latin1"));
}

test("extractUrlImportPdfText extracts text from a basic PDF when pdf-parse is unavailable", async () => {
  const bytes = buildPdfDocument(
    Uint8Array.from(Buffer.from(createPdfContentStream("Hello from Waka PDF import."), "latin1")),
  );

  const result = await extractUrlImportPdfText(bytes);

  assert.equal(result.parser, "fallback");
  assert.equal(result.pageCount, 1);
  assert.equal(result.text, "Hello from Waka PDF import.");
});

test("extractUrlImportPdfText extracts text from Flate-compressed PDF streams", async () => {
  const bytes = buildPdfDocument(
    Uint8Array.from(
      Buffer.from(
        createCompressedPdfContentStream([
          "Compressed ",
          "PDF",
          " text extraction",
        ]),
        "latin1",
      ),
    ),
    {
      compressed: true,
    },
  );

  const result = await extractUrlImportPdfText(bytes, {
    loadPdfParseModule: async () => null,
  });

  assert.equal(result.parser, "fallback");
  assert.equal(result.text, "Compressed PDF text extraction");
});

test("extractUrlImportPdfText prefers pdf-parse output when the parser is available", async () => {
  const bytes = buildPdfDocument(
    Uint8Array.from(Buffer.from(createPdfContentStream("Fallback content."), "latin1")),
  );

  const result = await extractUrlImportPdfText(bytes, {
    loadPdfParseModule: async () => async () => ({
      numpages: 7,
      text: "  Parsed by pdf-parse.\n\n",
    }),
  });

  assert.equal(result.parser, "pdf-parse");
  assert.equal(result.pageCount, 7);
  assert.equal(result.text, "Parsed by pdf-parse.");
});

test("extractUrlImportPdfText falls back when pdf-parse throws", async () => {
  const bytes = buildPdfDocument(
    Uint8Array.from(Buffer.from(createPdfContentStream("Recovered by fallback."), "latin1")),
  );

  const result = await extractUrlImportPdfText(bytes, {
    loadPdfParseModule: async () => async () => {
      throw new Error("pdf-parse could not read the document");
    },
  });

  assert.equal(result.parser, "fallback");
  assert.equal(result.text, "Recovered by fallback.");
});

test("extractUrlImportPdfText rejects PDFs without extractable text", async () => {
  const bytes = buildPdfDocument(
    Uint8Array.from(Buffer.from("q 0 0 0 rg 0 0 10 10 re f Q", "latin1")),
  );

  await assert.rejects(
    async () =>
      extractUrlImportPdfText(bytes, {
        loadPdfParseModule: async () => null,
      }),
    new RegExp(URL_IMPORT_PDF_EXTRACTION_EMPTY_ERROR),
  );
});
