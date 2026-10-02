/** WHAT THIS MOCKS, AND WHY (gate G6): `read` supplies stored bytes and
 * `transcribe` supplies provider outcomes. The shipped enrichment adapter
 * classifies them without AWS access, actual audio capture or paid calls. */
import { expect, it, vi } from 'vitest';
import { enrichAudioAttachment } from './audio-enrichment.js';
import { AudioTranscriptionError } from './audio-transcription.js';
const attachment = { s3Key: 'profiles/owner/attachments/clip.webm', contentType: 'audio/webm' };
const read = async () => new Uint8Array([1, 2, 3]);
it('produces audio enrichment rather than authored words', async () => {
  const transcribe = vi.fn().mockResolvedValue({ transcript: 'Keep room for good work.' });
  expect(await enrichAudioAttachment(attachment, { read, transcribe })).toEqual({ status: 'ready', kind: 'audio_transcription', reason: null, text: 'Keep room for good work.' });
  expect(transcribe).toHaveBeenCalledWith({ bytes: new Uint8Array([1, 2, 3]), contentType: 'audio/webm' });
});
it('keeps no-speech distinct from failed work', async () => {
  expect(await enrichAudioAttachment(attachment, { read, transcribe: vi.fn().mockResolvedValue({ transcript: '' }) })).toEqual({ status: 'unavailable', reason: 'audio_no_speech' });
  expect(await enrichAudioAttachment(attachment, { read, transcribe: vi.fn().mockRejectedValue(new AudioTranscriptionError('transcription_http_429', true)) })).toEqual({ status: 'failed', reason: 'transcription_http_429' });
});
it('never reads arbitrary audio URLs or retains transport error details', async () => {
  const reader = vi.fn().mockRejectedValue(new Error('private signed URL and secret'));
  expect(await enrichAudioAttachment({ s3Key: null, contentType: 'audio/webm' }, { read: reader })).toEqual({ status: 'unavailable', reason: 'audio_upload_required' });
  expect(reader).not.toHaveBeenCalled();
  expect(await enrichAudioAttachment(attachment, { read: reader })).toEqual({ status: 'failed', reason: 'audio_transcription_failed' });
});
