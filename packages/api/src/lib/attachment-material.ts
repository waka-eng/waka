import { sql } from 'drizzle-orm';
import { attachments, type AttachmentEnrichmentKind, type AttachmentEnrichmentStatus } from '../db/index.js';

// Every model/retrieval path reads one effective attachment, not an AI
// reading and a correction as two independent supporting experiences. A
// correction is the owner's fix of what the machine heard (audio) or read
// (the words in an image); either way the owner's words replace the machine's.
export const correctedAttachment = sql<boolean>`(${attachments.type} IN ('audio','image') AND ${attachments.transcriptCorrection} IS NOT NULL)`;
const corrected = correctedAttachment;
/* AN IMAGE'S FIX REPLACES ITS WORDS, NOT WHAT IT SHOWS. A stored image
   reading is two parts, "Words: …" and "Image: …" (`describeImage`); the
   owner corrects only the first. So the effective text is their words PLUS
   the machine's description of the picture, composed in the same shape —
   without it, signals, embeddings and chat lost what the screenshot was of
   (code review, 2026-11-08). A description from before the two-part shape
   has no marker, so it is kept whole as the Image part. Audio is unchanged:
   a transcript's fix is the whole transcript. */
/* AS TOLERANT AS `readImageWords` (code review, 2026-11-08): the labels may
   follow a preamble line, carry markdown (**Words:**, ## Image:) and any case;
   the Image part is re-labelled plainly so every reader sees one shape. */
const WORDS_MARK = sql.raw(String.raw`'(^|\n)[[:space:]>#*_]*words[[:space:]*_]*:'`);
const IMAGE_FROM = sql.raw(String.raw`'\n[[:space:]>#*_]*[Ii][Mm][Aa][Gg][Ee][[:space:]*_]*:.*$'`);
const IMAGE_LABEL = sql.raw(String.raw`'^\n[[:space:]>#*_]*image[[:space:]*_]*:[[:space:]*_]*'`);
const imagePart = sql<string>`CASE
  WHEN ${attachments.enrichmentStatus} <> 'ready' OR nullif(trim(coalesce(${attachments.enrichmentText},'')),'') IS NULL THEN ''
  WHEN ${attachments.enrichmentText} ~* ${WORDS_MARK}
    THEN coalesce(regexp_replace(substring(${attachments.enrichmentText} from ${IMAGE_FROM}), ${IMAGE_LABEL}, chr(10) || 'Image: ', 'i'),'')
  ELSE chr(10) || 'Image: ' || trim(${attachments.enrichmentText}) END`;
export const effectiveAttachmentText = sql<string | null>`CASE
  WHEN ${corrected} AND ${attachments.type} = 'image' THEN 'Words: ' || ${attachments.transcriptCorrection} || ${imagePart}
  WHEN ${corrected} THEN ${attachments.transcriptCorrection}
  ELSE ${attachments.enrichmentText} END`;
export const effectiveAttachmentKind = sql<AttachmentEnrichmentKind | null>`CASE WHEN ${corrected} THEN (CASE WHEN ${attachments.type} = 'audio' THEN 'audio_transcription' ELSE 'image_description' END)::attachment_enrichment_kind ELSE ${attachments.enrichmentKind} END`;
export const effectiveAttachmentStatus = sql<AttachmentEnrichmentStatus | null>`CASE WHEN ${corrected} THEN 'ready'::attachment_enrichment_status ELSE ${attachments.enrichmentStatus} END`;
