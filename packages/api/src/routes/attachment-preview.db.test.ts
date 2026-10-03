/** WHAT THIS MOCKS, AND WHY (gate G6): `authMiddleware` supplies fixture
 * principals; `previewImage` supplies remote image bytes or a fetch failure.
 * Authorization, retry budgeting, jobs and material persistence use real SQL.
 * Network/address guards are covered separately by link-preview transport tests. */
import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { afterAll, beforeEach, expect, it, vi } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../test/helpers/index.js';
import { createAttachmentRoutes } from './attachments.js';
import type { AuthEnv } from '../lib/middleware.js';
import { recoverInspirationProcessing } from '../lib/inspiration-processing-recovery.js';
import { readInspirationProcessingStatus } from '../lib/inspiration-processing-status.js';

let t: TestDatabase, sequence = 0;
const previewImage = vi.fn(async (_url: string) => ({ bytes: new Uint8Array([1, 2, 3]), contentType: 'image/png' }));
beforeEach(async () => {
  t ??= await createTestDatabase(); await t.truncateAll(); previewImage.mockClear();
  vi.stubEnv('WAKA_BACKGROUND_JOB_AUTODRAIN', '0');
});
afterAll(async () => { vi.unstubAllEnvs(); await t?.cleanup(); });
async function person(keyScoped = false) {
  const [account] = await t.sql`INSERT INTO accounts(email) VALUES (${`preview-${++sequence}@example.test`}) RETURNING id`;
  const [profile] = await t.sql`INSERT INTO profiles(account_id,type,name) VALUES (${account.id},'human','Reader') RETURNING id`;
  const app = new Hono<AuthEnv>();
  app.route('/api/attachments', createAttachmentRoutes({ getDatabase: () => t.db as never, previewImage,
    authMiddleware: async (c, next) => {
      c.set('session', { sessionId: randomUUID(), ...(keyScoped ? { keyScoped: true as const } : {}),
        account: { id: account.id, email: 'reader@example.test' },
        profile: { id: profile.id, accountId: account.id, type: 'human', name: 'Reader', preferredLocale: 'en-US' } });
      await next();
    },
  }));
  return { app, id: profile.id as string };
}
async function link(profileId: string, ready = true) {
  const [source] = await t.sql`INSERT INTO inspirations(profile_id,text,visibility) VALUES (${profileId},'My own note','public') RETURNING id`;
  const [attachment] = await t.sql`INSERT INTO attachments(profile_id,inspiration_id,type,url,enrichment_status,
    enrichment_kind,enrichment_text,title,site_name,description,preview_image_url)
    VALUES (${profileId},${source.id},'link','https://example.test/original',${ready ? 'ready' : 'failed'},
      'page_body',${ready ? 'Page words, not the user note' : null},'A useful page','Example','Short description','https://images.test/preview.png') RETURNING id`;
  return { id: attachment.id as string, sourceId: source.id as string };
}
const retry = (owner: Awaited<ReturnType<typeof person>>, id: string) => owner.app.request(`/api/attachments/${id}/analysis/retry`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
});

it('reads owner metadata without queuing and keeps machine content separate from the note', async () => {
  const owner = await person(), file = await link(owner.id);
  const response = await owner.app.request(`/api/attachments/${file.id}/details`);
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toContain('no-store');
  expect(await response.json()).toMatchObject({ attachment: { url: 'https://example.test/original', enrichment: {
    text: 'Page words, not the user note', link: { title: 'A useful page', siteName: 'Example', previewImageUrl: null },
  } }, previewImageAvailable: true, analysis: { status: 'ready', canRetry: false } });
  expect(await t.sql`SELECT id FROM background_jobs`).toHaveLength(0);
  expect((await t.sql`SELECT text FROM inspirations WHERE id=${file.sourceId}`)[0].text).toBe('My own note');
});
it('denies another account before fetching a thumbnail, even for a public inspiration', async () => {
  const owner = await person(), other = await person(), file = await link(owner.id);
  for (const path of ['details', 'preview-image']) expect((await other.app.request(`/api/attachments/${file.id}/${path}`)).status).toBe(404);
  expect((await retry(other, file.id)).status).toBe(404); expect(previewImage).not.toHaveBeenCalled();
  expect(await t.sql`SELECT id FROM background_jobs`).toHaveLength(0);
});
it('serves passive authenticated thumbnail bytes and hides remote fetch errors', async () => {
  const owner = await person(), file = await link(owner.id);
  const response = await owner.app.request(`/api/attachments/${file.id}/preview-image`);
  expect(response.status).toBe(200); expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  expect(response.headers.get('content-type')).toBe('image/png');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  expect(response.headers.get('content-security-policy')).toContain('sandbox');
  expect(response.headers.get('cache-control')).toContain('no-store');
  previewImage.mockRejectedValueOnce(new Error('PRIVATE_PROVIDER_DETAIL'));
  const failed = await owner.app.request(`/api/attachments/${file.id}/preview-image`);
  expect(failed.status).toBe(404); expect(await failed.text()).not.toContain('PRIVATE_PROVIDER_DETAIL');
  expect((await t.sql`SELECT url FROM attachments WHERE id=${file.id}`)[0].url).toBe('https://example.test/original');
});
it('retries only the failed attachment and joins an already pending retry', async () => {
  const owner = await person(), file = await link(owner.id, false);
  const [sibling] = await t.sql`INSERT INTO attachments(profile_id,inspiration_id,type,url,enrichment_status)
    VALUES (${owner.id},${file.sourceId},'link','https://example.test/ready','ready') RETURNING id`;
  expect((await retry(owner, file.id)).status).toBe(202);
  expect((await retry(owner, file.id)).status).toBe(202);
  expect((await retry(owner, sibling.id)).status).toBe(202);
  expect(await t.sql`SELECT id FROM background_jobs`).toHaveLength(1);
  expect((await t.sql`SELECT enrichment_retry_count FROM attachments WHERE id=${file.id}`)[0].enrichment_retry_count).toBe(1);
  expect((await t.sql`SELECT enrichment_retry_count FROM attachments WHERE id=${sibling.id}`)[0].enrichment_retry_count).toBe(0);
});
it('cannot bypass the attachment retry budget through whole-inspiration recovery', async () => {
  const owner = await person(), file = await link(owner.id, false);
  await t.sql`UPDATE attachments SET enrichment_retry_count=3,enrichment_retry_window_at=now() WHERE id=${file.id}`;
  const input = { profileId: owner.id, inspirationId: file.sourceId };
  expect((await retry(owner, file.id)).status).toBe(429);
  expect(await readInspirationProcessingStatus(t.db as never, input)).toMatchObject({ stage: 'enrichment', canRetry: false });
  await recoverInspirationProcessing(t.db as never, input);
  expect(await t.sql`SELECT id FROM background_jobs`).toHaveLength(0);
  await t.sql`UPDATE attachments SET enrichment_retry_window_at=now()-interval '2 hours' WHERE id=${file.id}`;
  expect((await retry(owner, file.id)).status).toBe(202);
  expect((await t.sql`SELECT enrichment_retry_count FROM attachments WHERE id=${file.id}`)[0].enrichment_retry_count).toBe(1);
});
it('does not present an exhausted crashed worker as permanently in progress', async () => {
  const owner = await person(), file = await link(owner.id, false);
  await retry(owner, file.id);
  await t.sql`UPDATE background_jobs SET status='running',attempts=max_attempts,locked_at=now()-interval '1 hour'`;
  expect(await (await owner.app.request(`/api/attachments/${file.id}/details`)).json()).toMatchObject({ analysis: { status: 'failed', canRetry: true } });
  expect((await retry(owner, file.id)).status).toBe(202);
  expect((await t.sql`SELECT status,attempts FROM background_jobs`)[0]).toEqual({ status: 'pending', attempts: 0 });
});
it('refuses writes from read-and-capture credentials and withdraws access after deletion', async () => {
  const owner = await person(true), file = await link(owner.id, false);
  expect(await (await owner.app.request(`/api/attachments/${file.id}/details`)).json()).toMatchObject({ analysis: { canRetry: false } });
  expect((await retry(owner, file.id)).status).toBe(403);
  await t.sql`DELETE FROM inspirations WHERE id=${file.sourceId}`;
  expect((await owner.app.request(`/api/attachments/${file.id}/preview-image`)).status).toBe(404);
  expect(previewImage).not.toHaveBeenCalled();
});
