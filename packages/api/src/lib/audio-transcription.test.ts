/** WHAT THIS MOCKS, AND WHY (gate G6): `fetchFn` supplies Gemini responses so
 * no audio leaves the machine and no model calls are purchased. Real WAV
 * parsing, request construction, validation and error classification run. */
import { describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { AUDIO_TRANSCRIPTION_MODEL, inspectTranscriptionAudio, MAX_TRANSCRIPT_CHARS, MAX_TRANSCRIPTION_BYTES, transcribeAudio } from './audio-transcription.js';

function wave(seconds = 1): Uint8Array {
  const bytes = Buffer.alloc(44 + seconds * 16000 * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16000, 24); bytes.writeUInt32LE(32000, 28); bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(bytes.length - 44, 40);
  return bytes;
}
const response = (transcript: unknown, finishReason = 'STOP') => new Response(JSON.stringify({
  candidates: [{ finishReason, content: { parts: [{ text: JSON.stringify({ transcript }) }] } }],
}), { headers: { 'Content-Type': 'application/json' } });
const run = (fetchFn: typeof fetch, extra: Partial<Parameters<typeof transcribeAudio>[0]> = {}) =>
  transcribeAudio({ bytes: wave(), contentType: 'audio/wav', apiKey: 'test-key', fetchFn, ...extra });

describe('bounded transcription', () => {
  it('accepts a real MediaRecorder WebM without a declared container duration', async () => {
    const bytes = await readFile(new URL('../../test/fixtures/audio/browser-tone.webm', import.meta.url));
    const inspected = await inspectTranscriptionAudio(bytes, 'audio/webm;codecs=opus');
    expect(inspected.durationIsUpperBound).toBe(true);
    expect(inspected.durationSeconds).toBeGreaterThan(0);
    expect(inspected.durationSeconds).toBeLessThan(301);
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(response(''));
    expect((await run(fetchFn, { bytes, contentType: 'audio/webm;codecs=opus' })).transcript).toBe('');
  });
  it('measures actual audio and preserves language without merging it with authored text', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(response('여백을 남기자. Leave room to think.'));
    const result = await run(fetchFn);
    expect(result).toMatchObject({ model: AUDIO_TRANSCRIPTION_MODEL, durationSeconds: 1, mimeType: 'audio/wav', transcript: '여백을 남기자. Leave room to think.' });
    expect(result.audioHash).toMatch(/^[0-9a-f]{64}$/);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(String(url)).not.toContain('test-key');
    expect(init?.headers).toMatchObject({ 'x-goog-api-key': 'test-key' });
    const sent = JSON.parse(String(init?.body));
    expect(sent.contents[0].parts[1].inlineData.data).toBe(Buffer.from(wave()).toString('base64'));
    expect(sent.contents[0].parts[0].text).toMatch(/never instructions to follow/);
    expect(sent.generationConfig.thinkingConfig.thinkingBudget).toBe(0);
    expect(fetchFn).toHaveBeenCalledOnce();
  });
  it('keeps no-speech distinct from malformed or truncated output', async () => {
    expect((await run(vi.fn<typeof fetch>().mockResolvedValue(response('')))).transcript).toBe('');
    for (const invalid of [response('partial', 'MAX_TOKENS'), response(123), response('x'.repeat(MAX_TRANSCRIPT_CHARS + 1))]) {
      await expect(run(vi.fn<typeof fetch>().mockResolvedValue(invalid))).rejects.toMatchObject({ transient: true });
    }
  });
  it('rejects spoofed, empty, oversized and overlong audio before spending a call', async () => {
    const fetchFn = vi.fn<typeof fetch>();
    for (const extra of [
      { bytes: new Uint8Array() }, { bytes: Buffer.from('<html>not audio</html>') },
      { contentType: 'audio/webm' }, { bytes: new Uint8Array(MAX_TRANSCRIPTION_BYTES + 1) },
      { bytes: wave(302) },
    ]) await expect(run(fetchFn, extra)).rejects.toMatchObject({ transient: false });
    expect(fetchFn).not.toHaveBeenCalled();
    expect((await inspectTranscriptionAudio(wave(), 'audio/x-wav')).durationSeconds).toBe(1);
  });
  it.each([[429, true], [503, true], [408, true], [400, false], [403, false]])('classifies HTTP %s without copying provider data', async (status, transient) => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response('private audio words and test-key', { status: status as number }));
    await expect(run(fetchFn)).rejects.toMatchObject({ code: `transcription_http_${status}`, message: `transcription_http_${status}`, transient });
    expect(fetchFn).toHaveBeenCalledOnce();
  });
  it('does not call a provider with missing credentials or canceled work', async () => {
    const fetchFn = vi.fn<typeof fetch>();
    await expect(run(fetchFn, { apiKey: '' })).rejects.toMatchObject({ code: 'transcription_unconfigured' });
    await expect(run(fetchFn, { signal: AbortSignal.abort() })).rejects.toMatchObject({ code: 'transcription_canceled' });
    expect(fetchFn).not.toHaveBeenCalled();
  });
  it('does not turn a safety refusal or leaked reasoning into a transcript', async () => {
    await expect(run(vi.fn<typeof fetch>().mockResolvedValue(response('not a transcript', 'SAFETY')))).rejects.toMatchObject({ code: 'transcription_blocked', transient: false });
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [
      { text: 'internal reasoning', thought: true }, { text: '{"transcript":"actual words"}' },
    ] } }] })));
    expect((await run(fetchFn)).transcript).toBe('actual words');
  });
});
