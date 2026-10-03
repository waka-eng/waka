import { sql } from 'drizzle-orm';
import { attachments, type AttachmentEnrichmentKind, type AttachmentEnrichmentStatus } from '../db/index.js';

// Every model/retrieval path reads one effective attachment, not an AI
// transcript and a correction as two independent supporting experiences.
const corrected = sql`${attachments.type} = 'audio' AND ${attachments.transcriptCorrection} IS NOT NULL`;
export const effectiveAttachmentText = sql<string | null>`CASE WHEN ${corrected} THEN ${attachments.transcriptCorrection} ELSE ${attachments.enrichmentText} END`;
export const effectiveAttachmentKind = sql<AttachmentEnrichmentKind | null>`CASE WHEN ${corrected} THEN 'audio_transcription'::attachment_enrichment_kind ELSE ${attachments.enrichmentKind} END`;
export const effectiveAttachmentStatus = sql<AttachmentEnrichmentStatus | null>`CASE WHEN ${corrected} THEN 'ready'::attachment_enrichment_status ELSE ${attachments.enrichmentStatus} END`;
