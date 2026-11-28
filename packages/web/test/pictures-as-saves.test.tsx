// @vitest-environment jsdom
/**
 * ═══ A PICTURE SAVE IS THE SAVE (founder, 2026-11-27, approving four parts
 * of the picture-saves board) ═════════════════════════════════════════════
 *
 *   1. The picture is the page: full column width, a tap opens it whole with
 *      the same "<", the words read from it quoted under it with Fix, and no
 *      "Open original image ↗". A picture with no readable words stands
 *      alone and nothing is said about it. The original downloads from ⋯.
 *   3. Inspirations rows lead with the picture and its first read line; a
 *      wordless picture is the picture and the date, never a scene.
 *   4. "From N inspirations" opens these same rows (it is this list, focused).
 *   (2, the trim, is `picture-trim.test.ts`.)
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): `lib/data` (the list and the detail
 * read are fixtures), `lib/api/attachments`' `fetchAttachmentUrl` and
 * `fetchImageWords` (a presigned URL and a words read are network acts) and `lib/picture-download` (a download is the browser's), and
 * `URL`'s blob half for the one download case that runs for real. The
 * archive mounts through `helpers/archive` (Home's recorder provider, real)
 * and the ⋯ opens through `helpers/note-actions` (a real press). The real
 * `SavesOverlay`, `NotePicture`, `NoteTools` and `ImageWords` run.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Archive } from './helpers/archive';
import { openNoteActions } from './helpers/note-actions';
import { inspirationPreview } from '../src/lib/inspiration-preview';
import { forgetPictureStore } from '../src/lib/picture-download';

const state = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  detail: new Map<string, Record<string, unknown>>(),
  downloads: [] as Array<[string, string]>,
}));
vi.mock('../src/lib/api/attachments', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/api/attachments')>()),
  fetchAttachmentUrl: async (id: string) => `https://bucket.test/${id}`,
  /* the page reads a picture's words itself (`useImageWords`) */
  fetchImageWords: async (id: string) => ({ attachmentId: id, inspirationId: 'i', profileId: 'p', correctedAt: null, canEdit: true, canRetry: false, retryAfter: null,
    read: null, correction: null, revision: '0',
    ...(id === 'pic-read' ? { status: 'ready', text: 'The smaller step. Most plans fail on the first morning.' } : { status: 'unreadable', text: null }) }),
}));
vi.mock('../src/lib/picture-download', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/picture-download')>()),
  downloadOriginal: async (id: string, name: string) => { state.downloads.push([id, name]); return id !== 'pic-refused'; },
}));
vi.mock('../src/lib/data', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/data')>()),
  loadInspirations: async () => ({ inspirations: state.rows, total: state.rows.length, short: false }),
  loadInspiration: async (id: string) => ({ ...state.rows.find(row => row.id === id), text: '', reflections: [], ...state.detail.get(id) }),
}));

const SCENE = 'Rooftops at dusk from a window';
const read = { id: 'pic-read', type: 'image', label: 'IMG_0012.PNG', readLine: 'The smaller step' };
const bare = { id: 'pic-bare', type: 'image', label: 'IMG_0009.JPG' };
const row = (id: string, attachments: Array<Record<string, unknown>>, preview = inspirationPreview('', attachments as never), day = 26) =>
  ({ id, preview, capturedMs: Date.UTC(2026, 10, day), category: null, attachments });

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  state.downloads.length = 0; state.detail.clear(); forgetPictureStore();
  state.rows = [
    row('save-read', [read], undefined, 26),
    row('save-words', [], 'Changed my desk around and the week felt new', 25),
    row('save-bare', [bare], undefined, 23),
  ];
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = ''; });

async function renderList(focus?: { label: string; ids: string[] }) {
  await act(async () => root.render(<Archive locale="en-US" title="Inspirations" onBack={vi.fn()} focus={focus} onClearFocus={vi.fn()} />));
  for (let turn = 0; turn < 12 && !host.querySelector('.waka-list-row'); turn += 1) await act(async () => { await Promise.resolve(); });
}
const rowOf = (text: string) => [...host.querySelectorAll<HTMLButtonElement>('.waka-list-row')].find(node => (node.textContent ?? '').includes(text))!;
async function settle() { for (let turn = 0; turn < 8; turn += 1) await act(async () => { await Promise.resolve(); }); }
async function open(text: string) { await act(async () => rowOf(text).click()); await settle(); }
async function landPicture() {
  const image = host.querySelector<HTMLImageElement>('.waka-note-picture img')!;
  await act(async () => { image.dispatchEvent(new Event('load')); });
}

describe('Inspirations rows, led by pictures', () => {
  it('leads a picture save with the picture and its first read line', async () => {
    await renderList();
    const button = rowOf('The smaller step');
    expect(button.firstElementChild?.classList.contains('waka-list-photo'), 'the picture stands first').toBe(true);
    expect(button.querySelector('.waka-list-lead')?.textContent).toBe('The smaller step');
    expect(button.querySelector('.waka-list-date')).not.toBeNull();
  });

  it('shows a wordless picture as the picture and the date: no empty lead, no scene', async () => {
    await renderList();
    const button = [...host.querySelectorAll<HTMLButtonElement>('.waka-list-row')].find(node => node.querySelector('.waka-list-photo') && !node.querySelector('.waka-list-lead'))!;
    expect(button, 'a picture row with no lead line').toBeTruthy();
    expect(button.querySelector('.waka-list-date')).not.toBeNull();
    expect(button.textContent).not.toContain(SCENE);
    /* its name is for a screen reader only */
    expect(button.querySelector('.sr-only')?.textContent).toBeTruthy();
  });

  it('keeps a text save a plain row, with no picture slot, and draws no grid', async () => {
    await renderList();
    const button = rowOf('Changed my desk around');
    expect(button.querySelector('.waka-list-photo')).toBeNull();
    expect(button.querySelector('.waka-list-lead')?.textContent).toBe('Changed my desk around and the week felt new');
    expect(host.querySelector('.waka-list-rows')?.tagName).toBe('UL');
    expect(host.querySelector('[class*="grid"]')).toBeNull();
  });

  it('shows a reading\'s "From N inspirations" sources as these same rows', async () => {
    await renderList({ label: 'From 2 inspirations', ids: ['save-read', 'save-bare'] });
    const rows = [...host.querySelectorAll('.waka-list-row')];
    expect(rows).toHaveLength(2);
    expect(rows.every(node => node.querySelector('.waka-list-photo'))).toBe(true);
    const leads = rows.map(node => node.querySelector('.waka-list-lead')?.textContent ?? null);
    expect(leads).toContain('The smaller step');
    expect(leads, 'the wordless one leads with nothing').toContain(null);
  });
});

describe('the picture is the page', () => {
  it('shows the picture, its words quoted under it with Fix, and no "Open original image"', async () => {
    await renderList();
    await open('The smaller step');
    const picture = host.querySelector('.waka-note-picture')!;
    expect(picture.querySelector('img')?.getAttribute('src')).toBe('https://bucket.test/pic-read');
    const quote = picture.nextElementSibling!;
    expect(quote.classList.contains('waka-note-read'), 'the words sit right under the picture').toBe(true);
    expect(quote.querySelector('.waka-note-read-text')?.textContent).toContain('Most plans fail on the first morning.');
    expect([...host.querySelectorAll('a')].some(link => /original/i.test(link.textContent ?? ''))).toBe(false);
    expect(host.textContent).not.toMatch(/Open original/);
  });

  it('stands a picture with no readable words alone, saying nothing about it', async () => {
    await renderList();
    const wordless = [...host.querySelectorAll<HTMLButtonElement>('.waka-list-row')].find(node => node.querySelector('.waka-list-photo') && !node.querySelector('.waka-list-lead'))!;
    await act(async () => wordless.click());
    await settle();
    expect(host.querySelector('.waka-note-picture img')?.getAttribute('src')).toBe('https://bucket.test/pic-bare');
    expect(host.querySelector('.waka-note-read')).toBeNull();
    expect(host.textContent).not.toContain(SCENE);
  });

  it('opens the picture whole on a tap, with the same "<", and Escape goes back to the page', async () => {
    await renderList();
    await open('The smaller step');
    await landPicture();
    const press = host.querySelector<HTMLButtonElement>('.waka-note-picture-open')!;
    expect(press.getAttribute('aria-label')).toBe('See the whole picture');
    await act(async () => press.click());
    const whole = document.querySelector<HTMLElement>('.waka-picture-whole')!;
    expect(whole.getAttribute('role')).toBe('dialog');
    expect(whole.querySelector('img')?.getAttribute('src')).toBe('https://bucket.test/pic-read');
    const back = whole.querySelector<HTMLButtonElement>('.waka-surface-back')!;
    expect(back.getAttribute('data-back'), 'the page\'s own back control').toBe('back');
    expect(document.activeElement, 'the view holds focus').toBe(whole);
    expect(whole.querySelector('.waka-picture-whole-stage')).not.toBeNull();
    await act(async () => { back.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(document.querySelector('.waka-picture-whole')).toBeNull();
    expect(host.querySelector('.waka-note-picture'), 'still on the inspiration').not.toBeNull();
    await act(async () => press.click());
    await act(async () => document.querySelector<HTMLButtonElement>('.waka-picture-whole .waka-surface-back')!.click());
    expect(document.querySelector('.waka-picture-whole')).toBeNull();
    expect(document.activeElement).toBe(press);
  });

  it('closes only the view on Escape after a press on the picture, and keeps Tab inside it', async () => {
    await renderList();
    await open('The smaller step');
    await landPicture();
    await act(async () => host.querySelector<HTMLButtonElement>('.waka-note-picture-open')!.click());
    const whole = document.querySelector<HTMLElement>('.waka-picture-whole')!;
    const stage = whole.querySelector<HTMLElement>('.waka-picture-whole-stage')!;
    /* focus is somewhere else first, as after a click elsewhere */
    (document.body as HTMLElement).focus();
    const press = new MouseEvent('pointerdown', { bubbles: true, clientX: 100, clientY: 300 });
    Object.defineProperty(press, 'pointerId', { value: 7 });
    await act(async () => { stage.dispatchEvent(press); });
    expect(document.activeElement).toBe(whole);
    await act(async () => { whole.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })); });
    expect(whole.contains(document.activeElement), 'Tab stays in the view').toBe(true);
    await act(async () => { whole.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })); });
    expect(whole.contains(document.activeElement)).toBe(true);
    await act(async () => { (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(document.querySelector('.waka-picture-whole')).toBeNull();
    expect(host.querySelector('.waka-note-picture'), 'the inspiration stays open').not.toBeNull();
  });

  it('downloads this picture from the whole view, and says so when it cannot', async () => {
    state.rows = [row('save-two', [{ id: 'pic-refused', type: 'image', label: 'IMG_1.PNG' }, { id: 'pic-two', type: 'image', label: 'IMG_2.PNG' }])];
    await renderList();
    await open('#');
    await openNoteActions();
    expect(document.querySelector('[aria-label="Download original"][role="menuitem"]'), 'two pictures: one per press, in each whole view').toBeNull();
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    const image = host.querySelector<HTMLImageElement>('.waka-note-picture img')!;
    await act(async () => { image.dispatchEvent(new Event('load')); });
    await act(async () => host.querySelector<HTMLButtonElement>('.waka-note-picture-open')!.click());
    const download = document.querySelector<HTMLButtonElement>('.waka-picture-whole [aria-label="Download original"]')!;
    await act(async () => download.click());
    await settle();
    expect(state.downloads).toEqual([['pic-refused', 'IMG_1.PNG']]);
    expect(document.querySelector('.waka-picture-whole [role="alert"]')?.textContent).toBe('Couldn’t download the picture.');
  });

  it('zooms the whole picture with two fingers, and a double tap goes back to fit', async () => {
    await renderList();
    await open('The smaller step');
    await landPicture();
    await act(async () => host.querySelector<HTMLButtonElement>('.waka-note-picture-open')!.click());
    const stage = document.querySelector<HTMLElement>('.waka-picture-whole-stage')!;
    const image = () => stage.querySelector('img')!.style.transform;
    const finger = (type: string, pointerId: number, clientX: number) => {
      const event = new MouseEvent(type, { bubbles: true, clientX, clientY: 300 });
      Object.defineProperty(event, 'pointerId', { value: pointerId });
      stage.dispatchEvent(event);
    };
    expect(image()).toContain('scale(1)');
    await act(async () => { finger('pointerdown', 1, 150); finger('pointerdown', 2, 250); });
    await act(async () => { finger('pointermove', 1, 100); finger('pointermove', 2, 300); });
    expect(image(), 'twice as far apart: twice the size').toContain('scale(2)');
    await act(async () => { finger('pointerup', 1, 100); finger('pointerup', 2, 300); });
    await act(async () => { stage.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: 200, clientY: 300 })); });
    expect(image()).toContain('scale(1)');
  });

  it('doubles the picture on two quick taps of a finger, as an iPhone sends them', async () => {
    await renderList();
    await open('The smaller step');
    await landPicture();
    await act(async () => host.querySelector<HTMLButtonElement>('.waka-note-picture-open')!.click());
    const stage = document.querySelector<HTMLElement>('.waka-picture-whole-stage')!;
    const tap = (type: string) => {
      const event = new MouseEvent(type, { bubbles: true, clientX: 200, clientY: 300 });
      Object.defineProperty(event, 'pointerId', { value: 3 });
      Object.defineProperty(event, 'pointerType', { value: 'touch' });
      stage.dispatchEvent(event);
    };
    await act(async () => { tap('pointerdown'); tap('pointerup'); });
    expect(stage.querySelector('img')!.style.transform).toContain('scale(1)');
    await act(async () => { tap('pointerdown'); tap('pointerup'); });
    expect(stage.querySelector('img')!.style.transform).toContain('scale(2)');
  });

  it('says it could not open, with Try again, inside the view when the picture will not load after a fresh read', async () => {
    await renderList();
    await open('The smaller step');
    await landPicture();
    await act(async () => host.querySelector<HTMLButtonElement>('.waka-note-picture-open')!.click());
    const whole = document.querySelector<HTMLElement>('.waka-picture-whole')!;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const image = whole.querySelector('img');
      if (!image) break;
      await act(async () => { image.dispatchEvent(new Event('error')); });
      await settle();
    }
    const said = whole.querySelector('[role="alert"]')!;
    expect(said.textContent).toContain('Couldn’t open this attachment.');
    await act(async () => said.querySelector('button')!.click());
    await settle();
    expect(whole.querySelector('img'), 'Try again reads it afresh').not.toBeNull();
    expect(whole.querySelector('[role="alert"]')).toBeNull();
  });

  it('lets a failed download pass: a few seconds in the bar, behind any failure about the words', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      state.rows = [row('save-refused', [{ id: 'pic-refused', type: 'image', label: 'IMG_1.PNG' }])];
      await renderList();
      await open('#');
      await openNoteActions();
      await act(async () => document.querySelector<HTMLButtonElement>('[role="menuitem"][aria-label="Download original"]')!.click());
      await settle();
      const said = () => document.querySelector('.waka-dock-state[role="alert"]')?.textContent ?? '';
      expect(said()).toBe('Couldn’t download the picture.');
      await act(async () => { vi.advanceTimersByTime(5_100); });
      expect(said()).toBe('');
    } finally { vi.useRealTimers(); }
  });

  it('learns once that the store answers no CORS read, and loads every picture after without it', async () => {
    await renderList();
    await open('The smaller step');
    const first = host.querySelector<HTMLImageElement>('.waka-note-picture img')!;
    expect(first.getAttribute('crossorigin')).toBe('anonymous');
    await act(async () => { first.dispatchEvent(new Event('error')); });
    const plain = host.querySelector<HTMLImageElement>('.waka-note-picture img')!;
    expect(plain.hasAttribute('crossorigin'), 'read again without CORS').toBe(false);
    await act(async () => { plain.dispatchEvent(new Event('load')); });
    const { storeAnswersCors } = await import('../src/lib/picture-download');
    expect(storeAnswersCors()).toBe(false);
    /* the archive again, fresh: the session still knows */
    await act(async () => root.unmount());
    root = createRoot(host);
    await renderList();
    const wordless = [...host.querySelectorAll<HTMLButtonElement>('.waka-list-row')].find(node => node.querySelector('.waka-list-photo') && !node.querySelector('.waka-list-lead'))!;
    await act(async () => wordless.click());
    await settle();
    expect(host.querySelector('.waka-note-picture img')!.hasAttribute('crossorigin'), 'no second try with CORS').toBe(false);
  });

  it('downloads the original from the ⋯', async () => {
    await renderList();
    await open('The smaller step');
    await openNoteActions();
    const item = document.querySelector<HTMLButtonElement>('[role="menuitem"][aria-label="Download original"]')!;
    expect(item).not.toBeNull();
    await act(async () => item.click());
    expect(state.downloads).toEqual([['pic-read', 'IMG_0012.PNG']]);
  });

  it('offers no download on a save with no picture', async () => {
    await renderList();
    await open('Changed my desk around');
    await openNoteActions();
    expect(document.querySelector('[aria-label="Download original"]')).toBeNull();
  });
});

describe('downloadOriginal', () => {
  type Module = typeof import('../src/lib/picture-download');
  const actual = () => vi.importActual<Module>('../src/lib/picture-download');
  const anchors: Array<{ download: string; href: string; target: string }> = [];
  let click: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    anchors.length = 0;
    click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { anchors.push({ download: this.download, href: this.href, target: this.target }); });
    vi.stubGlobal('URL', class extends URL { static createObjectURL() { return 'blob:original'; } static revokeObjectURL() {} });
  });
  afterEach(() => { click.mockRestore(); vi.unstubAllGlobals(); });
  const bytes = (type: string) => (async () => ({ ok: true, status: 200, blob: async () => new Blob(['x'], { type }) })) as unknown as typeof fetch;

  const url = (id: string) => `https://bucket.test/${id}`;
  const readAs = (reads: string[] = []) => async (id: string) => { reads.push(id); return url(id); };
  beforeEach(async () => { (await actual()).forgetPictureStore(); });

  it('saves the bytes of a picture the store reads with CORS, under its own name', async () => {
    const { downloadOriginal, freshPictureUrl } = await actual();
    await freshPictureUrl('cors-pic', undefined, readAs());
    expect(await downloadOriginal('cors-pic', 'IMG_0012.PNG', { native: false, fetchFn: bytes('image/png'), read: async () => { throw new Error('no second read'); } })).toBe(true);
    expect(anchors).toEqual([{ download: 'IMG_0012.PNG', href: 'blob:original', target: '' }]);
  });

  it('reads one fresh URL on a 403 before it gives up', async () => {
    const { downloadOriginal, freshPictureUrl } = await actual();
    const reads: string[] = [];
    await freshPictureUrl('old-pic', undefined, readAs(reads));
    let calls = 0;
    const fetchFn = (async () => (++calls === 1 ? { ok: false, status: 403 } : { ok: true, status: 200, blob: async () => new Blob(['x'], { type: 'image/png' }) })) as unknown as typeof fetch;
    expect(await downloadOriginal('old-pic', 'x.png', { native: false, read: readAs(reads), fetchFn })).toBe(true);
    expect(reads).toEqual(['old-pic', 'old-pic']);
    expect(await downloadOriginal('never-seen', 'x.png', { native: false, read: readAs(), fetchFn: (async () => ({ ok: false, status: 403 })) as unknown as typeof fetch })).toBe(false);
  });

  it('never stamps a lapsed URL as fresh: past four minutes it reads a new one', async () => {
    const { downloadOriginal, freshPictureUrl } = await actual();
    const reads: string[] = [];
    await freshPictureUrl('aged', undefined, readAs(reads));
    await downloadOriginal('aged', 'x.png', { native: false, now: Date.now() + 5 * 60_000, read: readAs(reads), fetchFn: bytes('image/png') });
    expect(reads).toEqual(['aged', 'aged']);
  });

  it('on a store with no CORS, opens the original inside the press and never fetches its bytes', async () => {
    const { downloadOriginal, freshPictureUrl, noteStoreCors, storeAnswersCors } = await actual();
    noteStoreCors(false);
    expect(storeAnswersCors()).toBe(false);
    const never = (async () => { throw new Error('must not fetch'); }) as typeof fetch;
    await freshPictureUrl('plain-pic', undefined, readAs());
    const pending = downloadOriginal('plain-pic', 'x.png', { native: false, fetchFn: never });
    /* synchronously, before anything is awaited: no popup blocker */
    expect(anchors).toEqual([{ download: '', href: url('plain-pic'), target: '_blank' }]);
    expect(await pending).toBe(true);
    /* no fresh URL: a tab opened in the press, pointed at it when it comes */
    const tab = { opener: {}, location: { href: '' }, closed: false, close() { this.closed = true; } };
    const opened = downloadOriginal('unseen', 'x.png', { native: false, fetchFn: never, read: readAs(), openWindow: () => tab as unknown as Window });
    expect(tab.opener).toBeNull();
    expect(await opened).toBe(true);
    expect(tab.location.href).toBe(url('unseen'));
    const refused = { opener: {}, location: { href: '' }, closed: false, close() { this.closed = true; } };
    expect(await downloadOriginal('gone', 'x.png', { native: false, fetchFn: never, read: async () => { throw new Error('gone'); }, openWindow: () => refused as unknown as Window })).toBe(false);
    expect(refused.closed, 'an empty tab never stays').toBe(true);
    expect(await downloadOriginal('blocked', 'x.png', { native: false, fetchFn: never, read: readAs(), openWindow: () => null })).toBe(false);
  });

  it('in the installed app opens the original in the in-app browser, and says false when it cannot', async () => {
    const { downloadOriginal } = await actual();
    const opened: string[] = [];
    expect(await downloadOriginal('app-pic', 'x.png', { native: true, read: readAs(), openFile: async (u) => { opened.push(u); } })).toBe(true);
    expect(opened).toEqual([url('app-pic')]);
    expect(await downloadOriginal('app-pic', 'x.png', { native: true, read: readAs(), openFile: async () => { throw new Error('no browser'); } })).toBe(false);
    /* no native services in this build: nothing happened, so false */
    expect(await downloadOriginal('app-pic', 'x.png', { native: true, read: readAs() })).toBe(false);
  });

  it('names the file from its stored name, never a cut label', async () => {
    const { pictureFilename } = await actual();
    expect(pictureFilename('IMG_0012.PNG', 'image/png')).toBe('IMG_0012.PNG');
    expect(pictureFilename(`${'a'.repeat(118)}…`, 'image/jpeg')).toBe('waka-picture.jpg');
    expect(pictureFilename('Photo', 'image/heic')).toBe('waka-picture.heic');
    expect(pictureFilename('', '')).toBe('waka-picture');
  });
});

describe('leadPicture', () => {
  it('pairs the thumbnail with the line read off that same picture', async () => {
    const { leadPicture } = await import('../src/components/SavedPhoto');
    expect(leadPicture([{ id: 'a', type: 'image', label: 'a' }, { id: 'b', type: 'image', label: 'b', readLine: 'From b' }] as never))
      .toEqual({ id: 'b', line: 'From b' });
    expect(leadPicture([{ id: 'a', type: 'image', label: 'a' }, { id: 'f', type: 'file', label: 'f' }] as never)).toEqual({ id: 'a', line: null });
    expect(leadPicture([{ id: 'f', type: 'file', label: 'f' }] as never)).toBeNull();
  });
});
