/** Manual browser → real authenticated routes → real queue/SQL journey.
 * Only provider output/vectors are synthetic. API requests are bridged into
 * the actual Hono app, so this proves the connected local loop, not deployed
 * transport or model quality. Requires a production web preview on 3012.
 * DB_CONNECTION_URL must explicitly name a disposable loopback database.
 */
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestDatabase } from '../../packages/api/test/helpers/db.js';
import type { ModelProvider } from '../../packages/api/src/lib/model-provider.js';
import type { InspirationProcessingStatus } from '../../packages/api/src/lib/inspiration-processing-status.js';
import { launchChromium } from './browser.js';

const configured = process.env.DB_CONNECTION_URL;
assert.ok(configured, 'Set DB_CONNECTION_URL explicitly to disposable local Postgres');
const url = new URL(configured);
assert.ok(['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname), 'This journey refuses remote databases');
assert.ok(/(?:test|disposable)/i.test(url.pathname), 'Use a database explicitly named test/disposable');
assert.equal(url.searchParams.has('options'), false, 'The harness owns its isolated search path');
process.env.WAKA_BACKGROUND_JOB_AUTODRAIN = '0';
process.env.JWT_SECRET = 'connected-learning-disposable-session-secret-000000';
process.env.NODE_ENV = 'test';
delete process.env.WAKA_BACKGROUND_WORKER_FUNCTION;
delete process.env.AWS_LAMBDA_FUNCTION_NAME;
delete process.env.OPENROUTER_API_KEY;
// The embedding constructor still needs a key; its transport is replaced below.
process.env.GEMINI_API_KEY = 'synthetic-no-network-key';
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('The connected journey forbids provider network access'); };

const t = await createTestDatabase();
url.searchParams.set('options', `-c search_path=${t.schemaName}`);
process.env.DB_CONNECTION_URL = url.toString();
const { getDb } = await import('../../packages/api/src/lib/db.js');
const { app } = await import('../../packages/api/src/index.js');
const { signSessionToken } = await import('../../packages/api/src/lib/auth.js');
const { createSessionRow } = await import('../../packages/api/src/lib/session.js');
const { drainBackgroundJobs } = await import('../../packages/api/src/lib/queue.js');
const { setDefaultModelProviderForTests } = await import('../../packages/api/src/lib/model-provider.js');
const { GeminiEmbeddingHttpClient } = await import('../../packages/api/src/lib/inspiration-embeddings.js');
const embed = GeminiEmbeddingHttpClient.prototype.embed;
GeminiEmbeddingHttpClient.prototype.embed = async () => [1, ...new Array<number>(767).fill(0)];
const origin = 'http://127.0.0.1:3012';
const output = mkdtempSync(join(tmpdir(), 'waka-connected-learning-'));
const answers = ['The evening felt unhurried.', 'Taking a quiet walk helps me choose.', 'I might leave more space in the afternoon.'];
const statement = 'Quiet walks help me choose';
const wording = 'A little quiet may help you choose.';
let extractionCalls = 0, assessmentCalls = 0, synthesisCalls = 0;
setDefaultModelProviderForTests({
  name: 'connected-journey-fixture',
  askReflectionQuestion: async (input) => ({ question: input.reflections.length === 1 ? 'What helped you decide?' : 'What would you try next?' }),
  extractSignalCandidates: async (input) => {
    extractionCalls += 1;
    return { statements: input.reflections.some((row) => row.answer === answers[1]) ? [{ statement, quote: answers[1]! }] : [] };
  },
  assessSignalSupport: async (input) => {
    assessmentCalls += 1;
    const source = input.sources.find((row) => row.kind === 'reflection' && row.text.endsWith(`\nAnswer: ${answers[1]}`));
    return { assessments: input.claims.map((claim) => ({ signalId: claim.signalId,
      verdict: source ? 'supported' : 'unsupported', sourceIds: source ? [source.id] : [] })) };
  },
  judgeSignalMatch: async () => ({ relation: 'same' }),
  synthesizeTopOfMind: async (input) => {
    synthesisCalls += 1;
    return { entries: [{ type: 'hypothesis', body: wording, citedSignalIds: input.signals.map((row) => row.id) }] };
  },
  distillPrinciples: async () => { throw new Error('This journey does not buy principle generation'); },
  judgePrincipleRelation: async () => { throw new Error('Unexpected principle relation'); },
  routeDeclaration: async () => { throw new Error('Unexpected declaration routing'); },
} satisfies ModelProvider);
let browser: Awaited<ReturnType<typeof launchChromium>> | undefined;

try {
  browser = await launchChromium({ headless: true });
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    await t.truncateAll();
    const [account] = await t.sql`INSERT INTO accounts(email, onboarding_completed_at)
      VALUES (${`connected-${viewport.width}@example.test`}, now()) RETURNING id`;
    const [profile] = await t.sql`INSERT INTO profiles(account_id, type, name)
      VALUES (${account.id}, 'human', 'Connected journey') RETURNING id`;
    const token = await signSessionToken({ profileId: profile.id as string, email: `connected-${viewport.width}@example.test` });
    await createSessionRow({ profileId: profile.id as string, token });
    const context = await browser.newContext({ viewport, serviceWorkers: 'block', reducedMotion: 'reduce',
      isMobile: viewport.width < 500, hasTouch: viewport.width < 500 });
    await context.addCookies([{ name: 'waka_session', value: token, url: origin, httpOnly: true, sameSite: 'Lax' }]);
    const errors: string[] = [];
    const failures: string[] = [];
    await context.route('**/*', async (route) => {
      const request = route.request(), path = new URL(request.url()).pathname;
      if (!path.startsWith('/api/')) return new URL(request.url()).origin === origin ? route.continue() : route.abort();
      const response = await app.fetch(new Request(request.url(), { method: request.method(), headers: request.headers(),
        ...(request.postData() ? { body: request.postData()! } : {}) }));
      // The save journal checks a new intent before its first POST; a 404
      // with this exact code is the normal absence check, not a failed save.
      const missingIntent = response.status === 404 && path.includes('/inspirations/save-requests/') &&
        (await response.clone().json() as { code?: string }).code === 'save_not_found';
      if (response.status >= 400 && !missingIntent) failures.push(`${request.method()} ${path}: ${response.status}`);
      await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    page.on('pageerror', (error) => errors.push(error.message));
    const api = (path: string, method = 'GET', body?: unknown) => app.request(`/api${path}`, {
      method, headers: { cookie: `waka_session=${token}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const drain = async () => {
      const result = await drainBackgroundJobs({ limit: 30, now: new Date(Date.now() + 1000) });
      assert.equal(result.failed, 0); assert.equal(result.retried, 0); assert.equal(result.deferred, 0);
    };
    try {
      await page.goto(origin);
      await page.getByRole('button', { name: 'Capture inspiration', exact: true }).click();
      await page.getByRole('textbox', { name: 'Capture inspiration', exact: true }).fill('An unhurried evening');
      await page.getByRole('button', { name: 'Save and reflect on this inspiration', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'reflect on what you just kept', exact: true });
      await dialog.waitFor();
      const [source] = await t.sql`SELECT id FROM inspirations WHERE profile_id = ${profile.id}`;
      const status = async () => await (await api(`/inspirations/${source.id}/processing`)).json() as InspirationProcessingStatus;
      assert.equal((await status()).phase, 'queued');
      for (let index = 0; index < answers.length; index += 1) {
        await dialog.locator('textarea').fill(answers[index]!);
        const committed = page.waitForResponse((response) => response.request().method() === 'POST' &&
          new URL(response.url()).pathname === `/api/inspirations/${source.id}/reflections`);
        await dialog.getByRole('button', { name: 'continue →', exact: true }).click();
        assert.equal((await committed).status(), 201);
        await drain();
        await dialog.locator('textarea').waitFor();
        const rows = await t.sql`SELECT answer FROM reflections WHERE inspiration_id = ${source.id} ORDER BY created_at, id`;
        assert.deepEqual(rows.map((row) => row.answer), answers.slice(0, index + 1));
      }
      let progress = await status();
      if (progress.phase === 'waiting') {
        assert.equal(progress.result, null);
        // Exercise the real manual-cadence override, not a clock/database edit.
        assert.equal((await api('/top-of-mind/refresh', 'POST', {})).status, 202);
        await drain(); progress = await status();
      }
      assert.equal(progress.phase, 'ready');
      assert.ok(progress.result?.topOfMindId);
      const [reading] = await t.sql`SELECT id FROM top_of_minds WHERE id = ${progress.result.topOfMindId} AND profile_id = ${profile.id}`;
      assert.ok(reading);
      await dialog.getByRole('button', { name: 'Check progress', exact: true }).click();
      await dialog.getByRole('button', { name: 'See reading', exact: true }).click();
      await page.locator('.jar-poster[data-jar-chrome="1"]').getByText(wording, { exact: true }).waitFor();
      await page.screenshot({ path: join(output, `reading-${viewport.width}.png`) });

      // Reopen saved answers in the real UI and retract the cited answer.
      await page.getByRole('button', { name: '1 inspiration', exact: true }).click();
      const archive = page.getByRole('listbox');
      await archive.waitFor();
      await page.waitForFunction(`(() => {
        const transform = document.querySelector('.jar-hq')?.style.transform;
        if (!transform) return false;
        const state = window.__wakaConnectedCamera ??= { transform: '', stable: 0 };
        state.stable = state.transform === transform ? state.stable + 1 : 0;
        state.transform = transform;
        return state.stable >= 8;
      })()`);
      await archive.focus();
      await archive.press('Home');
      await page.getByRole('button', { name: 'read reflection', exact: true }).click();
      const reopened = page.locator('.jar-panel');
      await reopened.locator('summary').filter({ hasText: /earlier/i }).click();
      const retracted = page.waitForResponse((response) => response.request().method() === 'DELETE' &&
        new URL(response.url()).pathname.startsWith(`/api/inspirations/${source.id}/reflections/`));
      await reopened.locator('.jar-reflection-turn').filter({ hasText: answers[1] }).getByRole('button', { name: 'take it back', exact: true }).click();
      assert.equal((await retracted).status(), 200);
      await drain();
      assert.deepEqual((await t.sql`SELECT answer FROM reflections WHERE inspiration_id = ${source.id} ORDER BY created_at, id`).map((row) => row.answer), [answers[0], answers[2]]);
      assert.equal((await t.sql`SELECT id FROM signal_evidence`).length, 0);
      const current = await (await api('/top-of-mind')).json() as { topOfMind: { entries: unknown[] } };
      assert.equal(current.topOfMind.entries.length, 0, 'The retracted answer cannot keep its generated conclusion current');
      assert.deepEqual(errors, []); assert.deepEqual(failures, []);
      console.log(`Connected journey ${viewport.width}: three answers, owned reading, cited-answer retraction passed`);
    } catch (error) {
      await page.screenshot({ path: join(output, `failure-${viewport.width}.png`) });
      console.error({ errors, failures, screenshots: output });
      throw error;
    } finally { await context.close(); }
  }
  console.log({ extractionCalls, assessmentCalls, synthesisCalls, screenshots: output, providerNetworkCalls: 0 });
} finally {
  await browser?.close();
  setDefaultModelProviderForTests(null);
  GeminiEmbeddingHttpClient.prototype.embed = embed;
  globalThis.fetch = originalFetch;
  await getDb().$client.end();
  await t.cleanup();
}
