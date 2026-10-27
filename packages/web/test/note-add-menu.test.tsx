// @vitest-environment jsdom
/**
 * ═══ A NOTE'S ＋: ADD PHOTO, ADD FILE (2026-10-16) ═══════════════════════
 *
 * Founder: "the bar's PHOTO icon becomes ＋. Pressing ＋ opens a small pop-up
 * menu with two rows: 'Add photo' and 'Add file'. Add photo = the existing
 * photo picker … Add file = a file picker … whose files are attached to the
 * note as type 'file'." So the note's bar is All inspirations │ dictate · ＋ ·
 * save │ Close (`home-navigation.test.tsx` holds the shape), and what is held
 * here is the menu — it opens upward as a menu, keyboard-first, and closes on
 * Escape without closing the note under it — and the file row's whole path:
 * a PDF chosen there lands on the note's shelf as a file tile, and the save
 * sends it as `{ type: 'file', contentType: 'application/pdf' }` under kind
 * 'note' (there is no 'file' kind).
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): `lib/data` supplies the three layers
 * (`helpers/render-home`'s fixtures) and `lib/auth-context` the signed-in
 * viewer — the world renders nothing without one; `lib/api/principles`
 * answers "no principles yet" so the world settles. `lib/api` is spread
 * through with the upload's two network steps (`presignAttachment`,
 * `uploadToPresignedUrl`) and the save's two (`fetchInspirationSaveRequest`
 * answering "no such save yet", and `createInspiration`, which records the
 * request and then never settles — the request is the claim). `indexedDB` is
 * `fake-indexeddb`: the draft store is the real one and it needs a database,
 * or the notepad disables its tools and every case passes for the wrong
 * reason. Canvas, viewport, clock and randomness are `helpers/canvas-stub`'s.
 * The real notepad, the real `AddMenu`, the real `inspectAttachmentFile` and
 * the real save rule run. For the saved note, `finalizeAttachment` records the
 * attach-to-this-note write and then never settles.
 */
import { act } from 'react';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { installCanvasStub, setViewport } from './helpers/canvas-stub';
import { mountWorld, dataMockFrom, apiMockFrom, chooseFromMenu, VIEWER_ID, type MountedWorld } from './helpers/render-home';
import { ApiError, createInspiration, fetchInspirationSaveRequest, finalizeAttachment, presignAttachment, uploadToPresignedUrl } from '../src/lib/api';

const FACTS = vi.hoisted(() => ({
  inspirations: [{ id: 'kept', text: 'an older thought', daysAgo: 3 }],
  groups: [] as never[],
}));
vi.mock('../src/lib/api/principles', async original => ({
  ...await original<typeof import('../src/lib/api/principles')>(),
  fetchPrincipleRead: vi.fn(async () => ({ principles: [], status: { phase: 'ready', eligible: false } })),
}));
vi.mock('../src/lib/data', async original => ({
  ...await original<typeof import('../src/lib/data')>(), ...dataMockFrom(FACTS),
}));
vi.mock('../src/lib/api', async original => ({
  ...await original<typeof import('../src/lib/api')>(), ...apiMockFrom(FACTS),
  fetchPrinciples: vi.fn(async () => []),
  fetchInspirationSaveRequest: vi.fn(), createInspiration: vi.fn(),
  presignAttachment: vi.fn(), uploadToPresignedUrl: vi.fn(), finalizeAttachment: vi.fn(),
}));
vi.mock('../src/lib/auth-context', async original => {
  const session = { status: 'authenticated', account: { id: 'account-1', email: 'you@example.test' },
    profile: { id: VIEWER_ID, name: 'You', type: 'human' }, profiles: [], refresh: async () => undefined, signOut: async () => undefined };
  return { ...await original<typeof import('../src/lib/auth-context')>(), useOptionalAuth: () => session, useAuth: () => session };
});

let world: MountedWorld;
beforeAll(() => { installCanvasStub(); setViewport(1280, 900); (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  (globalThis as { indexedDB?: IDBFactory }).indexedDB = new IDBFactory();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.mocked(presignAttachment).mockImplementation(async (input) => ({ uploadUrl: 'https://bucket.test/put', key: `profiles/${VIEWER_ID}/attachments/1-${input.filename}`,
    expiresAt: '2026-10-16T01:00:00Z', profileId: VIEWER_ID, headers: { 'Content-Type': input.contentType, 'Content-Length': String(input.size) } }));
  vi.mocked(uploadToPresignedUrl).mockResolvedValue(undefined);
  vi.mocked(fetchInspirationSaveRequest).mockRejectedValue(new ApiError({ status: 404, code: 'save_not_found', message: 'not found' }));
  vi.mocked(createInspiration).mockImplementation(() => new Promise(() => undefined));
});
afterEach(() => { world?.unmount(); vi.useRealTimers(); vi.clearAllMocks(); });

async function settle() {
  for (let turn = 0; turn < 8; turn += 1) { await world.step(100); await act(async () => { await vi.advanceTimersByTimeAsync(100); }); }
}
async function openNotepad(): Promise<void> {
  world = await mountWorld(FACTS); await settle();
  const inspiration = [...world.container.querySelectorAll<HTMLButtonElement>('.waka-dock .waka-dock-item, .waka-primary-capture')]
    .find(row => row.textContent?.trim() === 'New inspiration');
  expect(inspiration, 'the bar offers no Inspiration row').toBeTruthy();
  await act(async () => inspiration!.click()); await settle();
  expect(world.container.querySelector('.jar-inspiration-composer'), 'the notepad did not open').toBeTruthy();
}
const plus = () => world.container.querySelector<HTMLButtonElement>('nav.waka-dock .waka-dock-making button[aria-haspopup="menu"]');
const menu = () => world.container.querySelector<HTMLElement>('nav.waka-dock [role="menu"]');
const rows = () => [...(menu()?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
/** Hand the chooser behind a row a file, the way the operating system would. */
async function choose(accepting: (accept: string) => boolean, file: File): Promise<void> {
  const input = [...world.container.querySelectorAll<HTMLInputElement>('nav.waka-dock input[type="file"]')].find(node => accepting(node.accept));
  expect(input, 'the ＋ has no chooser for this').toBeTruthy();
  Object.defineProperty(input!, 'files', { configurable: true, value: [file] });
  await act(async () => { input!.dispatchEvent(new Event('change', { bubbles: true })); });
  await settle();
}

it('opens a menu above the ＋ with Add photo and Add file, and Escape closes only the menu', async () => {
  await openNotepad();
  expect(plus(), 'the note\'s bar has no ＋').toBeTruthy();
  expect(plus()!.getAttribute('aria-label')).toBe('Add photo or file');
  expect(plus()!.getAttribute('aria-expanded')).toBe('false');
  expect(menu(), 'the menu is open before anything was pressed').toBeNull();

  await act(async () => plus()!.click());
  expect(menu(), 'pressing ＋ opened no menu').toBeTruthy();
  expect(plus()!.getAttribute('aria-expanded')).toBe('true');
  expect(rows().map(row => row.textContent?.trim()), 'the menu is not its two rows').toEqual(['Add photo', 'Add file']);
  expect(document.activeElement, 'the first row did not take focus').toBe(rows()[0]);

  /* The arrows walk it. */
  await act(async () => { menu()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); });
  expect(document.activeElement, 'ArrowDown did not reach Add file').toBe(rows()[1]);

  await act(async () => { menu()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  await settle();
  expect(menu(), 'Escape left the menu open').toBeNull();
  expect(document.activeElement, 'focus did not come back to the ＋').toBe(plus());
  expect(world.container.querySelector('.jar-inspiration-composer'), 'Escape on the menu closed the note too').toBeTruthy();

  /* AND A PRESS ANYWHERE ELSE closes it. */
  await act(async () => plus()!.click());
  expect(menu()).toBeTruthy();
  await act(async () => { document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
  expect(menu(), 'a press outside left the menu open').toBeNull();
});

it('puts a chosen file on the shelf as a file tile and saves it as type file under kind note', async () => {
  await openNotepad();
  const pdf = new File(['%PDF-1.7 a lease'], 'Lease.pdf', { type: 'application/pdf' });
  await choose(accept => accept.includes('application/pdf'), pdf);
  const tile = world.container.querySelector('.jar-shelf .jar-tile-file');
  expect(tile, 'the file did not land on the note as a file tile').toBeTruthy();
  expect(tile!.textContent, 'the tile does not say the file\'s name').toContain('Lease.pdf');
  expect(tile!.querySelector('[data-home-action-icon="file"]'), 'the tile has no file glyph').toBeTruthy();
  expect(tile!.textContent, 'the tile does not say how big it is').toMatch(/\d+ KB/);

  const save = world.container.querySelector<HTMLButtonElement>('nav.waka-dock button.waka-dock-tool--keep');
  expect(save?.disabled, 'Save is dim with a file on the note').toBe(false);
  await act(async () => save!.click()); await settle();
  expect(presignAttachment, 'the file was never uploaded').toHaveBeenCalled();
  expect(vi.mocked(presignAttachment).mock.calls[0]![0]).toMatchObject({ filename: 'Lease.pdf', contentType: 'application/pdf' });
  expect(createInspiration, 'the note was never saved').toHaveBeenCalledOnce();
  const input = vi.mocked(createInspiration).mock.calls[0]![0];
  expect(input.kind, 'a note of a file alone is not kind note').toBe('note');
  expect(input.attachments).toEqual([expect.objectContaining({ type: 'file', contentType: 'application/pdf', name: 'Lease.pdf' })]);
});

/* Audit f2afcbe2 (mob): the menu stayed open over the note after a pick
   reached the chooser without the row's own press closing it first. */
it('puts the menu away when a file arrives, however the chooser was reached', async () => {
  await openNotepad();
  const plus = world.container.querySelector<HTMLButtonElement>('nav.waka-dock button[aria-haspopup="menu"]')!;
  await act(async () => plus.click()); await settle();
  expect(menu(), 'the ＋ did not open its menu').toBeTruthy();
  await choose(accept => accept.includes('application/pdf'), new File(['%PDF-1.7'], 'A.pdf', { type: 'application/pdf' }));
  expect(menu(), 'the menu stayed open after a file was picked').toBeNull();
});

it('an unnamed file is called "File" on its tile and saved with no name at all', async () => {
  await openNotepad();
  await choose(accept => accept.includes('application/pdf'), new File(['%PDF-1.7 a lease'], '', { type: 'application/pdf' }));
  const tile = world.container.querySelector('.jar-shelf .jar-tile');
  expect(tile?.getAttribute('title'), 'the unnamed file has no label on screen').toBe('File');
  const save = world.container.querySelector<HTMLButtonElement>('nav.waka-dock button.waka-dock-tool--keep');
  await act(async () => save!.click()); await settle();
  const [attached] = vi.mocked(createInspiration).mock.calls[0]![0].attachments!;
  expect(attached, 'the screen\'s label was saved as the file\'s name').not.toHaveProperty('name');
});

it('marks a file the server would refuse before anything is uploaded', async () => {
  await openNotepad();
  await choose(accept => accept.includes('application/pdf'), new File(['MZ'], 'run.exe', { type: 'application/x-msdownload' }));
  const tile = world.container.querySelector('.jar-shelf .jar-tile--wrong');
  expect(tile, 'a refused file was not marked on the shelf').toBeTruthy();
  expect(tile!.querySelector('.jar-tile-x')?.getAttribute('title')).toBe('This kind of file can’t be added');
  expect(presignAttachment, 'a refused file was uploaded').not.toHaveBeenCalled();
});

it('gives a saved note open in the archive the same ＋, and attaches a chosen file to it as type file', async () => {
  vi.mocked(finalizeAttachment).mockImplementation(() => new Promise(() => undefined));
  world = await mountWorld(FACTS); await settle();
  await chooseFromMenu(world.container, 'Inspirations'); await settle();
  await act(async () => world.container.querySelector<HTMLButtonElement>('.waka-list-row')!.click()); await settle();
  const lent = () => world.container.querySelector<HTMLElement>('nav.waka-dock #waka-note-tools');
  const add = lent()?.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]');
  expect(add, 'the saved note has no ＋ in its bar').toBeTruthy();
  expect(lent()!.querySelector('[data-home-action-icon="photo"]'), 'the saved note still has a photo button in its bar').toBeNull();
  await act(async () => add!.click());
  expect(rows().map(row => row.textContent?.trim())).toEqual(['Add photo', 'Add file']);
  await act(async () => { menu()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  await choose(accept => accept.includes('application/pdf'), new File(['plain words'], 'notes.md', { type: '' }));
  /* A `.md` arrives with no type; the verdict's type is the one sent. */
  expect(vi.mocked(presignAttachment).mock.calls[0]![0]).toMatchObject({ filename: 'notes.md', contentType: 'text/markdown' });
  expect(vi.mocked(finalizeAttachment).mock.calls[0]![0]).toMatchObject({ type: 'file', inspirationId: 'kept', name: 'notes.md', contentType: 'text/markdown' });
});
