import { finalizeAttachment, presignAttachment, uploadToPresignedUrl } from "./api";

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
): Promise<void> {
  const pre = await presignAttachment(
    { filename: file.name, contentType: file.type || "application/octet-stream", size: file.size },
    undefined,
    ...(to.profileId ? [{ profile: to.profileId }] as const : []),
  );
  await uploadToPresignedUrl(pre.uploadUrl, file, pre.headers);
  await finalizeAttachment({
    type: to.type,
    inspirationId: to.noteId,
    key: pre.key,
    name: file.name,
    ...(file.type ? { contentType: file.type } : {}),
  });
}
