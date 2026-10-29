/** Opt-in verification of the actual vision/transcription adapters. Inputs
 * are synthetic fixtures, never an account's archive. No DB or app server.
 * Prepare speech with audio-transcription-eval.ts (without --live), then run
 * this with --fixtures=<directory> --output=<results.json> --live.
 * Requires local ffmpeg for phone-container checks. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parse } from 'dotenv';
import { fixtureImageBytes, FIXTURE_IMAGE_MARKER } from './fixture-server.js';

const args = process.argv.slice(2);
const value = (name: string) => args.find(arg => arg.startsWith(`${name}=`))?.slice(name.length + 1);
assert.ok(args.includes('--live'), 'Explicit --live is required for paid model calls');
const directory = value('--fixtures');
const output = value('--output');
assert.ok(directory && output, '--fixtures and --output are required');
const configured = parse(await readFile('.env.local'));
if (!process.env.OPENROUTER_API_KEY && configured.OPENROUTER_API_KEY) process.env.OPENROUTER_API_KEY = configured.OPENROUTER_API_KEY;
if (!process.env.GEMINI_API_KEY && configured.GEMINI_API_KEY) process.env.GEMINI_API_KEY = configured.GEMINI_API_KEY;
assert.ok(process.env.OPENROUTER_API_KEY, 'OPENROUTER_API_KEY is required');
assert.ok(process.env.GEMINI_API_KEY, 'GEMINI_API_KEY is required for the active transcription model');
// Same restrictions as the app; an unavailable eligible endpoint must fail.
for (const name of ['WAKA_OPENROUTER_DATA_COLLECTION', 'WAKA_OPENROUTER_REQUIRE_ZDR']) {
  if (process.env[name] === undefined && configured[name] !== undefined) process.env[name] = configured[name];
}
const { transcribeAudio, AUDIO_TRANSCRIPTION_MODEL } = await import('../../packages/api/src/lib/audio-transcription.js');
const { describeImage, IMAGE_DESCRIPTION_MODEL } = await import('../../packages/api/src/lib/image-description.js');
const protocol = JSON.parse(await readFile(join(directory, 'protocol.json'), 'utf8'));
const samples: Array<{ id: string; reference: string; path: string; mime: string }> = protocol.samples
  .map((sample: { id: string; reference: string; mime: string }) => ({ ...sample, path: join(directory, `${sample.id}.wav`) }));
for (const id of ['english', 'korean']) {
  for (const [extension, codec, mime] of [['m4a', 'aac', 'audio/mp4'], ['webm', 'libopus', 'audio/webm']] as const) {
    const path = join(directory, `${id}.${extension}`);
    const converted = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', join(directory, `${id}.wav`), '-c:a', codec, path], { encoding: 'utf8' });
    assert.equal(converted.status, 0, `Cannot prepare ${id}.${extension}`);
    samples.push({ id: `${id}-${extension}`, reference: samples.find(sample => sample.id === id)!.reference, path, mime });
  }
}
const normalize = (text: string) => text.normalize('NFKC').toLowerCase().replace(/3/g, '세').replace(/5/g, '다섯').replace(/[\p{P}\p{Z}\s]/gu, '');
function distance(a: string, b: string) {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(row[j-1]! + 1, previous[j]! + 1, previous[j-1]! + (a[i-1] === b[j-1] ? 0 : 1));
    previous = row;
  }
  return previous[b.length]!;
}
const results: Array<Record<string, unknown>> = [];
const criteria = { speechMaxNormalizedCer: .05, nonSpeechMustBeEmpty: true, maxRequests: 11,
  limitations: ['Synthetic speech/images only', 'One attempt per fixture', 'No physical microphones or noisy speech tested'] };
async function record(result: Record<string, unknown>) {
  results.push(result);
  await writeFile(resolve(output!), JSON.stringify({ criteria, observedAt: new Date().toISOString(),
    models: { image: IMAGE_DESCRIPTION_MODEL, audio: AUDIO_TRANSCRIPTION_MODEL }, results }, null, 2));
  // Full synthetic transcripts stay in the local evidence file, not stdout.
  console.log(JSON.stringify({ id: result.id, passed: result.passed, elapsedMs: result.elapsedMs, normalizedCer: result.normalizedCer, error: result.error }));
}
const image = fixtureImageBytes();
let started = performance.now();
try {
  const description = await describeImage({ bytes: image, contentType: 'image/png' });
  await record({ id: 'image-ocr', sha256: createHash('sha256').update(image).digest('hex'), description,
    passed: description.includes(FIXTURE_IMAGE_MARKER), elapsedMs: Math.round(performance.now() - started) });
} catch {
  await record({ id: 'image-ocr', passed: false, error: 'description_failed', elapsedMs: Math.round(performance.now() - started) });
}
for (const sample of samples) {
  assert.ok(results.length < criteria.maxRequests, 'Request budget reached');
  const bytes = await readFile(sample.path);
  started = performance.now();
  try {
    const result = await transcribeAudio({ bytes, contentType: sample.mime });
    const expected = normalize(sample.reference), received = normalize(result.transcript);
    const cer = expected ? distance(expected, received) / expected.length : received.length ? 1 : 0;
    await record({ id: sample.id, mime: sample.mime, sha256: result.audioHash, transcript: result.transcript,
      reference: sample.reference, durationSeconds: result.durationSeconds, normalizedCer: cer,
      passed: sample.reference ? cer <= criteria.speechMaxNormalizedCer : result.transcript === '', elapsedMs: Math.round(performance.now() - started) });
  } catch {
    await record({ id: sample.id, passed: false, error: 'transcription_failed', elapsedMs: Math.round(performance.now() - started) });
  }
}
console.log(JSON.stringify({ requests: results.length, passed: results.filter(row => row.passed).length }));
assert.ok(results.every(row => row.passed), 'Media verification did not pass; retain the failed measurements');
