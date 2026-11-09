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
 * - retrying:   a read failed for a reason that can pass, and another one is
 *               QUEUED — the only state that may promise "I'll try again".
 * - failed:     a read failed and nothing is queued (the queue gave up, or
 *               the retry budget is spent). The person may ask for another
 *               (`canRetry`), or give the line themselves.
 * - unknown:    the reading predates the "Words: / Image:" shape, so which
 *               part is words cannot be told. Show nothing: no quote, no Fix,
 *               no "which line stuck?".
 */
export type ImageWordsStatus = 'reading' | 'ready' | 'unreadable' | 'retrying' | 'failed' | 'unknown';

export type ImageWordsRow = Pick<Attachment, 'enrichmentStatus' | 'enrichmentText' | 'enrichmentErrorReason' |
  'enrichmentRetryCount' | 'transcriptCorrection' | 'transcriptRevision'>;

/** `analysis` is the job-aware status from `attachmentAnalysisState` when the
 * caller has it; without it the row alone decides. */
export function imageWordsState(row: ImageWordsRow, analysis?: 'pending' | 'ready' | 'failed' | 'unavailable') {
  const words = row.enrichmentStatus === 'ready' ? readImageWords(row.enrichmentText) : null;
  const read = words ?? null;
  const machine = analysis ?? row.enrichmentStatus;
  const status: ImageWordsStatus = row.transcriptCorrection !== null ? 'ready'
    : machine === 'ready' ? (words === undefined ? 'unknown' : read ? 'ready' : 'unreadable')
    : machine === 'failed' ? 'failed'
    : machine === 'pending' ? (row.enrichmentErrorReason !== null || row.enrichmentRetryCount > 0 ? 'retrying' : 'reading')
    : 'unreadable';
  return { status, text: row.transcriptCorrection ?? read, read, correction: row.transcriptCorrection,
    revision: String(row.transcriptRevision) };
}
