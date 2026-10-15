/** Manual rendered check of capture → reflection → explicit reading adoption.
 * All API traffic is synthetic and non-local resources are blocked. This is
 * UI evidence, not proof of a deployed worker or a live-model result.
 * Build web, serve its production preview on 127.0.0.1:3012, then run
 * `pnpm e2e:source-processing`. Vite dev bypasses the production auth guard.
 */
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChromium } from './browser.js';

const origin = 'http://127.0.0.1:3012';
const output = mkdtempSync(join(tmpdir(), 'waka-source-processing-'));
console.log(`Screenshots: ${output}`);
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const date = '2026-10-01T10:00:00.000Z';
const profile = { id: id(1), accountId: id(2), type: 'human', name: 'Preview', avatarUrl: null,
  preferredLocale: 'en-US', publicHandle: 'preview', publicProfileEnabled: true, publicTopOfMindEnabled: true };
const viewer = { account: { id: id(2), email: 'preview@example.test', onboardingCompletedAt: date, isAdmin: false }, profile };
const otherProfile = { ...profile, id: id(201), accountId: id(202), name: 'Other account', publicHandle: 'other' };
const otherViewer = { account: { ...viewer.account, id: id(202), email: 'other@example.test' }, profile: otherProfile };
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
    let saveCount = 0, answerCount = 0, retryCount = 0, generationCount = 0, questionCount = 0;
    let sourceId = id(50), revision = 1;
    let activeViewer: typeof viewer | null = viewer;
    let loseCaptureResponse = false, loseAnswerResponse = false;
    const unavailableLookups = new Set<string>();
    const authoredPosts: Array<{ operation: string; requestId: string; profileId: string; input: unknown }> = [];
    const saveLookups: Array<{ requestId: string; profileId: string }> = [];
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
      if (path === '/auth/me') return activeViewer ? send(activeViewer) : send({ error: 'Signed out' }, 401);
      if (path === '/auth/logout') { activeViewer = null; return send({ ok: true }); }
      if (path === '/auth/login') {
        activeViewer = request.postDataJSON().email === otherViewer.account.email ? otherViewer : viewer;
        return send({ ...activeViewer, token: 'synthetic-browser-session' });
      }
      if (!activeViewer) return send({ error: 'Signed out' }, 401);
      const owner = activeViewer.profile;
      if (url.searchParams.has('profile') && url.searchParams.get('profile') !== owner.id) return send({ error: 'Not found' }, 404);
      if (path === '/profiles') return send({ profiles: [owner] });
      if (path.startsWith('/inspirations/save-requests/')) {
        const requestId = path.split('/').at(-1)!;
        saveLookups.push({ requestId, profileId: owner.id });
        if (unavailableLookups.has(requestId)) return send({ error: 'Temporary synthetic connection failure' }, 503);
        const saved = savedRequests.get(requestId);
        if (saved && saved.processing.profileId !== owner.id) return send({ error: 'No committed save found', code: 'save_not_found' }, 404);
        return saved ? send({ saveRequest: saved }) : send({ error: 'No committed save found', code: 'save_not_found' }, 404);
      }
      const scopedSource = /^\/inspirations\/([^/]+)(?:\/|$)/.exec(path)?.[1];
      if (scopedSource && !inspirations.some((item) => item.id === scopedSource && item.profileId === owner.id)) return send({ error: 'Not found' }, 404);
      if (path === '/inspirations' && request.method() === 'POST') {
        assert.equal(url.searchParams.get('profile'), profile.id);
        const requestId = request.headers()['idempotency-key'];
        assert.match(requestId!, /^[0-9a-f-]{36}$/);
        authoredPosts.push({ operation: 'inspiration', requestId: requestId!, profileId: owner.id, input: request.postDataJSON() });
        const previous = savedRequests.get(requestId!);
        if (previous) return send({ inspiration: inspirations.find((item) => item.id === previous.inspirationId),
          processing: previous.processing, saveRequest: { requestId, replayed: true } });
        saveCount += 1; sourceId = id(50 + saveCount); revision = 1; status = 'queued';
        const text = request.postDataJSON().text;
        const source = { ...inspirations[0]!, id: sourceId, text, textPreview: text, reflections: [] };
        inspirations.push(source);
        const processing = receipt();
        savedRequests.set(requestId!, { requestId: requestId!, operation: 'inspiration', inspirationId: source.id, reflectionId: null, processing, createdAt: date });
        if (loseCaptureResponse) {
          loseCaptureResponse = false; unavailableLookups.add(requestId!);
          return route.abort('connectionreset');
        }
        return send({ inspiration: source, processing, saveRequest: { requestId, replayed: false } }, 201);
      }
      if (path === '/inspirations') {
        const owned = inspirations.filter((item) => item.profileId === owner.id);
        return send({ inspirations: owned, total: owned.length });
      }
      if (path === `/inspirations/${sourceId}/processing`) return send(progress());
      if (path === `/inspirations/${sourceId}/processing/retry`) { retryCount += 1; status = 'queued'; return send(progress(), 202); }
      if (path === `/inspirations/${sourceId}/reflections` && request.method() === 'POST') {
        assert.equal(url.searchParams.get('profile'), profile.id);
        const requestId = request.headers()['idempotency-key'];
        assert.match(requestId!, /^[0-9a-f-]{36}$/);
        authoredPosts.push({ operation: 'reflection', requestId: requestId!, profileId: owner.id, input: request.postDataJSON() });
        const previous = savedRequests.get(requestId!);
        if (previous) return send({ reflection: inspirations.find((item) => item.id === previous.inspirationId)?.reflections.find((item) => (item as { id: string }).id === previous.reflectionId),
          processing: previous.processing, saveRequest: { requestId, replayed: true } });
        answerCount += 1; revision += 1; status = 'queued';
        const reflection = { id: id(80 + answerCount), inspirationId: sourceId, ...request.postDataJSON(), skipped: false, createdAt: date };
        const source = inspirations.find((item) => item.id === sourceId)!;
        source.reflections.push(reflection); source.reflectionCount += 1;
        const processing = receipt();
        savedRequests.set(requestId!, { requestId: requestId!, operation: 'reflection', inspirationId: sourceId, reflectionId: reflection.id, processing, createdAt: date });
        if (loseAnswerResponse) {
          loseAnswerResponse = false; unavailableLookups.add(requestId!);
          return route.abort('connectionreset');
        }
        return send({ reflection, processing, saveRequest: { requestId, replayed: false } }, 201);
      }
      if (path === `/inspirations/${sourceId}/reflection-question`) { questionCount += 1; return send({ phase: 'ready', question: 'What could someone else add to that unfinished corner?' }); }
      if (/^\/inspirations\/[^/]+$/.test(path)) {
        const source = inspirations.find((item) => item.id === path.split('/')[2] && item.profileId === owner.id);
        return source ? send({ inspiration: source }) : send({ error: 'Not found' }, 404);
      }
      const signal = { id: id(100), statement: 'Small openings make room for new ideas.', status: 'active', confidence: 80,
        evidenceCount: 3, lastEvidenceAt: date, locked: false, unsupported: false, sharedGroupIds: [], createdAt: date };
      if (path === '/signals') return send({ signals: owner.id === profile.id ? [signal] : [] });
      if (path === `/signals/${signal.id}`) return send({ signal: { ...signal, evidence: inspirations.slice(0, 3).map((item) => ({
        inspirationId: item.id, preview: item.text, quote: item.text, quoteSource: 'own', reason: null, createdAt: date,
      })) } });
      if (path === '/groups') return send({ groups: [] });
      if (path === '/experiences') return send({ experiences: [] });
      if (path === '/principles') return send({ principles: [] });
      if (path === '/principles/status') return send({ status: { phase: 'waiting', eligible: false, signalCount: 0, topOfMindCount: 0 } });
      if (path === '/top-of-mind/refresh') { generationCount += 1; return send({ jobId: id(90), requestVersion: '1', status: 'queued' }, 202); }
      if (path === '/top-of-mind') return send({ topOfMind: owner.id === profile.id ? reading(version)
        : { ...reading(1), profileId: owner.id, entries: [{ ...reading(1).entries[0]!, body: 'Other account reading', citedSignals: [] }] } });
      if (path === '/top-of-mind/versions') return send({ versions: Array.from({ length: version }, (_, index) => ({ ...reading(index + 1), entryCount: 1 })) });
      if (path.startsWith('/top-of-mind/versions/')) return send({ topOfMind: reading(path.endsWith(id(21)) ? 1 : 2) });
      if (path === '/weather') return send({ weather: { told: null, days: [], antechamber: [] } });
      unknown.add(`${request.method()} ${path}`);
      return send({ error: 'Unconfigured synthetic request' }, 404);
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const openComposer = async () => {
      const textbox = page.getByRole('textbox', { name: 'Capture inspiration', exact: true });
      if (!await textbox.isVisible()) await page.getByRole('button', { name: 'Capture inspiration', exact: true }).click();
      return textbox;
    };
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

    // A committed capture with a lost response remains one owned intent
    // through reload, a newer draft, and signing into another account.
    const keptText = 'A capture whose response never reached this browser.';
    const newerDraft = 'A newer unfinished thought must survive recovery.';
    loseCaptureResponse = true;
    await page.getByRole('button', { name: 'Capture inspiration', exact: true }).click();
    await page.getByRole('textbox', { name: 'Capture inspiration', exact: true }).fill(keptText);
    await page.getByRole('button', { name: 'Save inspiration', exact: true }).click();
    await page.getByText("Your words are here. Couldn't confirm the save.", { exact: true }).waitFor();
    const captureRequest = authoredPosts.at(-1)!;
    assert.equal(captureRequest.operation, 'inspiration');
    const pending = () => page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.includes(':pendingSave:')));
    assert.equal((await pending()).length, 1);
    await page.reload();
    await page.getByText("Your words are here. Couldn't confirm the save.", { exact: true }).waitFor();
    assert.equal(authoredPosts.filter((item) => item.requestId === captureRequest.requestId).length, 1, 'Reload must not repost an ambiguous save');
    await (await openComposer()).fill(newerDraft);
    assert.equal(await page.getByRole('button', { name: 'Save inspiration', exact: true }).isDisabled(), true);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Your account', exact: true }).click();
    await page.getByRole('button', { name: 'sign out', exact: true }).click();
    await page.waitForURL('**/login');
    const signIn = async (email: string) => {
      await page.getByLabel('Email', { exact: true }).fill(email);
      await page.getByLabel('Password', { exact: true }).fill('synthetic-password');
      await page.locator('form button[type="submit"]').click();
      await page.waitForURL(origin + '/');
    };
    await signIn(otherViewer.account.email);
    await poster.waitFor();
    assert.equal((await poster.textContent())?.trim(), 'Other account reading');
    await openComposer();
    assert.equal(await page.getByRole('textbox', { name: 'Capture inspiration', exact: true }).inputValue(), '', 'The second account must not inherit the first account draft');
    assert.equal(await page.locator('.jar-source-status').count(), 0, 'The second account must not inherit save or processing status');
    assert.equal(saveLookups.some((item) => item.profileId === otherProfile.id && item.requestId === captureRequest.requestId), false);
    assert.equal((await pending()).length, 1, 'The first account journal must remain available to its owner');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Your account', exact: true }).click();
    await page.getByRole('button', { name: 'sign out', exact: true }).click();
    await page.waitForURL('**/login');
    unavailableLookups.delete(captureRequest.requestId);
    await signIn(viewer.account.email);
    await page.getByText('Kept. Waiting to be read.', { exact: true }).waitFor();
    await page.waitForFunction(() => !Object.keys(localStorage).some((key) => key.includes(':pendingSave:')));
    assert.equal(authoredPosts.filter((item) => item.requestId === captureRequest.requestId).length, 1, 'Returning to the owner recovers by GET, without a replay POST');
    assert.equal(inspirations.filter((item) => item.text === keptText).length, 1);
    await openComposer();
    assert.equal(await page.getByRole('textbox', { name: 'Capture inspiration', exact: true }).inputValue(), newerDraft);
    await page.screenshot({ path: join(output, `recovered-capture-${viewport.width}.png`) });

    // A saved answer must also reconcile on reopening its inspiration. Its
    // original question stays with it and opening buys no follow-up question.
    await page.getByRole('button', { name: 'Save and reflect on this inspiration', exact: true }).click();
    await dialog.waitFor();
    const lostAnswer = 'This answer is kept even if its response is lost.';
    await dialog.locator('textarea').fill(lostAnswer);
    const askedQuestion = await dialog.locator('.jar-reflect-q').last().innerText();
    loseAnswerResponse = true;
    await dialog.getByRole('button', { name: 'continue →', exact: true }).click();
    await dialog.getByText("Your words are here. Couldn't confirm the save.", { exact: true }).waitFor();
    const answerRequest = authoredPosts.at(-1)!;
    assert.equal(answerRequest.operation, 'reflection');
    assert.deepEqual(answerRequest.input, { question: askedQuestion, answer: lostAnswer });
    const questionsBeforeRecovery = questionCount;
    await dialog.getByRole('button', { name: 'done for now', exact: true }).click();
    await page.reload();
    unavailableLookups.delete(answerRequest.requestId);
    await page.locator('.jar-saved').click();
    const ground = page.getByRole('listbox');
    await ground.waitFor(); await ground.focus(); await ground.press('End');
    const card = page.getByRole('dialog', { name: 'a saved inspiration', exact: true });
    await card.waitFor();
    await card.getByRole('button', { name: 'read reflection', exact: true }).click();
    await card.getByRole('button', { name: 'ask another question →', exact: true }).waitFor();
    await card.getByText(lostAnswer, { exact: true }).waitFor();
    await page.waitForFunction(() => !Object.keys(localStorage).some((key) => key.includes(':pendingSave:')));
    assert.equal(authoredPosts.filter((item) => item.requestId === answerRequest.requestId).length, 1);
    assert.equal(questionCount, questionsBeforeRecovery, 'Reopening a saved answer must not request another question automatically');
    assert.equal(inspirations.find((item) => item.id === sourceId)!.reflections.length, 1);
    assert.equal(await card.locator('textarea').count(), 0, 'Recovered completed words must not be offered as an unsaved answer');
    await page.screenshot({ path: join(output, `recovered-reflection-${viewport.width}.png`) });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
    assert.deepEqual(pageErrors, []); assert.deepEqual([...unknown], []);
    console.log(`PASS ${viewport.width}×${viewport.height}: saved answer, explicit adoption, failed-pass retry, lost-response reload and owned account recovery`);
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
