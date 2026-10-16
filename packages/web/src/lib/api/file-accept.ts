/**
 * WHAT "ADD FILE" MAY OFFER AND SEND — notes and chats alike (2026-10-15).
 *
 * Mirrors `FILE_ATTACHMENT_CONTENT_TYPES` in
 * `packages/api/src/lib/inspiration-attachment-input.ts`: PDF, plain text /
 * Markdown / CSV, RTF, the Office formats and their OpenDocument twins, and
 * the common photo formats (a file picker hands over a photo as readily as a
 * PDF). Same 25 MiB cap as a photo.
 *
 * Like `PHOTO_ACCEPT`, `FILE_ACCEPT` is the door, not the lock: the server
 * refuses any other type at finalize, and S3's HEAD must agree with the
 * declared type and size. `inspectAttachmentFile` exists so a refused file
 * is refused BEFORE it is uploaded, with a reason code the UI turns into
 * copy (no sentence is thrown from here — see `PhotoRefused` for why).
 */

export const MAX_ATTACHMENT_FILE_BYTES = 25 * 1024 * 1024;

export const FILE_ATTACHMENT_CONTENT_TYPES = [
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/rtf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.oasis.opendocument.presentation",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/heic",
  "image/heif",
] as const;
export type FileAttachmentContentType = (typeof FILE_ATTACHMENT_CONTENT_TYPES)[number];

/**
 * Browsers often report no type (or a vendor alias) for these, so the
 * extension decides when `file.type` is empty or not on the list.
 */
const BY_EXTENSION: Record<string, FileAttachmentContentType> = {
  pdf: "application/pdf", txt: "text/plain", text: "text/plain", md: "text/markdown", markdown: "text/markdown",
  csv: "text/csv", rtf: "application/rtf", doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text", ods: "application/vnd.oasis.opendocument.spreadsheet",
  odp: "application/vnd.oasis.opendocument.presentation",
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", avif: "image/avif",
  heic: "image/heic", heif: "image/heif",
};

/** For `<input type="file" accept={FILE_ACCEPT}>`: every type, then every extension. */
export const FILE_ACCEPT = [...FILE_ATTACHMENT_CONTENT_TYPES, ...Object.keys(BY_EXTENSION).map((ext) => `.${ext}`)].join(",");

const allowed = new Set<string>(FILE_ATTACHMENT_CONTENT_TYPES);

/** The content type to presign and finalize with, or null when the file is not on the list. */
export function attachmentFileContentType(file: Pick<File, "name" | "type">): FileAttachmentContentType | null {
  const declared = file.type.trim().toLowerCase();
  if (allowed.has(declared)) return declared as FileAttachmentContentType;
  const dot = file.name.lastIndexOf(".");
  const ext = dot >= 0 ? file.name.slice(dot + 1).toLowerCase() : "";
  // An empty or generic browser guess may be corrected by the extension; a
  // specific type that is not on the list (an .exe renamed .pdf) may not.
  if (!GENERIC_GUESSES.has(declared)) return null;
  return BY_EXTENSION[ext] ?? null;
}
const GENERIC_GUESSES = new Set(["", "application/octet-stream", "text/x-markdown", "application/x-markdown"]);

export type FileRefusalReason = "empty" | "too_large" | "unsupported";
export class FileRefused extends Error {
  constructor(readonly reason: FileRefusalReason) {
    super(reason);
    this.name = "FileRefused";
  }
}

/** Refuse before uploading; returns the content type every later step must use. */
export function inspectAttachmentFile(file: File): { file: File; contentType: FileAttachmentContentType; kind: "image" | "file" } {
  if (!file.size) throw new FileRefused("empty");
  if (file.size > MAX_ATTACHMENT_FILE_BYTES) throw new FileRefused("too_large");
  const contentType = attachmentFileContentType(file);
  if (!contentType) throw new FileRefused("unsupported");
  return { file, contentType, kind: contentType.startsWith("image/") ? "image" : "file" };
}
