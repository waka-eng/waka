import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getAttachmentsBucket } from './attachment-storage.js';
import { makeAttachmentsS3Client } from './s3-client.js';
import { AudioTranscriptionError, MAX_TRANSCRIPTION_BYTES, transcribeAudio } from './audio-transcription.js';
import type { AttachmentEnrichmentVerdict } from './signal-enrichment.js';

interface AudioAttachment { s3Key: string | null; contentType: string | null }

async function readAudio(attachment: AudioAttachment): Promise<Uint8Array> {
  if (!attachment.s3Key) throw new AudioTranscriptionError('audio_upload_required', false);
  const client = makeAttachmentsS3Client(), controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new AudioTranscriptionError('audio_read_timeout', true)); }, 30_000);
  });
  const reading = async () => {
    const object = await client.send(new GetObjectCommand({ Bucket: getAttachmentsBucket(), Key: attachment.s3Key! }), { abortSignal: controller.signal });
    if (object.ContentLength && object.ContentLength > MAX_TRANSCRIPTION_BYTES) throw new AudioTranscriptionError('audio_too_large_to_transcribe', false);
    if (!object.Body) throw new AudioTranscriptionError('audio_empty', false);
    const chunks: Uint8Array[] = []; let total = 0;
    for await (const chunk of object.Body as AsyncIterable<Uint8Array>) {
      if (controller.signal.aborted) throw new AudioTranscriptionError('audio_read_timeout', true);
      total += chunk.length;
      if (total > MAX_TRANSCRIPTION_BYTES) throw new AudioTranscriptionError('audio_too_large_to_transcribe', false);
      chunks.push(chunk);
    }
    return Buffer.concat(chunks, total);
  };
  try { return await Promise.race([reading(), timeout]); }
  finally { clearTimeout(timer); controller.abort(); client.destroy(); }
}

/** Uploaded audio only: never fetch an arbitrary user-supplied audio URL. */
export async function enrichAudioAttachment(attachment: AudioAttachment, deps: {
  read?: (attachment: AudioAttachment) => Promise<Uint8Array>;
  transcribe?: typeof transcribeAudio;
} = {}): Promise<AttachmentEnrichmentVerdict> {
  if (!attachment.s3Key) return { status: 'unavailable', reason: 'audio_upload_required' };
  try {
    const bytes = await (deps.read ?? readAudio)(attachment);
    const result = await (deps.transcribe ?? transcribeAudio)({ bytes, contentType: attachment.contentType ?? '' });
    if (!result.transcript) return { status: 'unavailable', reason: 'audio_no_speech' };
    return { status: 'ready', kind: 'audio_transcription', reason: null, text: result.transcript };
  } catch (error) {
    if (error instanceof AudioTranscriptionError) return { status: error.transient ? 'failed' : 'unavailable', reason: error.code };
    return { status: 'failed', reason: 'audio_transcription_failed' };
  }
}
