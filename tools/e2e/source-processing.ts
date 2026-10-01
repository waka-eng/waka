/** Manual rendered check of capture → reflection → explicit reading adoption.
 * All API traffic is synthetic and non-local resources are blocked. This is
 * UI evidence, not proof of a deployed worker or a live-model result.
 * Build web, serve on 127.0.0.1:3011, then `pnpm e2e:source-processing`.
 */
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChromium } from './browser.js';

const origin = 'http://127.0.0.1:3011';
const output = mkdtempSync(join(tmpdir(), 'waka-source-processing-'));
console.log(`Screenshots: ${output}`);
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const date = '2026-10-01T10:00:00.000Z';
const profile = { id: id(1), accountId: id(2), type: 'human', name: 'Preview', avatarUrl: null,
  preferredLocale: 'en-US', publicHandle: 'preview', publicProfileEnabled: true, publicTopOfMindEnabled: true };
const viewer = { account: { id: id(2), email: 'preview@example.test', onboardingCompletedAt: date, isAdmin: false }, profile };
const before = 'You make room for quiet work.';
const after = 'You leave space for others to add their ideas.';
const reading = (version: number) => ({ id: id(20 + version), profileId: profile.id, version, reason: 'regenerated', createdAt: date,
  generationRevision: String(version), supportChanged: false, entries: [{ id: id(30 + version), type: 'pattern',
    body: version === 1 ? before : after, belief: null, prompt: null, locked: false, pinned: false, dismissed: false,
    sortOrder: 0, citedSignals: [{ id: id(100), statement: 'Small openings make room for new ideas.' }], createdAt: date }] });
const browser = await launchChromium({ headless: true });
try {
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport, serviceWorkers: 'block', reducedMotion: 'reduce',
      isMobile: viewport.width < 500, hasTouch: viewport.width < 500 });
    const unknown = new Set<string>(), pageErrors: string[] = [];
    const inspirations = ['A quiet walk makes room for a new idea.', 'Small choices can change how a day feels.', 'Good work leaves space to think.']
      .map((text, index) => ({ id: id(10 + index), profileId: profile.id, text, textPreview: text, kind: 'note', source: 'app',
        visibility: 'private', createdAt: date, updatedAt: date, attachments: [], attachmentSummary: [], reflections: [] as unknown[], reflectionCount: 0 }));
    let version = 1, status: 'queued' | 'processing' | 'ready' | 'failed' = 'queued';
    let saveCount = 0, answerCount = 0, retryCount = 0, generationCount = 0;
    let sourceId = id(50), revision = 1;
    const receipt = () => ({ id: id(60 + revision), profileId: profile.id, inspirationId: sourceId,
      materialRevision: String(revision), jobId: id(70), requestVersion: String(revision) });
    const savedRequests = new Map<string, { requestId: string; operation: 'inspiration' | 'reflection'; inspirationId: string;
      reflectionId: string | null; processing: ReturnType<typeof receipt>; createdAt: string }>();
    const progress = () => ({ profileId: profile.id, inspirationId: sourceId, receipt: receipt(),
      currentMaterialRevision: String(revision), requestedMaterialRevision: String(revision),
      latestDerivedRevision: status === 'ready' ? String(revision) : '0', latestCompletedRevision: status === 'ready' ? String(revision) : '0',
      superseded: false, phase: status, stage: status === 'ready' ? null : 'derivation', runAfter: null,
      result: status === 'ready' ? { kind: 'top_of_mind', topOfMindId: id(20 + version), version, outcome: 'changed' } : null,
      unavailableAttachments: 0, canRetry: status === 'failed' });
    await context.route('**/*', async (route) => {
      const request = route.request(), url = new URL(request.url());
      if (!url.pathname.startsWith('/api/')) return url.origin === origin ? route.continue() : route.abort();
      const path = url.pathname.slice(4);
      const send = (json: unknown, code = 200) => route.fulfill({ status: code, json });
      if (path === '/auth/me') return send(viewer);
      if (path === '/profiles') return send({ profiles: [profile] });
      if (path.startsWith('/inspirations/save-requests/')) {
        const saved = savedRequests.get(path.split('/').at(-1)!);
        return saved ? send({ saveRequest: saved }) : send({ error: 'No committed save found', code: 'save_not_found' }, 404);
      }
      if (path === '/inspirations' && request.method() === 'POST') {
        assert.equal(url.searchParams.get('profile'), profile.id);
        const requestId = request.headers()['idempotency-key'];
        assert.match(requestId!, /^[0-9a-f-]{36}$/);
        const previous = savedRequests.get(requestId!);
        if (previous) return send({ inspiration: inspirations.find((item) => item.id === previous.inspirationId),
          processing: previous.processing, saveRequest: { requestId, replayed: true } });
        saveCount += 1; sourceId = id(50 + saveCount); revision = 1; status = 'queued';
        const text = request.postDataJSON().text;
        const source = { ...inspirations[0]!, id: sourceId, text, textPreview: text, reflections: [] };
        inspirations.push(source);
        const processing = receipt();
        savedRequests.set(requestId!, { requestId: requestId!, operation: 'inspiration', inspirationId: source.id, reflectionId: null, processing, createdAt: date });
        return send({ inspiration: source, processing, saveRequest: { requestId, replayed: false } }, 201);
      }
      if (path === '/inspirations') return send({ inspirations, total: inspirations.length });
      if (path === `/inspirations/${sourceId}/processing`) return send(progress());
      if (path === `/inspirations/${sourceId}/processing/retry`) { retryCount += 1; status = 'queued'; return send(progress(), 202); }
      if (path === `/inspirations/${sourceId}/reflections` && request.method() === 'POST') {
        assert.equal(url.searchParams.get('profile'), profile.id);
        const requestId = request.headers()['idempotency-key'];
        assert.match(requestId!, /^[0-9a-f-]{36}$/);
        const previous = savedRequests.get(requestId!);
        if (previous) return send({ reflection: inspirations.find((item) => item.id === previous.inspirationId)?.reflections.find((item) => (item as { id: string }).id === previous.reflectionId),
          processing: previous.processing, saveRequest: { requestId, replayed: true } });
        answerCount += 1; revision += 1; status = 'queued';
        const reflection = { id: id(80 + answerCount), inspirationId: sourceId, ...request.postDataJSON(), skipped: false, createdAt: date };
        const source = inspirations.find((item) => item.id === sourceId)!;
        source.reflections.push(reflection); source.reflectionCount += 1;
        const processing = receipt();
        savedRequests.set(requestId!, { requestId: requestId!, operation: 'reflection', inspirationId: sourceId, reflectionId: reflection.id, processing, createdAt: date });
        return send({ reflection, processing, saveRequest: { requestId, replayed: false } }, 201);
      }
      if (path === `/inspirations/${sourceId}/reflection-question`) return send({ phase: 'ready', question: 'What could someone else add to that unfinished corner?' });
      if (/^\/inspirations\/[^/]+$/.test(path)) return send({ inspiration: inspirations.find((item) => item.id === path.split('/')[2]) });
      const signal = { id: id(100), statement: 'Small openings make room for new ideas.', status: 'active', confidence: 80,
        evidenceCount: 3, lastEvidenceAt: date, locked: false, unsupported: false, sharedGroupIds: [], createdAt: date };
      if (path === '/signals') return send({ signals: [signal] });
      if (path === `/signals/${signal.id}`) return send({ signal: { ...signal, evidence: inspirations.slice(0, 3).map((item) => ({
        inspirationId: item.id, preview: item.text, quote: item.text, quoteSource: 'own', reason: null, createdAt: date,
      })) } });
      if (path === '/groups') return send({ groups: [] });
      if (path === '/experiences') return send({ experiences: [] });
      if (path === '/principles') return send({ principles: [] });
      if (path === '/principles/status') return send({ status: { phase: 'waiting', eligible: false, signalCount: 0, topOfMindCount: 0 } });
      if (path === '/top-of-mind/refresh') { generationCount += 1; return send({ jobId: id(90), requestVersion: '1', status: 'queued' }, 202); }
      if (path === '/top-of-mind') return send({ topOfMind: reading(version) });
      if (path === '/top-of-mind/versions') return send({ versions: Array.from({ length: version }, (_, index) => ({ ...reading(index + 1), entryCount: 1 })) });
      if (path.startsWith('/top-of-mind/versions/')) return send({ topOfMind: reading(path.endsWith(id(21)) ? 1 : 2) });
      if (path === '/weather') return send({ weather: { told: null, days: [], antechamber: [] } });
      unknown.add(`${request.method()} ${path}`);
      return send({ error: 'Unconfigured synthetic request' }, 404);
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    page.on('pageerror', (error) => pageErrors.push(error.message));
    try {
    await page.goto(origin);
    const poster = page.locator('.jar-poster[data-jar-chrome="1"]');
    await poster.waitFor();
    assert.equal((await poster.textContent())?.trim(), before);
    await page.getByRole('button', { name: 'Capture inspiration', exact: true }).click();
    await page.getByRole('textbox', { name: 'Capture inspiration', exact: true }).fill('An unfinished corner invites someone else to add something.');
    await page.getByRole('button', { name: 'Save and reflect on this inspiration', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'reflect on what you just kept', exact: true });
    await dialog.waitFor();
    await dialog.getByText('Kept. Waiting to be read.', { exact: true }).waitFor();
    await dialog.locator('textarea').fill('Leaving room lets the next person surprise me.');
    await dialog.getByRole('button', { name: 'continue →', exact: true }).click();
    await dialog.getByText('What could someone else add to that unfinished corner?', { exact: true }).waitFor();
    await dialog.locator('textarea').fill('My unfinished answer must stay here.');
    status = 'ready'; version = 2;
    await dialog.getByRole('button', { name: 'Check progress', exact: true }).click();
    await dialog.getByRole('button', { name: 'See reading', exact: true }).waitFor();
    assert.equal(await dialog.locator('textarea').inputValue(), 'My unfinished answer must stay here.');
    const bounds = await dialog.boundingBox();
    assert.ok(bounds && bounds.y >= 0 && bounds.y + bounds.height <= viewport.height, 'Following an answer must not clip the dialog');
    assert.equal(await page.locator('.jar').evaluate((element) => element.scrollTop), 0, 'Only the dialog scrolls, never the world');
    assert.equal(await page.evaluate("document.querySelector('.jar-reflect-room').contains(document.activeElement)"), true, 'Changing progress must retain dialog focus');
    const action = await dialog.getByRole('button', { name: 'See reading', exact: true }).evaluate((element) => ({
      height: element.getBoundingClientRect().height, width: element.getBoundingClientRect().width, size: parseFloat(getComputedStyle(element).fontSize),
    }));
    assert.ok(action.height >= 44 && action.width >= 44 && action.size >= 14, 'Processing actions must remain readable and touchable inside a dialog');
    console.log('Processing action', action);
    assert.equal((await poster.textContent())?.trim(), before, 'Readiness alone must not replace the headline');
    assert.equal(await page.locator('.jar-source-status').count(), 1, 'The dialog and page must not duplicate progress');
    // Returning from another tab must not bypass the explicit reading action.
    // Advance only the absence measurement, not timers or the scene clock.
    await page.evaluate(`(() => {
      const state = Object.getOwnPropertyDescriptor(document, 'visibilityState');
      const hidden = Object.getOwnPropertyDescriptor(document, 'hidden');
      const now = Date.now;
      try {
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
        Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        document.dispatchEvent(new Event('visibilitychange'));
        const returnedAt = now() + 31_000;
        Date.now = () => returnedAt;
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
        Object.defineProperty(document, 'hidden', { configurable: true, value: false });
        document.dispatchEvent(new Event('visibilitychange'));
      } finally {
        Date.now = now;
        if (state) Object.defineProperty(document, 'visibilityState', state); else delete document.visibilityState;
        if (hidden) Object.defineProperty(document, 'hidden', hidden); else delete document.hidden;
      }
    })()`);
    await page.waitForLoadState('networkidle');
    assert.equal((await poster.textContent())?.trim(), before, 'Returning to the tab must not silently adopt a completed reading');
    await page.screenshot({ path: join(output, `ready-reflection-${viewport.width}.png`) });
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    assert.equal(await page.evaluate("Object.values(localStorage).some(value => value.includes('My unfinished answer must stay here.'))"), true);
    await page.getByRole('button', { name: 'See reading', exact: true }).click();
    await page.getByText('Earlier reading', { exact: true }).waitFor();
    assert.equal((await poster.textContent())?.trim(), after);
    assert.ok((await page.locator('.jar-source-previous').textContent())?.includes(before));
    assert.equal(await page.locator('.jar-source-status').count(), 0);
    await page.screenshot({ path: join(output, `opened-reading-${viewport.width}.png`) });
    assert.equal(saveCount, 1); assert.equal(answerCount, 1); assert.equal(generationCount, 0); assert.equal(retryCount, 0);

    // A later failed pass recovers the same source, without repeating a save.
    await page.reload();
    await page.getByRole('button', { name: 'Capture inspiration', exact: true }).click();
    await page.getByRole('textbox', { name: 'Capture inspiration', exact: true }).fill('Another thought about making room.');
    await page.getByRole('button', { name: 'Save inspiration', exact: true }).click();
    await page.getByText('Kept. Waiting to be read.', { exact: true }).waitFor();
    status = 'failed';
    await page.getByRole('button', { name: 'Check progress', exact: true }).click();
    await page.getByRole('button', { name: 'Try again', exact: true }).waitFor();
    await page.screenshot({ path: join(output, `failed-reading-${viewport.width}.png`) });
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await page.getByText('Kept. Waiting to be read.', { exact: true }).waitFor();
    assert.equal(saveCount, 2); assert.equal(answerCount, 1); assert.equal(retryCount, 1); assert.equal(generationCount, 0);
    await page.reload();
    await page.getByText('Kept. Waiting to be read.', { exact: true }).waitFor();
    assert.equal(saveCount, 2); assert.equal(retryCount, 1, 'Resuming progress must only read status');
    status = 'ready';
    const check = page.getByRole('button', { name: 'Check progress', exact: true });
    if (viewport.width < 500) await check.tap(); else await check.click();
    await page.getByText('Your reading still holds.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Dismiss processing notice', exact: true }).click();
    assert.equal(await page.locator('.jar-source-status').count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
    assert.deepEqual(pageErrors, []); assert.deepEqual([...unknown], []);
    console.log(`PASS ${viewport.width}×${viewport.height}: saved answer, untouched draft, explicit adoption, verified comparison and failed-pass retry`);
    } catch (error) {
      await page.screenshot({ path: join(output, `failure-${viewport.width}.png`) });
      console.log('Failure surface:', (await page.locator('body').innerText()).slice(0, 2500), 'Unknown routes:', [...unknown], 'Page errors:', pageErrors);
      console.log('Focus and scroll:', await page.evaluate(`({ active: document.activeElement?.outerHTML.slice(0, 350),
        scroll: [window.scrollY, document.querySelector('.jar')?.scrollTop],
        dialog: document.querySelector('.jar-reflect-room')?.getBoundingClientRect().toJSON() })`));
      throw error;
    }
    await context.close();
  }
} finally { await browser.close(); }
