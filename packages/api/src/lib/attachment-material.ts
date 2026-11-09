import { sql } from 'drizzle-orm';
import { attachments, type AttachmentEnrichmentKind, type AttachmentEnrichmentStatus } from '../db/index.js';

// Every model/retrieval path reads one effective attachment, not an AI
// reading and a correction as two independent supporting experiences. A
// correction is the owner's fix of what the machine heard (audio) or read
// (the words in an image); either way the owner's words replace the machine's.
export const correctedAttachment = sql<boolean>`(${attachments.type} IN ('audio','image') AND ${attachments.transcriptCorrection} IS NOT NULL)`;
/* AN IMAGE'S FIX REPLACES ITS WORDS, NOT WHAT IT SHOWS. A stored image
   reading is two parts, "Words: …" and "Image: …" (`describeImage`); the
   owner corrects only the first. So the effective text is their words PLUS
   the machine's description of the picture, composed in the same shape —
   without it, signals, embeddings and chat lost what the screenshot was of
   (code review, 2026-11-08). A description from before the two-part shape
   has no marker, so it is kept whole as the Image part. Audio is unchanged:
   a transcript's fix is the whole transcript. */
/* AS TOLERANT AS `readImageWords` (code review, 2026-11-08): the labels may
   follow a preamble line, carry markdown (**Words:**, ## Image:), use any
   case, and come in EITHER ORDER, on separate lines or on one — the Image
   part is read from its label to the Words label or the end, wherever it
   stands (a model that wrote "Image: …" first lost its description under a
   fix). It is re-labelled plainly so every reader sees one shape. */
/* A label starts a line, or a sentence on the same line ("Words: … . Image:
   …"), in either order — the same rule as `readImageWords`. */
const WORDS_MARK = sql.raw(String.raw`'(?:^|\n|(?<=[.!?"”''])[[:blank:]]+)[[:blank:]>#*_]*words[[:blank:]*_]*:'`);
const IMAGE_PART = sql.raw(String.raw`'(?:^|\n|(?<=[.!?"”''])[[:blank:]]+)[[:blank:]>#*_]*image[[:blank:]*_]*:[[:space:]*_]*((?:(?!(?:\n|(?<=[.!?"”''])[[:blank:]]+)[[:blank:]>#*_]*words[[:blank:]*_]*:).)*)'`);
/* THE IMAGE PART AFTER THE WORDS COMES FIRST — the same rule as
   `readImageScene`: the words run from their label to the next Image label,
   and what follows that label is the picture. Only when no Image label
   follows the words is the one before them used (code review, 2026-11-08). */
const IMAGE_AFTER_WORDS = sql.raw(String.raw`'(?:^|\n|(?<=[.!?"”''])[[:blank:]]+)[[:blank:]>#*_]*words[[:blank:]*_]*:(?:(?!(?:\n|(?<=[.!?"”''])[[:blank:]]+)[[:blank:]>#*_]*image[[:blank:]*_]*:).)*(?:\n|(?<=[.!?"”''])[[:blank:]]+)[[:blank:]>#*_]*image[[:blank:]*_]*:[[:space:]*_]*(.*)$'`);
const described = sql<string>`trim(regexp_replace(coalesce((regexp_match(${attachments.enrichmentText}, ${IMAGE_AFTER_WORDS}, 'i'))[1], (regexp_match(${attachments.enrichmentText}, ${IMAGE_PART}, 'i'))[1], ''), '[[:space:]*_]+$', ''))`;
const imagePart = sql<string>`CASE
  WHEN ${attachments.enrichmentStatus} <> 'ready' OR nullif(trim(coalesce(${attachments.enrichmentText},'')),'') IS NULL THEN ''
  WHEN ${attachments.enrichmentText} ~* ${WORDS_MARK}
    THEN CASE WHEN ${described} = '' THEN '' ELSE chr(10) || 'Image: ' || ${described} END
  ELSE chr(10) || 'Image: ' || trim(${attachments.enrichmentText}) END`;
export const effectiveAttachmentText = sql<string | null>`CASE
  WHEN ${correctedAttachment} AND ${attachments.type} = 'image' THEN 'Words: ' || ${attachments.transcriptCorrection} || ${imagePart}
  WHEN ${correctedAttachment} THEN ${attachments.transcriptCorrection}
  ELSE ${attachments.enrichmentText} END`;
export const effectiveAttachmentKind = sql<AttachmentEnrichmentKind | null>`CASE WHEN ${correctedAttachment} THEN (CASE WHEN ${attachments.type} = 'audio' THEN 'audio_transcription' ELSE 'image_description' END)::attachment_enrichment_kind ELSE ${attachments.enrichmentKind} END`;
export const effectiveAttachmentStatus = sql<AttachmentEnrichmentStatus | null>`CASE WHEN ${correctedAttachment} THEN 'ready'::attachment_enrichment_status ELSE ${attachments.enrichmentStatus} END`;
