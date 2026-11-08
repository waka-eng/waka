/**
 * "The words I read": what the person is shown under a saved screenshot.
 *
 * The machine's reading lives in `enrichmentText` (the whole description,
 * which extraction reads); the words are its first half (`readImageWords`).
 * The owner's fix lives in `transcriptCorrection`, the same column an audio
 * correction uses, so every pipeline that reads attachment text already
 * prefers it (`effectiveAttachmentText`).
 */
import type { Attachment } from '../db/index.js';
import { readImageWords } from './image-description.js';

/**
 * - reading:    the first read is queued or running.
 * - ready:      there are words to show (the machine's, or the owner's fix).
 * - unreadable: the model looked and found no words, or the image can never
 *               be read (unsupported, too large, refused). Nothing retries.
 * - retrying:   a read failed for a reason that can pass (network, rate
 *               limit, out of credit) and another attempt is due or allowed.
 */
export type ImageWordsStatus = 'reading' | 'ready' | 'unreadable' | 'retrying';

export type ImageWordsRow = Pick<Attachment, 'enrichmentStatus' | 'enrichmentText' | 'enrichmentErrorReason' |
  'enrichmentRetryCount' | 'transcriptCorrection' | 'transcriptRevision'>;

/** `analysis` is the job-aware status from `attachmentAnalysisState` when the
 * caller has it; without it the row alone decides. */
export function imageWordsState(row: ImageWordsRow, analysis?: 'pending' | 'ready' | 'failed' | 'unavailable') {
  const read = row.enrichmentStatus === 'ready' ? readImageWords(row.enrichmentText) : null;
  const machine = analysis ?? row.enrichmentStatus;
  const status: ImageWordsStatus = row.transcriptCorrection !== null ? 'ready'
    : machine === 'ready' ? (read ? 'ready' : 'unreadable')
    : machine === 'failed' ? 'retrying'
    : machine === 'pending' ? (row.enrichmentErrorReason !== null || row.enrichmentRetryCount > 0 ? 'retrying' : 'reading')
    : 'unreadable';
  return { status, text: row.transcriptCorrection ?? read, read, correction: row.transcriptCorrection,
    revision: String(row.transcriptRevision) };
}
