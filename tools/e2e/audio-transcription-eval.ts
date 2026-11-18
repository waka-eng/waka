/** Bounded, opt-in speech spike for A03. Fixtures are locally synthesized
 * speech/silence/tones, never account data. Results describe these fixtures,
 * not physical microphones or noisy mobile recordings. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
assert.ok(!args.includes('--live'), 'The direct Google audio comparison is retired. Use the OpenRouter media routing tool for a separately authorized live run.');
const value = (name: string) => args.find(item => item.startsWith(name + '='))?.slice(name.length + 1);
const output = resolve(value('--output') ?? 'work/audio-transcription-eval');
const toneInput = value('--tone');
await mkdir(output, { recursive: true });
const speech = [
  { id: 'english', voice: 'Samantha', text: 'I liked the empty space in that room. Next week I want to leave one afternoon free for careful work.' },
  { id: 'korean', voice: 'Yuna', text: '오늘 본 사진은 여백이 많아서 마음에 남았다. 다음 주에는 일정을 조금 덜 채우고 중요한 일에 집중하고 싶다.' },
  { id: 'numbers', voice: 'Yuna', text: '금요일 오후 세 시에 다시 돌아보자. 다섯 분 동안 오늘 남긴 생각을 읽어 보고 싶다.' },
  { id: 'mixed-ko', voice: 'Yuna', text: '이번에는 작은 실험부터 시작하자.' },
  { id: 'mixed-en', voice: 'Samantha', text: 'Leave space for the work that matters.' },
];
for (const sample of speech) {
  const result = spawnSync('/usr/bin/say', ['-v', sample.voice, '-r', '160', '-o', join(output, `${sample.id}.wav`),
    '--file-format=WAVE', '--data-format=LEI16@16000', sample.text], { encoding: 'utf8' });
  assert.equal(result.status, 0, `Speech fixture failed: ${sample.id}: ${result.stderr}`);
}
function pcm(wave: Buffer) {
  assert.equal(wave.toString('ascii', 0, 4), 'RIFF');
  let format: Buffer | undefined, data: Buffer | undefined;
  for (let at = 12; at + 8 <= wave.length;) {
    const id = wave.toString('ascii', at, at + 4), size = wave.readUInt32LE(at + 4);
    if (id === 'fmt ') format = wave.subarray(at + 8, at + 8 + size);
    if (id === 'data') data = wave.subarray(at + 8, at + 8 + size);
    at += 8 + size + size % 2;
  }
  assert.ok(format && data); assert.equal(format.readUInt32LE(4), 16000); assert.equal(format.readUInt16LE(2), 1); assert.equal(format.readUInt16LE(14), 16);
  return data;
}
function wave(bytes: Buffer) {
  const header = Buffer.alloc(44); header.write('RIFF'); header.writeUInt32LE(bytes.length + 36, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(16000, 24);
  header.writeUInt32LE(32000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(bytes.length, 40);
  return Buffer.concat([header, bytes]);
}
await writeFile(join(output, 'mixed.wav'), wave(Buffer.concat([pcm(await readFile(join(output, 'mixed-ko.wav'))), Buffer.alloc(8000), pcm(await readFile(join(output, 'mixed-en.wav')))])));
await writeFile(join(output, 'silence.wav'), wave(Buffer.alloc(32000 * 3)));
const tone = Buffer.alloc(32000 * 3);
for (let frame = 0; frame < 48000; frame += 1) tone.writeInt16LE(Math.round(Math.sin(frame * Math.PI * 2 * 220 / 16000) * 1500), frame * 2);
await writeFile(join(output, 'tone.wav'), wave(tone));
const samples = [
  ...speech.slice(0, 3).map(sample => ({ id: sample.id, reference: sample.text, path: join(output, sample.id + '.wav'), mime: 'audio/wav' })),
  { id: 'mixed', reference: speech[3]!.text + ' ' + speech[4]!.text, path: join(output, 'mixed.wav'), mime: 'audio/wav' },
  { id: 'silence', reference: '', path: join(output, 'silence.wav'), mime: 'audio/wav' },
  { id: 'tone', reference: '', path: toneInput ? resolve(toneInput) : join(output, 'tone.wav'), mime: toneInput?.endsWith('.webm') ? 'audio/webm' : 'audio/wav' },
];
// Numbers spelled by TTS and Arabic digits are the same utterance. All other
// words remain unchanged; case/spacing/punctuation are excluded from CER.
const normalize = (text: string) => text.normalize('NFKC').toLowerCase().replace(/3/g, '세').replace(/5/g, '다섯').replace(/[\p{P}\p{Z}\s]/gu, '');
function distance(a: string, b: string) {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i]; for (let j = 1; j <= b.length; j += 1) row[j] = Math.min(row[j - 1]! + 1, previous[j]! + 1, previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    previous = row;
  }
  return previous[b.length]!;
}
const models = [
  { id: 'gemini-2.5-flash', audio: 1, text: .3, output: 2.5 },
  { id: 'gemini-2.5-flash-lite', audio: .3, text: .1, output: .4 },
];
const criteria = { speechMaxNormalizedCer: .05, nonSpeechMustBeEmpty: true, maxCalls: 12, estimatedBudgetUsd: .10,
  limitations: ['Synthetic voices and tones', 'One run per clip/model', 'Not a real-device or noise-robustness evaluation'],
  pricingSource: 'https://ai.google.dev/gemini-api/docs/pricing' };
await writeFile(join(output, 'protocol.json'), JSON.stringify({ criteria, models, samples: samples.map(({ path, ...row }) => row) }, null, 2));
if (!args.includes('--live')) { console.log(JSON.stringify({ output, prepared: samples.length, liveCalls: 0 })); process.exit(0); }
