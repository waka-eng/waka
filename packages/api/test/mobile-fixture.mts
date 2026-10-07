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
  return { email, password, profileId: profile!.id, inspirationId: inspiration!.id };
}
const primary = await seed('native-one@example.test', 'Native fixture one');
const secondary = await seed('native-two@example.test', 'Native fixture two');
const app = new Hono<AuthEnv>();
const requests: Array<{ method: string; path: string; status: number; actor: string }> = [];
app.use('/api/*', async (c, next) => {
  await next();
  const actor = c.get('session')?.profile.id;
  requests.push({ method: c.req.method, path: c.req.path, status: c.res.status,
    actor: actor === primary.profileId ? 'primary' : actor === secondary.profileId ? 'secondary' : 'anonymous' });
  if (requests.length > 500) requests.shift();
});
app.use('/api/*', mobileCors);
app.get('/api/mobile-fixture/audit', c => c.json({ requests }));
app.get('/api/mobile-fixture/context', async c => {
  const [latest] = await fixture.sql`SELECT id FROM inspirations WHERE profile_id = ${primary.profileId} ORDER BY created_at DESC, id DESC LIMIT 1`;
  return c.json({ primary: { ...primary, newestInspirationId: latest?.id ?? primary.inspirationId }, secondary });
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
