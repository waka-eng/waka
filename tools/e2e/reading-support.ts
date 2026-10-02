/** Manual rendered check, not a live-stack journey. All API traffic is synthetic;
 * every non-local resource is blocked. No account, database or model is used.
 * Run `pnpm --filter @waka/web build`, serve its production preview on 127.0.0.1:3012,
 * then `pnpm e2e:reading-support`. Screenshots go to a fresh temporary directory.
 */
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChromium } from './browser.js';

const origin = 'http://127.0.0.1:3012';
const output = mkdtempSync(join(tmpdir(), 'waka-reading-support-'));
console.log(`Screenshots: ${output}`);
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const date = '2026-10-01T10:00:00.000Z';
const profile = { id: id(1), accountId: id(2), type: 'human', name: 'Preview', avatarUrl: null,
  preferredLocale: 'en-US', publicHandle: 'preview', publicProfileEnabled: true, publicTopOfMindEnabled: true };
const viewer = { account: { id: id(2), email: 'preview@example.test', onboardingCompletedAt: date, isAdmin: false }, profile };
const inspirations = ['A quiet walk makes room for a new idea.', 'Small choices can change how a day feels.', 'Good work leaves space to think.']
  .map((text, index) => ({ id: id(10 + index), profileId: profile.id, text, textPreview: text, kind: 'note', source: 'app',
    visibility: 'private', createdAt: date, updatedAt: date, attachments: [], attachmentSummary: [], reflections: [], reflectionCount: 0 }));
const reading = { id: id(20), profileId: profile.id, version: 1, reason: 'regenerated', createdAt: date,
  generationRevision: '1', supportChanged: true, entries: [] };
const ownWords = 'Choose experiments without erasing your own words.';
const principle = { id: id(60), statement: ownWords, type: 'maxim', state: 'held', origin: 'minted', rank: 1,
  locked: true, unsupported: false, supportChanged: true, heldSince: date, conflictsWithId: null, citedSignals: [], createdAt: date };
const browser = await launchChromium({ headless: true });
try {
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
    const unknown = new Set<string>();
    const pageErrors: string[] = [];
    let failCheck = false;
    let generated = 0;
    await context.route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (!url.pathname.startsWith('/api/')) {
        return url.origin === origin ? route.continue() : route.abort();
      }
      const path = url.pathname.slice(4);
      const send = (json: unknown, status = 200) => route.fulfill({ status, json });
      if (path === '/auth/me') return send(viewer);
      if (path === '/profiles') return send({ profiles: [profile] });
      if (path === '/inspirations') return send({ inspirations, total: inspirations.length });
      if (path.startsWith('/inspirations/')) return send({ inspiration: inspirations.find((item) => item.id === path.split('/')[2]) });
      if (path === '/signals') return send({ signals: [] });
      if (path === '/groups') return send({ groups: [] });
      if (path === '/experiences') return send({ experiences: [] });
      if (path === '/principles') return send({ principles: [principle] });
      if (path === '/principles/status') return send({ status: { phase: 'waiting', eligible: false, signalCount: 0, topOfMindCount: 0 } });
      if (path === '/top-of-mind/refresh') { generated += 1; return send({ jobId: id(30), requestVersion: '1', status: 'queued' }, 202); }
      if (path === '/top-of-mind' || path === `/top-of-mind/versions/${reading.id}`) {
        if (failCheck && path.includes('/versions/')) return send({ error: 'Synthetic unavailable' }, 503);
        return send({ topOfMind: reading });
      }
      if (path === '/public/profiles/preview') return send({ profile: { name: 'Preview', handle: 'preview', preferredLocale: 'en-US' },
        topOfMind: { version: 1, publishedAt: date, entries: [{ type: 'pattern', body: 'I make room for careful work.',
          belief: null, prompt: null, pinned: true, supportChanged: true }] } });
      unknown.add(`${request.method()} ${path}`);
      return send({ error: 'Unconfigured synthetic request' }, 404);
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    // A string keeps tsx's Node-only function-name helper out of browser code.
    const measureText = (selector: string, backdropSelector: string) => page.evaluate(`((element, backdrop) => {
      const style = getComputedStyle(element);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const ctx = canvas.getContext('2d');
      const rgba = (value) => {
        ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = value; ctx.fillRect(0, 0, 1, 1);
        return [...ctx.getImageData(0, 0, 1, 1).data];
      };
      const ground = rgba(getComputedStyle(document.querySelector(backdrop)).backgroundColor);
      const ink = rgba(style.color);
      let alpha = ink[3] / 255;
      for (let parent = element; parent; parent = parent.parentElement) alpha *= Number(getComputedStyle(parent).opacity);
      const seen = ink.slice(0, 3).map((channel, i) => channel * alpha + ground[i] * (1 - alpha));
      const luminance = (channels) => channels.slice(0, 3).map((value) => {
        const normalized = value / 255;
        return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      }).reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0);
      const [low, high] = [luminance(seen), luminance(ground)].sort((a, b) => a - b);
      return { size: parseFloat(style.fontSize), height: element.getBoundingClientRect().height, contrast: (high + 0.05) / (low + 0.05) };
    })(document.querySelector(${JSON.stringify(selector)}), ${JSON.stringify(backdropSelector)})`) as Promise<{ size: number; height: number; contrast: number }>;
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(origin);
    await page.getByText('This reading needs another look.', { exact: true }).first().waitFor();
    assert.equal(await page.getByText('This reading needs another look.', { exact: true }).count(), 1);
    await page.getByRole('button', { name: 'Read again', exact: true }).waitFor();
    await page.screenshot({ path: join(output, `personal-${viewport.width}.png`) });
    const recovery = await measureText('.jar-board-act', '.jar');
    console.log('Recovery action', recovery);
    assert.ok(recovery.size >= 14 && recovery.height >= 44 && recovery.contrast >= 4.5, 'Recovery action must be readable and touchable at rest');
    failCheck = true;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.getByRole('button', { name: 'Check again', exact: true }).waitFor();
    assert.ok((await page.locator('body').innerText()).includes("Couldn't check this reading."));
    await page.screenshot({ path: join(output, `retry-${viewport.width}.png`) });
    failCheck = false;
    await page.getByRole('button', { name: 'Check again', exact: true }).click();
    await page.getByRole('button', { name: 'Read again', exact: true }).waitFor();
    assert.equal(generated, 0, 'A status-check retry must not trigger generation');
    await page.getByRole('button', { name: 'principles', exact: true }).click();
    await page.getByText(ownWords, { exact: true }).waitFor();
    await page.getByText('Your words are kept. Their support is not confirmed.', { exact: true }).waitFor();
    await page.waitForFunction(() => {
      const element = document.querySelector('.jar-values-value');
      if (!element) return false;
      const bounds = element.getBoundingClientRect();
      return bounds.top >= 0 && bounds.bottom <= window.innerHeight && bounds.left >= 0 && bounds.right <= window.innerWidth;
    });
    await page.waitForFunction(`(() => {
      const surface = document.querySelector('.jar-hq');
      const transform = surface?.style.transform;
      if (!transform) return false;
      const state = window.__wakaReadingSupportCamera ??= { transform: '', stable: 0 };
      state.stable = state.transform === transform ? state.stable + 1 : 0;
      state.transform = transform;
      return state.stable >= 8;
    })()`);
    await page.screenshot({ path: join(output, `principle-support-${viewport.width}.png`) });
    const supportNotice = await measureText('.jar-values-sub', '.jar');
    console.log('Principle support notice', supportNotice);
    assert.ok(supportNotice.size >= 14 && supportNotice.contrast >= 4.5, 'Unconfirmed support must be readable');
    assert.equal(generated, 0, 'Looking at protected principles must not buy a reading');
    await page.goto(`${origin}/@preview`);
    await page.getByText('Kept here; its supporting patterns have changed.', { exact: true }).waitFor();
    await page.screenshot({ path: join(output, `public-${viewport.width}.png`), fullPage: true });
    for (const [selector, backdrop] of [['.nc-title', '.nc-canvas'], ['.nc-note-body', '.nc-note'], ['.nc-note-support', '.nc-note']]) {
      const text = await measureText(selector!, backdrop!);
      console.log(selector, text);
      assert.ok(text.contrast >= 4.5, `${selector} must have readable contrast`);
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, 'Page must not overflow horizontally');
    assert.deepEqual(pageErrors, []);
    assert.deepEqual([...unknown], [], 'Every API request must have an explicit fixture');
    console.log(`PASS ${viewport.width}×${viewport.height}: support notice, recovery without generation, public kept wording`);
    await context.close();
  }
  console.log(`Screenshots: ${output}`);
} finally {
  await browser.close();
}
