import { ApiError, finalizeAttachment, presignAttachment, uploadToPresignedUrl } from "./api";

/**
 * THE NOTE ITSELF IS GONE — and only that (review, 2026-10-22). Finalize's
 * parent lookup answers 404 "Inspiration not found" when the note is not
 * there (deleted, or never this account's), and a 410 is the server's
 * "this was deleted" everywhere it says so. Every other 404 is about the
 * upload, not the note: presign's, the bucket's PUT, and finalize's own
 * "S3 object not found" — those are a failed upload, worth trying again.
 */
export class NoteGoneError extends Error {
  constructor(readonly cause: ApiError) { super(cause.message); this.name = "NoteGoneError"; }
}
const PARENT_GONE = "Inspiration not found";

/**
 * ═══ ONE WAY A FILE BECOMES AN ATTACHMENT ON A SAVED NOTE ═══════════════
 * presign → upload → finalize against an existing inspiration. The archive's
 * photo and file doors (`SavesOverlay`'s `attach`) and the archive's recorder
 * (`lib/archive-recorder.ts`, which `Home` owns) both call this, so the two
 * cannot drift — which profile the presign names, what the finalize sends.
 *
 * `profileId` is whose archive the note is in; `null` presigns as the
 * signed-in profile. `type` is the caller's statement about the bytes: a
 * photo that went through the sniffer is an "image", anything else a "file".
 */
export async function attachToNote(
  file: File,
  to: { noteId: string; profileId: string | null; type: "image" | "file" },
  canContinue: () => boolean = () => true,
  recovery?: { uploadedKey?: string; onUploaded: (key: string) => Promise<void> },
): Promise<void> {
  const checkOwner = () => { if (!canContinue()) throw new Error("Recording owner is no longer signed in"); };
  checkOwner();
  let key = recovery?.uploadedKey;
  if (!key) {
    const pre = await presignAttachment(
      { filename: file.name, contentType: file.type || "application/octet-stream", size: file.size },
      undefined,
      ...(to.profileId ? [{ profile: to.profileId }] as const : []),
    );
    checkOwner();
    await uploadToPresignedUrl(pre.uploadUrl, file, pre.headers);
    key = pre.key;
    await recovery?.onUploaded(key);
  }
  checkOwner();
  try {
    await finalizeAttachment({
      type: to.type,
      inspirationId: to.noteId,
      key,
      name: file.name,
      ...(file.type ? { contentType: file.type } : {}),
    });
  } catch (reason) {
    if (reason instanceof ApiError && (reason.status === 410 || (reason.status === 404 && reason.message === PARENT_GONE))) {
      throw new NoteGoneError(reason);
    }
    throw reason;
  }
}
