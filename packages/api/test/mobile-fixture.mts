/** Development-only, disposable-loopback fixture for installed app journeys.
 * This entry is never imported by the Lambda/app. Its simulated provider UI
 * proves OS-browser handoff, not live Google authentication. */
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import bcrypt from 'bcryptjs';
import { createTestDatabase } from './helpers/db.js';
import { mobileCors } from '../src/lib/mobile-cors.js';
import { MOBILE_BINDING_COOKIE, readMobileBinding, issueMobileCode, mobileCallback } from '../src/lib/mobile-handoff.js';
import { getCookie } from 'hono/cookie';
import type { AuthEnv } from '../src/lib/middleware.js';

const configured = new URL(process.env.DB_CONNECTION_URL ?? 'https://invalid');
if (process.env.WAKA_MOBILE_FIXTURE_RUN !== '1' || !['127.0.0.1', 'localhost'].includes(configured.hostname) || !configured.pathname.includes('test')) {
  throw new Error('Native fixture requires an explicit disposable loopback test database.');
}
process.env.JWT_SECRET = 'synthetic-mobile-test-signing-key-only';
process.env.NODE_ENV = 'test'; // This guarded fixture serves loopback HTTP only.
process.env.PUBLIC_WEB_URL = 'http://127.0.0.1:8787';
process.env.PUBLIC_API_URL = 'http://127.0.0.1:8787';
process.env.WAKA_BACKGROUND_JOB_AUTODRAIN = '0';
delete process.env.WAKA_BACKGROUND_WORKER_FUNCTION;
delete process.env.AWS_LAMBDA_FUNCTION_NAME;
delete process.env.OPENROUTER_API_KEY; delete process.env.GEMINI_API_KEY;
const fixture = await createTestDatabase();
configured.searchParams.set('options', `-c search_path=${fixture.schemaName},public`);
process.env.DB_CONNECTION_URL = configured.toString();
const { app: realApi } = await import('../src/index.js');
const { getDb } = await import('../src/lib/db.js');
const password = 'native-fixture-password';
const passwordHash = await bcrypt.hash(password, 4);
async function seed(email: string, name: string) {
  const [account] = await fixture.sql`INSERT INTO accounts (email, password_hash, onboarding_completed_at) VALUES (${email}, ${passwordHash}, now()) RETURNING id`;
  const [profile] = await fixture.sql`INSERT INTO profiles (account_id, type, name) VALUES (${account!.id}, 'human', ${name}) RETURNING id`;
  const [inspiration] = await fixture.sql`INSERT INTO inspirations (profile_id, text) VALUES (${profile!.id}, 'A synthetic native fixture: simple tools leave room to think.') RETURNING id`;
  return { email, password, accountId: account!.id, profileId: profile!.id, inspirationId: inspiration!.id };
}
const primary = await seed('native-one@example.test', 'Native fixture one');
const secondary = await seed('native-two@example.test', 'Native fixture two');
// Optional, explicitly authored memory for native reading/history checks.
// These rows are fixtures, not evidence of model generation quality.
if (process.env.WAKA_MOBILE_FIXTURE_JOURNEYS === '1') {
  // Enough rows to exercise archive scrolling as well as search.
  await fixture.sql`INSERT INTO inspirations(profile_id,text)
    SELECT ${primary.profileId}, 'Synthetic archive background note ' || n FROM generate_series(1, 13) n`;
  const [reading] = await fixture.sql`INSERT INTO top_of_minds(profile_id) VALUES(${primary.profileId}) RETURNING id`;
  await fixture.sql`INSERT INTO top_of_mind_entries(top_of_mind_id,type,body,sort_order,locked_at)
    VALUES(${reading!.id},'pattern','I keep room to think before committing.',0,now())`;
  await fixture.sql`INSERT INTO principles(profile_id,statement,rank,origin,locked_at)
    VALUES(${primary.profileId},'Leave space for a small experiment.',0,'declared',now())`;
  const [chat] = await fixture.sql`INSERT INTO conversations(id,profile_id,revision) VALUES(gen_random_uuid(),${primary.profileId},2) RETURNING id`;
  await fixture.sql`INSERT INTO conversation_messages(id,profile_id,conversation_id,position,role,content)
    VALUES(gen_random_uuid(),${primary.profileId},${chat!.id},1,'user','How can I leave room to think?'),
    (gen_random_uuid(),${primary.profileId},${chat!.id},2,'assistant','Start with one small experiment. This is a synthetic fixture reply.')`;
}
const app = new Hono<AuthEnv>();
let failWrites = false;
const requests: Array<{ method: string; path: string; status: number; actor: string }> = [];
app.use('/api/*', async (c, next) => {
  await next();
  const actor = c.get('session')?.profile.id;
  requests.push({ method: c.req.method, path: c.req.path, status: c.res.status,
    actor: actor === primary.profileId ? 'primary' : actor === secondary.profileId ? 'secondary' : 'anonymous' });
  if (requests.length > 500) requests.shift();
});
app.use('/api/*', mobileCors);
app.use('/api/*', async (c, next) => {
  if (failWrites && c.req.method === 'POST' && !c.req.path.startsWith('/api/mobile-fixture/')) {
    return c.json({ error: 'Synthetic temporary connection failure' }, 503);
  }
  await next();
});
app.post('/api/mobile-fixture/network', async c => {
  const input = await c.req.json().catch(() => null);
  if (typeof input?.failWrites !== 'boolean') return c.json({ error: 'Expected failWrites boolean' }, 400);
  failWrites = input.failWrites;
  return c.json({ failWrites });
});
app.get('/api/mobile-fixture/audit', c => c.json({ requests }));
app.get('/api/mobile-fixture/sample.txt', c => {
  c.header('Content-Type', 'text/plain');
  c.header('Content-Disposition', 'attachment; filename="waka-media-fixture.txt"');
  return c.body('Synthetic WAKA iPhone file fixture. Leave room to think.\n');
});
app.get('/api/mobile-fixture/context', async c => {
  const [latest] = await fixture.sql`SELECT id FROM inspirations WHERE profile_id = ${primary.profileId} ORDER BY created_at DESC, id DESC LIMIT 1`;
  return c.json({ primary: { ...primary, newestInspirationId: latest?.id ?? primary.inspirationId }, secondary });
});
// Read back persisted synthetic data without exposing session/key secrets.
app.get('/api/mobile-fixture/state', async c => {
  const profiles = await fixture.sql`SELECT id,type,name,preferred_locale FROM profiles WHERE account_id=${primary.accountId} ORDER BY created_at,id`;
  const inspirations = await fixture.sql`SELECT id,profile_id,text FROM inspirations WHERE profile_id IN (SELECT id FROM profiles WHERE account_id=${primary.accountId}) ORDER BY created_at,id`;
  const conversations = await fixture.sql`SELECT id,profile_id,deleted_at FROM conversations WHERE profile_id IN (SELECT id FROM profiles WHERE account_id=${primary.accountId}) ORDER BY created_at,id`;
  const messages = await fixture.sql`SELECT conversation_id,profile_id,role,content FROM conversation_messages WHERE profile_id IN (SELECT id FROM profiles WHERE account_id=${primary.accountId}) ORDER BY created_at,id`;
  const keys = await fixture.sql`SELECT id,profile_id,label,revoked_at FROM agent_keys WHERE profile_id IN (SELECT id FROM profiles WHERE account_id=${primary.accountId})`;
  const attachments = await fixture.sql`SELECT id,profile_id,inspiration_id,message_id,type,content_type,size,name,s3_key FROM attachments WHERE profile_id IN (SELECT id FROM profiles WHERE account_id=${primary.accountId}) ORDER BY created_at,id`;
  return c.json({ profiles, inspirations, conversations, messages, keys, attachments });
});
app.post('/api/mobile-fixture/revoke', async c => {
  await fixture.sql`DELETE FROM sessions WHERE profile_id = ${primary.profileId}`;
  return c.json({ ok: true });
});
app.post('/api/mobile-fixture/expire', async c => {
  await fixture.sql`UPDATE sessions SET expires_at = now() - interval '1 second'`;
  return c.json({ ok: true });
});
app.get('/api/auth/google/login', c => c.html(`<html><body><h1>Simulated Google consent</h1><p>Only the disposable native fixture account is used.</p><form method="post" action="/api/mobile-fixture/google-complete"><button>Continue synthetic Google</button></form></body></html>`));
app.post('/api/mobile-fixture/google-complete', async c => {
  const binding = await readMobileBinding(getCookie(c, MOBILE_BINDING_COOKIE));
  if (!binding || binding.appId !== 'im.waka.app.test') return c.text('Fixture sign-in expired', 400);
  const code = await issueMobileCode(primary.profileId, binding);
  return c.redirect(mobileCallback(binding, { code }), 302);
});
app.route('/', realApi);
const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 8787 });
console.log(JSON.stringify({ fixture: true, schema: fixture.schemaName, origin: 'http://127.0.0.1:8787' }));
let stopping = false;
async function stop() {
  if (stopping) return; stopping = true;
  server.close(); await getDb().$client.end({ timeout: 2 }); await fixture.cleanup(); process.exit(0);
}
process.on('SIGINT', () => { void stop(); }); process.on('SIGTERM', () => { void stop(); });
