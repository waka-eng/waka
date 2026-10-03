/** Real auth/Hono/SQL browser fixture for C01/C02. Object storage is an in-memory
 * S3 transport; microphone input is an explicitly synthetic WebAudio tone.
 * Browser MediaRecorder/IndexedDB and the shipped composer remain real.
 * This is not evidence of physical microphones, mobile devices or AWS policy. */
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { createTestDatabase } from '../../packages/api/test/helpers/db.js';

const url = new URL(process.env.DB_CONNECTION_URL ?? '');
assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname)); assert.match(url.pathname, /test|disposable/i);
assert.equal(url.searchParams.has('options'), false);
process.env.NODE_ENV = 'test'; process.env.JWT_SECRET = 'capture-foundation-fixture-secret';
process.env.WAKA_BACKGROUND_JOB_AUTODRAIN = '0';
delete process.env.GEMINI_API_KEY; delete process.env.OPENROUTER_API_KEY;
delete process.env.WAKA_BACKGROUND_WORKER_FUNCTION; delete process.env.AWS_LAMBDA_FUNCTION_NAME;
const origin = 'http://127.0.0.1:3015';
process.env.ATTACHMENTS_BUCKET = 'capture-fixture'; process.env.ATTACHMENTS_ENDPOINT = origin;
const network = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const target = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (target.origin !== origin) return Promise.reject(new Error('Fixture forbids external provider requests'));
  return network(input, init);
};
const fixture = await createTestDatabase();
url.searchParams.set('options', `-c search_path=${fixture.schemaName}`); process.env.DB_CONNECTION_URL = url.toString();
const { app } = await import('../../packages/api/src/index.js');
const { signSessionToken, buildSessionCookie } = await import('../../packages/api/src/lib/auth.js');
const { createSessionRow } = await import('../../packages/api/src/lib/session.js');
const { getDb } = await import('../../packages/api/src/lib/db.js');
const [account] = await fixture.sql`INSERT INTO accounts(email,onboarding_completed_at) VALUES ('capture-fixture@example.test',now()) RETURNING id`;
const [profile] = await fixture.sql`INSERT INTO profiles(account_id,type,name) VALUES (${account.id},'human','Capture fixture') RETURNING id`;
await fixture.sql`INSERT INTO inspirations(profile_id,text) VALUES (${profile.id},'A little room to think.')`;
const token = await signSessionToken({ profileId: profile.id, email: 'capture-fixture@example.test' });
await createSessionRow({ profileId: profile.id, token });
const [nativeAccount] = await fixture.sql`INSERT INTO accounts(email,onboarding_completed_at) VALUES ('native-capture-fixture@example.test',now()) RETURNING id`;
const [nativeProfile] = await fixture.sql`INSERT INTO profiles(account_id,type,name) VALUES (${nativeAccount.id},'human','Native capture fixture') RETURNING id`;
const nativeToken = await signSessionToken({ profileId: nativeProfile.id, email: 'native-capture-fixture@example.test' });
await createSessionRow({ profileId: nativeProfile.id, token: nativeToken });
const objects = new Map<string, { bytes: Buffer; contentType: string }>();
// Seeded metadata tests rendering and recovery, not live extraction quality.
let linkFixtureInspirationId: string | null = null;
if (process.env.WAKA_LINK_FIXTURE === '1') {
  process.env.WAKA_ENRICHMENT_ALLOWED_HOSTS = '127.0.0.1:3015';
  const bytes = await readFile(resolve('docs/craft/evidence/personal-capture/input-photo.png'));
  objects.set('/capture-fixture/link-preview.png', { bytes, contentType: 'image/png' });
  const [source] = await fixture.sql`INSERT INTO inspirations(profile_id,text,kind)
    VALUES (${profile.id},'I want to leave more room for ideas before deciding what they should become.','link') RETURNING id`;
  linkFixtureInspirationId = source.id;
  await fixture.sql`INSERT INTO attachments(profile_id,inspiration_id,type,url,enrichment_status,enrichment_kind,enrichment_text,
    title,description,site_name,hostname,preview_image_url)
    VALUES (${profile.id},${source.id},'link','https://example.com/room-to-think','ready','page_body',
    'A seeded article excerpt about making room for unfinished thoughts. This is source material, separate from the personal note.',
    'Make room for unfinished thoughts','A quieter approach to collecting ideas and noticing the connections between them.',
    'Example journal','example.com',${`${origin}/capture-fixture/link-preview.png`})`;
  await fixture.sql`INSERT INTO attachments(profile_id,inspiration_id,type,url,enrichment_status,enrichment_error_reason)
    VALUES (${profile.id},${source.id},'link','https://example.com/members-only','unavailable','http_403')`;
}
// Opt-in, explicitly synthetic completed transcript for real UI/HTTP/SQL QA.
// It does not call a provider or pretend to be a model-quality evaluation.
let transcriptFixtureId: string | null = null;
let transcriptFixtureInspirationId: string | null = null;
if (process.env.WAKA_TRANSCRIPT_FIXTURE === '1') {
  const bytes = await readFile(resolve('packages/api/test/fixtures/audio/browser-tone.webm'));
  const key = `profiles/${profile.id}/attachments/transcript-fixture.webm`;
  const [source] = await fixture.sql`INSERT INTO inspirations(profile_id,text,kind) VALUES (${profile.id},'Transcript editing fixture','audio') RETURNING id`;
  const [row] = await fixture.sql`INSERT INTO attachments(profile_id,inspiration_id,type,url,s3_key,content_type,size,enrichment_status,enrichment_kind,enrichment_text)
    VALUES (${profile.id},${source.id},'audio',${`${origin}/capture-fixture/${key}`},${key},'audio/webm',${bytes.length},'ready','audio_transcription','Leave a little room for good work.') RETURNING id`;
  transcriptFixtureId = row.id;
  transcriptFixtureInspirationId = source.id;
  objects.set(`/capture-fixture/${key}`, { bytes, contentType: 'audio/webm' });
}
let loseResponse = false, failUpload = false, failUploadAfter = 0, uploadAttempts = 0;
async function body(request: IncomingMessage, limit: number) {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of request) { size += chunk.length; if (size > limit) throw new Error('Fixture request too large'); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
const syntheticMicrophone = `<script>
Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:async()=>{
 const context=new AudioContext(), oscillator=context.createOscillator(), destination=context.createMediaStreamDestination();
 oscillator.frequency.value=220;const gain=context.createGain();gain.gain.value=.05;oscillator.connect(gain);gain.connect(destination);oscillator.start();
 destination.stream.getAudioTracks().forEach(track=>{const stop=track.stop.bind(track);track.stop=()=>{stop();oscillator.stop();void context.close();};});
 return destination.stream;
}});
</script>`;
const dist = resolve('packages/web/dist');
const nativeDist = resolve('tools/e2e/native-capture-spike/dist');
const types: Record<string,string> = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.woff2':'font/woff2', '.svg':'image/svg+xml' };
const server = createServer(async (request, response) => {
  try {
    const target = new URL(request.url ?? '/', origin);
    if (process.env.WAKA_FIXTURE_REQUEST_LOG === '1') console.info('fixture', request.method, target.pathname);
    if (target.pathname === '/fixture/native-login') {
      response.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': buildSessionCookie(nativeToken, { secure: false }), 'Cache-Control': 'no-store' });
      response.end(JSON.stringify({ profileId: nativeProfile.id })); return;
    }
    if (target.pathname === '/favicon.ico') { response.writeHead(204); response.end(); return; }
    if (target.pathname.startsWith('/native-probe/')) {
      const suffix = target.pathname.slice('/native-probe/'.length) || 'index.html';
      const path = resolve(nativeDist, suffix); assert.ok(path.startsWith(nativeDist + '/'));
      response.writeHead(200, { 'Content-Type': types[extname(path)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
      response.end(await readFile(path)); return;
    }
    if (target.pathname === '/fixture') {
      if (target.searchParams.get('fail') === 'save-response') loseResponse = true;
      if (target.searchParams.get('fail') === 'upload') failUpload = true;
      if (target.searchParams.get('fail') === 'second-upload') failUploadAfter = 2;
      const [counts] = await fixture.sql`SELECT (SELECT count(*)::int FROM inspirations) AS inspirations,
        (SELECT count(*)::int FROM attachments) AS attachments, (SELECT count(*)::int FROM inspiration_save_requests) AS requests`;
      response.writeHead(200, {'Content-Type':'application/json'}); response.end(JSON.stringify({ ...counts, objects: objects.size,
        origin, schema: fixture.schemaName, microphone: 'synthetic tone', failUpload, loseResponse, transcriptFixtureId, transcriptFixtureInspirationId,
        linkFixtureInspirationId, uploadAttempts, failUploadAfter })); return;
    }
    if (target.pathname.startsWith('/capture-fixture/')) {
      const key = decodeURIComponent(target.pathname);
      if (request.method === 'PUT') {
        uploadAttempts += 1;
        const failThisUpload = failUploadAfter === 1;
        if (failUploadAfter > 0) failUploadAfter -= 1;
        if (failUpload || failThisUpload) { failUpload = false; response.writeHead(503); response.end(); return; }
        const bytes = await body(request, 25 * 1024 * 1024);
        objects.set(key,{bytes,contentType:String(request.headers['content-type'] ?? 'application/octet-stream')});
        response.writeHead(200,{etag:'"fixture"'}); response.end(); return;
      }
      const object = objects.get(key);
      if (!object) { response.writeHead(404); response.end(); return; }
      response.writeHead(200,{'Content-Type':object.contentType,'Content-Length':object.bytes.length});
      response.end(request.method === 'HEAD' ? undefined : object.bytes); return;
    }
    if (target.pathname.startsWith('/api/')) {
      const bytes = ['GET','HEAD'].includes(request.method ?? 'GET') ? undefined : await body(request, 1024 * 1024);
      const result = await app.fetch(new Request(target,{method:request.method,headers:request.headers as HeadersInit,...(bytes ? {body:bytes} : {})}));
      if (loseResponse && request.method === 'POST' && target.pathname === '/api/inspirations' && result.status === 201) {
        loseResponse = false; response.destroy(); return;
      }
      response.writeHead(result.status,Object.fromEntries(result.headers)); response.end(Buffer.from(await result.arrayBuffer())); return;
    }
    const path = target.pathname.startsWith('/assets/') ? resolve(dist,`.${target.pathname}`) : resolve(dist,'index.html');
    assert.ok(path.startsWith(dist + '/'));
    let bytes = await readFile(path);
    if (path.endsWith('index.html')) bytes = Buffer.from(bytes.toString().replace('<head>', '<head>' + syntheticMicrophone));
    response.writeHead(200,{'Content-Type':types[extname(path)] ?? 'application/octet-stream','Cache-Control':'no-store',
      ...(path.endsWith('index.html') ? {'Set-Cookie':buildSessionCookie(token,{secure:false})} : {})}); response.end(bytes);
  } catch (error) { console.error(error); if (!response.headersSent) response.writeHead(500); response.end('Fixture failed'); }
});
await new Promise<void>(done=>server.listen(3015,'127.0.0.1',done));
console.log(JSON.stringify({origin,schema:fixture.schemaName,profileId:profile.id,microphone:'synthetic tone',storage:'in-memory S3 transport'}));
let closing=false;
async function close(){if(closing)return;closing=true;await new Promise<void>(done=>server.close(()=>done()));await fixture.cleanup();await getDb().$client.end();process.exit(0);}
process.once('SIGINT',()=>void close());process.once('SIGTERM',()=>void close());
