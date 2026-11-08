import { sql } from 'drizzle-orm';
import { attachments, type AttachmentEnrichmentKind, type AttachmentEnrichmentStatus } from '../db/index.js';

// Every model/retrieval path reads one effective attachment, not an AI
// reading and a correction as two independent supporting experiences. A
// correction is the owner's fix of what the machine heard (audio) or read
// (the words in an image); either way the owner's words replace the machine's.
export const correctedAttachment = sql<boolean>`(${attachments.type} IN ('audio','image') AND ${attachments.transcriptCorrection} IS NOT NULL)`;
const corrected = correctedAttachment;
export const effectiveAttachmentText = sql<string | null>`CASE WHEN ${corrected} THEN ${attachments.transcriptCorrection} ELSE ${attachments.enrichmentText} END`;
export const effectiveAttachmentKind = sql<AttachmentEnrichmentKind | null>`CASE WHEN ${corrected} THEN (CASE WHEN ${attachments.type} = 'audio' THEN 'audio_transcription' ELSE 'image_description' END)::attachment_enrichment_kind ELSE ${attachments.enrichmentKind} END`;
export const effectiveAttachmentStatus = sql<AttachmentEnrichmentStatus | null>`CASE WHEN ${corrected} THEN 'ready'::attachment_enrichment_status ELSE ${attachments.enrichmentStatus} END`;
