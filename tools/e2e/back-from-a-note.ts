#!/usr/bin/env tsx
/**
 * ═══ BACK FROM AN OPEN SAVED NOTE, IN REAL BROWSERS ═══════════════════════
 *
 * `docs/plans/back-from-layers.md` says what jsdom cannot show: listener
 * order under the real lazy route, Chrome's history-manipulation
 * intervention, forward history, reload. This walks the open saved note's
 * address (`?open=saves&note=<id>`) in Chromium AND WebKit against the
 * production web build:
 *
 *   1. archive → note → Back shows the list → Back leaves the archive;
 *   2. Back then Forward reopens the note;
 *   3. reload with a note open keeps it, and Back still goes to the list;
 *   4. no extra or dead Back steps, and Forward history stays intact
 *      (`history.length` and the entry walk are read at every step).
 *
 * NO SERVER BUT A STATIC ONE. `packages/web/dist` is served from loopback,
 * and every `/api/*` request is answered IN THE PAGE by `context.route` from
 * the fixture below — one signed-in viewer, three saved notes, nothing else.
 * No account, no database, no network. A request the fixture does not know
 * is answered 404 and listed at the end, so a new read is visible rather
 * than silently empty.
 *
 *   pnpm --filter @waka/web build
 *   pnpm exec tsx tools/e2e/back-from-a-note.ts            # both engines
 *   pnpm exec tsx tools/e2e/back-from-a-note.ts --headed   # to watch
 *
 * Real-device gestures (iOS Safari's edge swipe, Android's system Back) are
 * NOT covered: `page.goBack()` is the browser's own Back, not a gesture.
 */
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { chromium, webkit, type BrowserType, type Page, type Route } from 'playwright';

const DIST = resolve(import.meta.dirname, '../../packages/web/dist');
assert.ok(existsSync(resolve(DIST, 'index.html')), `no web build at ${DIST} — run pnpm --filter @waka/web build`);
const headed = process.argv.includes('--headed');

const PROFILE = '11111111-1111-4111-8111-111111111111', ACCOUNT = '22222222-2222-4222-8222-222222222222';
const NOTES = [
  { id: '33333333-3333-4333-8333-333333333331', text: 'dusk on the hill, and the light went', days: 2 },
  { id: '33333333-3333-4333-8333-333333333332', text: 'the bakery opens at six', days: 5 },
  { id: '33333333-3333-4333-8333-333333333333', text: 'a quieter start to a project', days: 9 },
];
const NOTE = NOTES[0]!;
/** Notes the fixture has "deleted": gone from the list, 404 on read. */
const gone = new Set<string>();
/** While set, a PATCH waits on it — a save still running. */
let holdSaves: Promise<void> | null = null;
const ORIGINAL = NOTES.map((row) => row.text);
const at = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
const summary = (n: typeof NOTE) => ({ id: n.id, textPreview: n.text, kind: 'note', source: 'web', visibility: 'private',
  createdAt: at(n.days), updatedAt: at(n.days), attachmentSummary: [], reflectionCount: 0 });
const detail = (n: typeof NOTE) => ({ id: n.id, profileId: PROFILE, text: n.text, kind: 'note', source: 'web', category: null,
  visibility: 'private', createdAt: at(n.days), updatedAt: at(n.days), attachments: [], reflections: [] });
const viewer = { account: { id: ACCOUNT, email: 'note@example.test', onboardingCompletedAt: at(30), isAdmin: false },
  profile: { id: PROFILE, accountId: ACCOUNT, type: 'human', name: 'Note walker', avatarUrl: null, preferredLocale: 'en',
    publicHandle: null, publicProfileEnabled: false, publicTopOfMindEnabled: false } };

const unknown = new Set<string>();
const writes: string[] = [];
/** The fixture: what each read answers. Anything else is a 404, listed. */
function answer(method: string, path: string, search: URLSearchParams, sent: string | null): { status: number; body: unknown } {
  if (method !== 'GET') {
    writes.push(`${method} ${path} ${sent ?? ''}`);
    const one = /^\/api\/inspirations\/([^/]+)$/.exec(path), n = one && NOTES.find((row) => row.id === one[1]);
    if (method === 'PATCH' && n) { try { n.text = (JSON.parse(sent ?? '{}') as { text?: string }).text ?? n.text; } catch { /* kept */ } return { status: 200, body: { inspiration: detail(n) } }; }
    return { status: 200, body: {} };
  }
  if (path === '/api/auth/me') return { status: 200, body: viewer };
  if (path === '/api/inspirations') { const kept = NOTES.filter((row) => !gone.has(row.id)); return { status: 200, body: { inspirations: kept.map(summary), total: kept.length } }; }
  if (path === '/api/inspirations/snapshot') return { status: 200, body: { profileId: search.get('profile') ?? PROFILE, total: NOTES.length, fingerprint: null } };
  const one = /^\/api\/inspirations\/([^/]+)$/.exec(path);
  if (one) { const n = NOTES.find((row) => row.id === one[1] && !gone.has(row.id)); return n ? { status: 200, body: { inspiration: detail(n) } } : { status: 404, body: { error: 'not found' } }; }
  unknown.add(`${method} ${path}`);
  return { status: 404, body: { error: 'not in this fixture' } };
}

function serve(): Promise<{ server: Server; origin: string }> {
  const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
    '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    /* Every /api request is answered in the page; one reaching here is a leak. */
    if (url.pathname.startsWith('/api/')) { response.writeHead(599); response.end(); return; }
    /* A page that is not the app, to stand before it in history. */
    if (url.pathname === '/start.html') { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<!doctype html><title>start</title><p>before WAKA</p>'); return; }
    const file = resolve(DIST, `.${url.pathname}`);
    const path = file.startsWith(DIST + '/') && existsSync(file) && extname(file) ? file : resolve(DIST, 'index.html');
    response.writeHead(200, { 'Content-Type': types[extname(path)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(await readFile(path));
  });
  return new Promise((done) => server.listen(0, '127.0.0.1', () => {
    const address = server.address(); assert.ok(address && typeof address === 'object');
    done({ server, origin: `http://127.0.0.1:${address.port}` });
  }));
}

type Step = { what: string; url: string; length: number; note: boolean; list: boolean };
async function look(page: Page, what: string): Promise<Step> {
  await page.waitForTimeout(700);
  const url = new URL(page.url());
  return { what, url: url.pathname + url.search, length: await page.evaluate(() => history.length),
    note: await page.locator('textarea.waka-note-page').isVisible().catch(() => false),
    list: await page.locator('.waka-list-row').first().isVisible().catch(() => false) };
}
const q = (step: Step) => new URLSearchParams(step.url.split('?')[1] ?? '');
/** Open the archive the way a person does: the bar's Inspiration row opens a
    new note (its address lands first), whose bar offers All inspirations,
    which replaces the new note's entry with the archive's. */
async function openArchive(page: Page): Promise<void> {
  await page.locator('.waka-dock button.waka-dock-item', { hasText: /^New inspiration$/ }).first().click();
  await page.waitForURL(/compose=1/, { timeout: 10_000 });
  await page.locator('.waka-dock button.waka-dock-item[aria-label="All inspirations"], .waka-dock button.waka-dock-item:has-text("All inspirations")').first().click({ timeout: 10_000 });
  await page.locator('.waka-list-row').first().waitFor({ timeout: 10_000 });
}

async function walk(engine: BrowserType, name: string, origin: string): Promise<{ name: string; failures: string[]; steps: Step[] }> {
  NOTES.forEach((row, index) => { row.text = ORIGINAL[index]!; }); gone.clear(); holdSaves = null;
  const browser = await engine.launch({ headless: !headed });
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await context.route(/\/api\//, async (route: Route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'PATCH' && holdSaves) await holdSaves;
    const { status, body } = answer(route.request().method(), url.pathname, url.searchParams, route.request().postData());
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
  const page = await context.newPage();
  const failures: string[] = [], steps: Step[] = [];
  const check = (ok: boolean, what: string) => { if (!ok) failures.push(what); };
  const record = async (what: string) => { const step = await look(page, what); steps.push(step); return step; };
  try {
    /* A first entry before Home, so "Back leaves the archive" and "Back
       leaves WAKA" are different observations. */
    await page.goto(`${origin}/start.html`, { waitUntil: 'domcontentloaded' });
    await page.goto(`${origin}/`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    const home = await record('home');
    await openArchive(page);
    const list = await record('archive open');
    check(q(list).get('open') === 'saves' && list.list, 'the archive did not open with its list');
    await page.locator('.waka-list-row').first().click();
    await page.locator('textarea.waka-note-page').waitFor({ timeout: 10_000 });
    const note = await record('note open');
    check(q(note).get('note') === NOTE.id && note.note, 'the note did not open at its own address');
    check(note.length === list.length + 1, `opening the note added ${note.length - list.length} entries, not 1`);

    /* 1. Back → list, Back → archive closed. */
    await page.goBack();
    const back1 = await record('Back from the note');
    check(q(back1).get('open') === 'saves' && !q(back1).get('note') && back1.list && !back1.note, 'Back from the note did not show the list');
    await page.goBack();
    const back2 = await record('Back from the list');
    check(!q(back2).get('open') && back2.url === home.url, `Back from the list did not close the archive (at ${back2.url})`);
    check(!back2.list && !back2.note, 'the archive is still on screen after it closed');
    check(back2.length === note.length, `history length changed while walking back (${note.length} → ${back2.length})`);

    /* 2. Forward history intact: Forward, Forward reopens the note. */
    await page.goForward();
    const fwd1 = await record('Forward to the list');
    check(q(fwd1).get('open') === 'saves' && !q(fwd1).get('note') && fwd1.list, 'Forward did not return to the list');
    await page.goForward();
    const fwd2 = await record('Forward to the note');
    check(q(fwd2).get('note') === NOTE.id && fwd2.note, 'Forward did not reopen the note');
    /* Back then Forward, one step each. */
    await page.goBack();
    const bf1 = await record('Back (again) from the note');
    check(bf1.list && !bf1.note, 'second Back from the note did not show the list');
    await page.goForward();
    const bf2 = await record('Forward (again) to the note');
    check(bf2.note && q(bf2).get('note') === NOTE.id, 'second Forward did not reopen the note');

    /* 3. Reload with the note open keeps it; Back still goes to the list. */
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('textarea.waka-note-page').waitFor({ timeout: 15_000 });
    const reloaded = await record('reload with the note open');
    check(reloaded.note && q(reloaded).get('note') === NOTE.id, 'reload lost the open note');
    check(reloaded.length === note.length, `reload changed the history length (${note.length} → ${reloaded.length})`);
    await page.goBack({ waitUntil: 'networkidle' });
    await page.locator('.waka-list-row').first().waitFor({ timeout: 15_000 }).catch(() => undefined);
    const afterReload1 = await record('Back after reload');
    check(afterReload1.list && !afterReload1.note && q(afterReload1).get('open') === 'saves' && !q(afterReload1).get('note'),
      'Back after reload did not land on the list');
    await page.goBack({ waitUntil: 'networkidle' });
    const afterReload2 = await record('Back again after reload');
    check(!q(afterReload2).get('open') && afterReload2.url === home.url && !afterReload2.list, `second Back after reload did not close the archive (at ${afterReload2.url})`);
    /* No dead step: one more Back leaves Home for the entry before it. */
    await page.goBack({ waitUntil: 'domcontentloaded' });
    const beyond = await record('Back from Home');
    check(beyond.url === '/start.html', `a Back from Home did not reach the entry before it (at ${beyond.url}) — an extra or dead step`);
    /* And forward is still all there. */
    await page.goForward({ waitUntil: 'networkidle' }); await page.waitForTimeout(1200);
    await page.goForward({ waitUntil: 'networkidle' }); await page.waitForTimeout(800);
    await page.goForward({ waitUntil: 'networkidle' });
    await page.locator('textarea.waka-note-page').waitFor({ timeout: 15_000 }).catch(() => undefined);
    const forwardAll = await record('Forward ×3 back to the note');
    check(forwardAll.note && q(forwardAll).get('note') === NOTE.id, `Forward history was not intact after the walk (at ${forwardAll.url})`);

    /* 4. The on-screen way back from a note steps the same history. */
    await page.getByRole('button', { name: 'Back', exact: true }).first().click();
    const onScreen = await record('on-screen Back from the note');
    check(onScreen.list && !onScreen.note && !q(onScreen).get('note'), 'the on-screen way back did not return to the list');
    check(onScreen.length === forwardAll.length, `the on-screen way back changed the history length (${forwardAll.length} → ${onScreen.length})`);
    await page.goBack({ waitUntil: 'networkidle' });
    const afterOnScreen = await record('Back after the on-screen close');
    check(!q(afterOnScreen).get('open') && !afterOnScreen.list, `Back after the on-screen close did not leave the archive (at ${afterOnScreen.url})`);

    /* 5. Back commits an edit: the words are written, then the list shows. */
    await page.goForward({ waitUntil: 'networkidle' });
    await page.locator('.waka-list-row').nth(1).waitFor({ timeout: 10_000 });
    await page.locator('.waka-list-row').nth(1).click();
    const field = page.locator('textarea.waka-note-page');
    await field.waitFor({ timeout: 10_000 });
    await page.waitForFunction((text) => document.querySelector<HTMLTextAreaElement>('textarea.waka-note-page')?.value === text, NOTES[1]!.text);
    const edited = `${NOTES[1]!.text}, and the queue was already out the door`;
    await field.fill(edited);
    const before = writes.length;
    await page.goBack();
    const committed = await record('Back from an edited note');
    const sent = writes.slice(before).filter((line) => line.startsWith(`PATCH /api/inspirations/${NOTES[1]!.id}`));
    check(sent.length === 1, `Back from an edited note sent ${sent.length} writes of it, not 1`);
    check(sent.some((line) => line.includes(edited)), 'the write Back sent did not carry the edited words');
    check(committed.list && !committed.note && q(committed).get('open') === 'saves', 'Back from an edited note did not land on the list');

    /* 6. Escape from an open note closes the archive in one press. With no
          archive origin (the dock's path) the note's own entry is replaced by
          the world, so nothing is left in Forward history, and Back reaches
          the list that was visited. Escape from the LIST is the baseline,
          which this change does not touch. Each on a fresh tab. */
    const escapeFrom = async (fromNote: boolean) => {
      const tab = await context.newPage();
      await tab.goto(`${origin}/start.html`, { waitUntil: 'domcontentloaded' });
      await tab.goto(`${origin}/`, { waitUntil: 'networkidle' });
      await tab.waitForTimeout(1500);
      await openArchive(tab);
      if (fromNote) { await tab.locator('.waka-list-row').first().click(); await tab.locator('textarea.waka-note-page').waitFor({ timeout: 10_000 }); }
      await tab.waitForTimeout(500);
      await tab.keyboard.press('Escape');
      const closed = await look(tab, fromNote ? 'Escape from a note' : 'Escape from the list (baseline)');
      /* The entries themselves, where the engine exposes them (the Navigation API). */
      const entries = await tab.evaluate(() => { const api = (window as { navigation?: { entries(): { url: string }[]; currentEntry: { index: number } } }).navigation;
        return api ? `${api.entries().map((entry, index) => `${index === api.currentEntry.index ? '*' : ''}${new URL(entry.url).pathname}${new URL(entry.url).search}`).join(' | ')}` : 'n/a'; });
      console.log(`  [${name}] entries after ${fromNote ? 'Escape from a note' : 'Escape from the list'}: ${entries}`);
      await tab.goForward({ waitUntil: 'domcontentloaded' }).catch(() => null);
      const ahead = await look(tab, fromNote ? 'Forward after Escape from a note' : 'Forward after Escape from the list (baseline)');
      await tab.goBack({ waitUntil: 'domcontentloaded' });
      const after = await look(tab, fromNote ? 'Back after Escape from a note' : 'Back after Escape from the list (baseline)');
      steps.push(closed, ahead, after);
      await tab.close();
      return { closed, ahead, after };
    };
    const baseline = await escapeFrom(false), fromNote = await escapeFrom(true);
    check(!q(fromNote.closed).get('open') && !fromNote.closed.list && !fromNote.closed.note && fromNote.closed.url === home.url,
      `Escape from a note did not close the archive (at ${fromNote.closed.url})`);
    check(fromNote.ahead.url === fromNote.closed.url, `Forward after Escape from a note went to ${fromNote.ahead.url} — a note entry was left ahead`);
    check(fromNote.after.list && q(fromNote.after).get('open') === 'saves' && !q(fromNote.after).get('note'),
      `Back after Escape from a note did not reach the list (at ${fromNote.after.url})`);
    check(fromNote.closed.url === baseline.closed.url && fromNote.after.length === baseline.after.length + 1,
      `Escape from a note closed to ${fromNote.closed.url} (len=${fromNote.after.length}) vs the list's ${baseline.closed.url} (len=${baseline.after.length})`);
    if (baseline.after.url !== '/start.html') console.log(`  [${name}] note: Back after closing the archive from the LIST lands on ${baseline.after.url}, not the entry before Home — pre-existing, the dock opens the archive by replacing the new note's entry, so the archive has no origin to return to`);

    /* 7. Forward into a note deleted meanwhile: the address is repaired by
          stepping back onto the list, so one Back still leaves the archive. */
    {
      const tab = await context.newPage();
      await tab.goto(`${origin}/start.html`, { waitUntil: 'domcontentloaded' });
      await tab.goto(`${origin}/`, { waitUntil: 'networkidle' }); await tab.waitForTimeout(1500);
      await openArchive(tab);
      await tab.locator('.waka-list-row').nth(2).click(); await tab.locator('textarea.waka-note-page').waitFor({ timeout: 10_000 });
      await tab.goBack(); await tab.waitForTimeout(700);
      await tab.goBack(); await tab.waitForTimeout(700);
      gone.add(NOTES[2]!.id);
      await tab.goForward(); await tab.locator('.waka-list-row').first().waitFor({ timeout: 10_000 });
      await tab.goForward();
      const repaired = await look(tab, 'Forward into a deleted note');
      await tab.goBack({ waitUntil: 'domcontentloaded' });
      const out = await look(tab, 'Back after the repair');
      steps.push(repaired, out);
      check(repaired.list && !repaired.note && q(repaired).get('open') === 'saves' && !q(repaired).get('note'), `Forward into a deleted note did not land on the list (at ${repaired.url})`);
      check(!q(out).get('open') && !out.list, `Back after the repair did not leave the archive (at ${out.url}) — the list was left twice`);
      gone.clear();
      await tab.close();
    }

    /* 8. A save still running across Back and Forward, then the note is
          opened again and closed on screen: it closes, and stays closed. */
    {
      const tab = await context.newPage();
      await tab.goto(`${origin}/start.html`, { waitUntil: 'domcontentloaded' });
      await tab.goto(`${origin}/`, { waitUntil: 'networkidle' }); await tab.waitForTimeout(1500);
      await openArchive(tab);
      await tab.locator('.waka-list-row').first().click();
      const words = tab.locator('textarea.waka-note-page');
      await words.waitFor({ timeout: 10_000 });
      await tab.waitForFunction(() => (document.querySelector<HTMLTextAreaElement>('textarea.waka-note-page')?.value ?? '').length > 0);
      let release: () => void = () => undefined;
      holdSaves = new Promise((done) => { release = done; });
      await words.fill(`${await words.inputValue()} — and later, rain`);
      await tab.goBack(); await tab.waitForTimeout(700);
      release(); holdSaves = null; await tab.waitForTimeout(1000);
      await tab.goForward(); await words.waitFor({ timeout: 10_000 });
      const reopened = await look(tab, 'Forward after a Back-during-save');
      await tab.getByRole('button', { name: 'Back', exact: true }).first().click();
      const closed = await look(tab, 'on-screen Back after that');
      await tab.waitForTimeout(1200);
      const still = await look(tab, '…and a moment later');
      steps.push(reopened, closed, still);
      check(reopened.note && q(reopened).get('note') !== null, 'Forward after a Back-during-save did not reopen the note');
      check(closed.list && !closed.note && !q(closed).get('note'), 'the on-screen way back did not close a note reopened after a Back-during-save');
      check(still.list && !still.note, 'the note reopened itself after being closed on screen');
      await tab.close();
    }
  } catch (error) {
    failures.push(`walk threw: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
  } finally {
    await browser.close();
  }
  return { name, failures, steps };
}

const { server, origin } = await serve();
let failed = false;
try {
  for (const [engine, name] of [[chromium, 'Chromium'], [webkit, 'WebKit']] as const) {
    const result = await walk(engine, name, origin);
    console.log(`\n── ${result.name} ──`);
    for (const step of result.steps) console.log(`  ${step.what.padEnd(34)} ${step.url.padEnd(60)} len=${step.length} list=${step.list} note=${step.note}`);
    if (result.failures.length) { failed = true; for (const failure of result.failures) console.log(`  FAIL ${failure}`); }
    else console.log('  all checks passed');
  }
  if (unknown.size) console.log(`\nreads the fixture answered 404: ${[...unknown].sort().join(', ')}`);
  if (writes.length) console.log(`writes seen (answered {}): ${[...new Set(writes)].join(', ')}`);
} finally {
  server.close();
}
process.exit(failed ? 1 : 0);
