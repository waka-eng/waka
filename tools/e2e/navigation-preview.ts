/** Disposable, read-only browser preview for navigation/search QA.
 * Actual auth + Hono + SQL, production web build. No model calls or remote
 * data. Visit the printed loopback URL with the browser of your choice.
 * Stop with Ctrl-C; the isolated fixture schema is then removed.
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { createTestDatabase } from '../../packages/api/test/helpers/db.js';

const configured = process.env.DB_CONNECTION_URL;
assert.ok(configured, 'Explicitly set DB_CONNECTION_URL to disposable loopback Postgres');
const database = new URL(configured);
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname), 'Remote databases are refused');
assert.match(database.pathname, /test|disposable/i);
assert.equal(database.searchParams.has('options'), false);
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'navigation-preview-disposable-secret-only';
process.env.WAKA_BACKGROUND_JOB_AUTODRAIN = '0';
delete process.env.WAKA_BACKGROUND_WORKER_FUNCTION;
delete process.env.AWS_LAMBDA_FUNCTION_NAME;
delete process.env.GEMINI_API_KEY;
delete process.env.OPENROUTER_API_KEY;
globalThis.fetch = async () => { throw new Error('Provider network is disabled for this preview'); };
const fixture = await createTestDatabase();
database.searchParams.set('options', `-c search_path=${fixture.schemaName}`);
process.env.DB_CONNECTION_URL = database.toString();
const { app } = await import('../../packages/api/src/index.js');
const { signSessionToken, buildSessionCookie } = await import('../../packages/api/src/lib/auth.js');
const { createSessionRow } = await import('../../packages/api/src/lib/session.js');
const { getDb } = await import('../../packages/api/src/lib/db.js');
const [account] = await fixture.sql`INSERT INTO accounts(email,onboarding_completed_at) VALUES ('navigation@example.test',now()) RETURNING id`;
const [profile] = await fixture.sql`INSERT INTO profiles(account_id,type,name) VALUES (${account.id},'human','Navigation preview') RETURNING id`;
const [peerAccount] = await fixture.sql`INSERT INTO accounts(email) VALUES ('navigation-peer@example.test') RETURNING id`;
const [peer] = await fixture.sql`INSERT INTO profiles(account_id,type,name) VALUES (${peerAccount.id},'human','Bo') RETURNING id`;
/* THE SEEDED ROOM WENT (2026-10-15). This imported `createGroupForProfile`
   and `joinGroupByCode` from `routes/groups-membership.js`, deleted with the
   room routes -- so the dynamic import threw at startup and this preview
   could not boot at all. `peer` stays: a second human is what the search and
   navigation QA this tool exists for actually needs. */
const [older] = await fixture.sql`INSERT INTO inspirations(profile_id,text,visibility,created_at)
  VALUES (${profile.id},'A garden leaves space for things to grow in their own time.','private','2023-01-04T12:00:00Z') RETURNING id`;
const [answer] = await fixture.sql`INSERT INTO reflections(profile_id,inspiration_id,question,answer,created_at)
  VALUES (${profile.id},${older.id},'What made you want to keep this?','I like making space for an idea before deciding what it should become.','2023-01-04T12:01:00Z') RETURNING id`;
await fixture.sql`INSERT INTO reflections(profile_id,inspiration_id,question,answer,created_at)
  VALUES (${profile.id},${older.id},'Where could you make more space?','A quieter start to a project.','2023-01-04T12:02:00Z')`;
await fixture.sql`INSERT INTO inspirations(profile_id,text,created_at)
  SELECT ${profile.id}, 'A little observation from walk ' || i, '2024-01-01'::timestamptz + i * interval '1 hour' FROM generate_series(1,2001) AS i`;
/* `publicSource` IS NO LONGER BOUND: its only reader was the deleted
   `publicInspirationUrl`. The row is still INSERTed -- a public inspiration
   is ordinary fixture data for search QA -- it just has no name now. */
await await fixture.sql`INSERT INTO inspirations(profile_id,text,visibility)
  VALUES (${peer.id},'Walking without a destination gives me time to notice.','public') RETURNING id`;
const token = await signSessionToken({ profileId: profile.id, email: 'navigation@example.test' });
await createSessionRow({ profileId: profile.id, token });
const port = Number(process.env.WAKA_NAVIGATION_PREVIEW_PORT ?? 3013);
assert.ok(Number.isInteger(port) && port > 1024 && port < 65536);
const origin = `http://127.0.0.1:${port}`;
const dist = resolve('packages/web/dist');
const contentTypes: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', origin);
    if (url.pathname.startsWith('/api/')) {
      if (request.method !== 'GET') { response.writeHead(405); response.end('This fixture is read-only'); return; }
      const result = await app.fetch(new Request(url, { headers: request.headers as HeadersInit }));
      response.writeHead(result.status, Object.fromEntries(result.headers)); response.end(Buffer.from(await result.arrayBuffer())); return;
    }
    const path = url.pathname.startsWith('/assets/') ? resolve(dist, `.${url.pathname}`) : resolve(dist, 'index.html');
    assert.ok(path.startsWith(dist + '/'));
    response.writeHead(200, { 'Content-Type': contentTypes[extname(path)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store', ...(path.endsWith('index.html') ? { 'Set-Cookie': buildSessionCookie(token, { secure: false }) } : {}) });
    response.end(await readFile(path));
  } catch (error) { console.error(error); if (!response.headersSent) response.writeHead(500); response.end('Preview failed'); }
});
await new Promise<void>((done) => server.listen(port, '127.0.0.1', done));
/* `groupUrl`, `publicInspirationUrl` and `groupId` left this report with the
   room they addressed: the room those URLs addressed is gone (the `/w/:wall/:label?` ROUTE is still declared at `main.tsx:233`; what no longer exists is a room to put in it). `publicSource` is
   still seeded -- a public inspiration is ordinary fixture data now, not a
   room's contents. */
console.log(JSON.stringify({ origin, inspirationUrl: `${origin}/inspirations/${older.id}?reflection=${answer.id}`,
  schema: fixture.schemaName, archiveTotal: 2002 }));
let closing = false;
async function close() {
  if (closing) return; closing = true;
  await new Promise<void>((done) => server.close(() => done()));
  await fixture.cleanup(); await getDb().$client.end(); process.exit(0);
}
process.once('SIGINT', () => void close()); process.once('SIGTERM', () => void close());
