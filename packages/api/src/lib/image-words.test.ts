import { describe, expect, it } from 'vitest';
import { imageWordsState, type ImageWordsRow } from './image-words.js';

const row = (patch: Partial<ImageWordsRow> = {}): ImageWordsRow => ({ enrichmentStatus: 'pending', enrichmentText: null,
  enrichmentErrorReason: null, enrichmentRetryCount: 0, transcriptCorrection: null, transcriptRevision: 0, ...patch });

describe('imageWordsState', () => {
  it('is reading on the first queued read', () => {
    expect(imageWordsState(row())).toEqual({ status: 'reading', text: null, read: null, correction: null, revision: '0' });
  });

  it('shows the words the machine read, without the scene description', () => {
    expect(imageWordsState(row({ enrichmentStatus: 'ready', enrichmentText: 'Words: Begin badly.\nImage: A reel caption.' })))
      .toMatchObject({ status: 'ready', text: 'Begin badly.', read: 'Begin badly.' });
  });

  it('is unreadable when the model looked and found no words, or can never read the image', () => {
    expect(imageWordsState(row({ enrichmentStatus: 'ready', enrichmentText: 'Words: none\nImage: A beach.' })).status).toBe('unreadable');
    expect(imageWordsState(row({ enrichmentStatus: 'unavailable', enrichmentErrorReason: 'image is too large to describe' })).status).toBe('unreadable');
    expect(imageWordsState(row({ enrichmentStatus: null })).status).toBe('unreadable');
  });

  it('is retrying after a transient failure, including an out-of-credit 402', () => {
    const failed = row({ enrichmentStatus: 'failed', enrichmentErrorReason: 'Image description failed (HTTP 402)' });
    expect(imageWordsState(failed).status).toBe('retrying');
    // The job is backing off: the row still says failed, the job is pending.
    expect(imageWordsState(failed, 'pending').status).toBe('retrying');
    // Recovery re-queued it: reason cleared, budget spent.
    expect(imageWordsState(row({ enrichmentRetryCount: 1 })).status).toBe('retrying');
    // The queue gave up and nothing is pending: still retryable, not unreadable.
    expect(imageWordsState(row(), 'failed').status).toBe('retrying');
  });

  it("prefers the owner's fix over any machine state", () => {
    for (const enrichmentStatus of ['pending', 'failed', 'unavailable', 'ready'] as const) {
      expect(imageWordsState(row({ enrichmentStatus, enrichmentText: enrichmentStatus === 'ready' ? 'Words: Machine\nImage: x' : null,
        transcriptCorrection: 'The line that stuck', transcriptRevision: 3 })))
        .toMatchObject({ status: 'ready', text: 'The line that stuck', correction: 'The line that stuck', revision: '3' });
    }
  });
});
