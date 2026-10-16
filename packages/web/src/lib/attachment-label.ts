import { t, type SupportedLocale } from './locales';

/**
 * WHAT A PHOTO, FILE OR RECORDING IS CALLED ON SCREEN — its own name, or,
 * when it came with none (a pasted picture, a clip from a share sheet), what
 * it is: "Photo", "File", "Recording".
 *
 * DISPLAY ONLY (2026-10-16). The fallback is a word in the reader's language,
 * not a fact about the upload, so it is never written into a draft or sent
 * as the attachment's `name`: an unnamed upload is stored unnamed, and every
 * reader — a Korean one later, the transcript, a search over names — decides
 * for itself what to call it. And a recording is never labelled a photo.
 */
export function attachmentLabel(locale: SupportedLocale, type: 'image' | 'file' | 'audio' | 'link', name?: string | null): string {
  if (name) return name;
  return t(locale, type === 'image' ? 'worldChatAttachmentPhotoUnnamed' : type === 'audio' ? 'worldChatAttachmentRecordingUnnamed' : 'worldChatAttachmentFileUnnamed');
}
