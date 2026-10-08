/** Explicit live, two-call check of the real queue -> S3 transport -> provider
 * -> fenced transcript/learning commit. Only synthetic WAV files are used. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse } from 'dotenv';
import { createTestDatabase } from '../../packages/api/test/helpers/db.js';

assert.ok(process.argv.includes('--live'), 'Use --live explicitly; this check makes at most two paid calls.');
const url = new URL(process.env.DB_CONNECTION_URL ?? '');
assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname)); assert.match(url.pathname, /test|disposable/i);
assert.equal(url.searchParams.has('options'), false);
const configured = parse(await readFile('.env.local').catch(error=>{if(error.code==='ENOENT')return '';throw error;}));
const apiKey = process.env.GEMINI_API_KEY ?? configured.GEMINI_API_KEY;
assert.ok(apiKey, 'GEMINI_API_KEY is required');
process.env.NODE_ENV = 'test'; process.env.WAKA_BACKGROUND_JOB_AUTODRAIN = '0'; process.env.GEMINI_API_KEY = apiKey;
delete process.env.WAKA_BACKGROUND_WORKER_FUNCTION; delete process.env.AWS_LAMBDA_FUNCTION_NAME;
delete process.env.OPENROUTER_API_KEY;
process.env.ATTACHMENTS_BUCKET = 'audio-pipeline';
const files = new Map<string, Buffer>();
const server = createServer((request, response) => {
  const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
  const bytes = files.get(path);
  if (!bytes || !['GET', 'HEAD'].includes(request.method ?? '')) { response.writeHead(404); response.end(); return; }
  response.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': bytes.length });
  response.end(request.method === 'HEAD' ? undefined : bytes);
});
await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
const address = server.address(); assert.ok(address && typeof address !== 'string');
process.env.ATTACHMENTS_ENDPOINT = `http://127.0.0.1:${address.port}`;
const fixture = await createTestDatabase();
url.searchParams.set('options', `-c search_path=${fixture.schemaName}`); process.env.DB_CONNECTION_URL = url.toString();
const { getDb } = await import('../../packages/api/src/lib/db.js');
const { drainBackgroundJobs, enqueueEnrichAttachment } = await import('../../packages/api/src/lib/queue.js');
const network = globalThis.fetch;
let calls = 0, estimatedCostUsd = 0;
globalThis.fetch = async (input, init) => {
  const target = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  assert.equal(target.origin, 'https://generativelanguage.googleapis.com');
  assert.equal(target.pathname, '/v1beta/models/gemini-2.5-flash:generateContent');
  assert.ok(calls < 2 && estimatedCostUsd < .05, 'Live call/cost cap reached'); calls += 1;
  const result = await network(input, init);
  const body = await result.clone().json() as { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number;
    promptTokensDetails?: Array<{ modality: string; tokenCount: number }> } };
  const usage = body.usageMetadata;
  if (usage) {
    const audio = usage.promptTokensDetails?.find(row => row.modality === 'AUDIO')?.tokenCount ?? usage.promptTokenCount ?? 0;
    estimatedCostUsd += (audio + Math.max(0, (usage.promptTokenCount ?? 0) - audio) * .3 +
      ((usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0)) * 2.5) / 1e6;
  }
  return result;
};
const cases: Array<Record<string, unknown>> = [];
try {
  for (const name of ['english', 'silence']) {
    await fixture.truncateAll(); files.clear();
    const bytes = await readFile(resolve(`work/audio-transcription-eval/${name}.wav`));
    const [account] = await fixture.sql`INSERT INTO accounts(email) VALUES (${`pipeline-${name}@example.test`}) RETURNING id`;
    const [profile] = await fixture.sql`INSERT INTO profiles(account_id,type,name) VALUES (${account.id},'human','Synthetic pipeline fixture') RETURNING id`;
    const [source] = await fixture.sql`INSERT INTO inspirations(profile_id,text,kind) VALUES (${profile.id},'','audio') RETURNING id`;
    const key = `profiles/${profile.id}/attachments/${name}.wav`;
    files.set(`/audio-pipeline/${key}`, bytes);
    const [audio] = await fixture.sql`INSERT INTO attachments(profile_id,inspiration_id,type,url,s3_key,content_type,size,enrichment_status)
      VALUES (${profile.id},${source.id},'audio','https://example.test/synthetic.wav',${key},'audio/wav',${bytes.length},'pending') RETURNING id`;
    await enqueueEnrichAttachment(profile.id, audio.id, source.id);
    const started = performance.now(), drained = await drainBackgroundJobs({ limit: 1 });
    const [row] = await fixture.sql`SELECT enrichment_status, enrichment_kind, enrichment_text, enrichment_error_reason, transcript_revision FROM attachments WHERE id=${audio.id}`;
    assert.equal(drained.succeeded, 1, JSON.stringify({ drained, reason: row.enrichment_error_reason }));
    if (name === 'english') {
      assert.equal(row.enrichment_status, 'ready'); assert.equal(row.enrichment_kind, 'audio_transcription');
      assert.match(row.enrichment_text, /empty space/i); assert.match(row.enrichment_text, /afternoon/i);
    } else { assert.equal(row.enrichment_status, 'unavailable'); assert.equal(row.enrichment_error_reason, 'audio_no_speech'); assert.equal(row.enrichment_text, null); }
    assert.equal(row.transcript_revision, 1);
    assert.equal((await fixture.sql`SELECT text FROM inspirations WHERE id=${source.id}`)[0]?.text, '');
    assert.equal((await fixture.sql`SELECT id FROM background_jobs WHERE type='derive_signals'`).length, 1);
    cases.push({ name, passed: true, durationMs: Math.round(performance.now() - started), bytes: bytes.length,
      status: row.enrichment_status, reason: row.enrichment_error_reason, transcriptChars: row.enrichment_text?.length ?? 0, drained });
  }
  assert.equal(calls, 2);
} finally {
  const result = { at: new Date().toISOString(), calls, maxCalls: 2, estimatedCostUsd, estimatedCapUsd: .05, cases,
    limitations: ['synthetic speech and silence', 'local object transport, not AWS policy', 'no physical device audio'] };
  await mkdir('work/audio-transcription-eval', { recursive: true });
  await writeFile('work/audio-transcription-eval/pipeline-results.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  globalThis.fetch = network;
  await new Promise<void>(done => server.close(() => done()));
  await fixture.cleanup(); await getDb().$client.end();
}
