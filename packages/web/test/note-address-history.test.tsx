// @vitest-environment jsdom
/**
 * THE OPEN SAVED NOTE IS AN ADDRESS, AND HISTORY IS THE ROUTER'S.
 *
 * `docs/plans/back-from-layers.md`: Back from an open note skipped the list
 * and closed the whole archive, because the note had no entry of its own.
 * It has one now (`?open=saves&note=<id>`), pushed when it opens — so what
 * this suite pins is everything AROUND that entry, which is where every
 * earlier attempt broke: closing the note returns through history; closing
 * the archive from a note steps over both entries; a replace that drops the
 * note does not leave the list's entry beneath to reopen it; and a replace
 * that would rewrite the rest of the address under the note is refused, so
 * the list's entry never holds a stale address.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): nothing. The real hook runs under a
 * real `MemoryRouter`, whose history has real back and forward entries.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { useViewNavigation } from '../src/lib/use-view-navigation';
import { EMPTY_VIEW } from '../src/lib/view-location';

let host: HTMLDivElement, root: Root;
let nav: ReturnType<typeof useViewNavigation>, go: ReturnType<typeof useNavigate>, here = '', noteFrom: string | undefined;
function Probe() {
  nav = useViewNavigation('me'); go = useNavigate();
  const location = useLocation(); here = location.pathname + location.search;
  noteFrom = (location.state as { wakaView?: { noteFrom?: string } } | null)?.wakaView?.noteFrom;
  return null;
}
async function mount(entries: string[]) {
  await act(async () => { root.render(<MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}><Probe/></MemoryRouter>); });
}
const run = async (fn: () => void) => { await act(async () => { fn(); }); await act(async () => { await Promise.resolve(); }); };
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

/** Home, then the archive opened over it, then a note opened in the archive. */
async function homeArchiveNote() {
  await mount(['/']);
  await run(() => nav.write({ ...EMPTY_VIEW, open: 'saves' }));
  await run(() => nav.write({ ...nav.view!, note: 'kept' }));
  expect(here).toBe('/?open=saves&note=kept');
}

it('closing the note on screen is the same step as Back: it returns to the list and keeps Forward', async () => {
  await homeArchiveNote();
  await run(() => nav.closeNote());
  expect(here).toBe('/?open=saves');
  /* The next Back leaves the archive — the list was one entry, not two. */
  await run(() => go(-1));
  expect(here).toBe('/');
  /* And Forward walks back in through both. */
  await run(() => go(1)); expect(here).toBe('/?open=saves');
  await run(() => go(1)); expect(here).toBe('/?open=saves&note=kept');
});

it('Back pops the note to the list, and Forward reopens it', async () => {
  await homeArchiveNote();
  await run(() => go(-1));
  expect(here).toBe('/?open=saves');
  await run(() => go(1));
  expect(here).toBe('/?open=saves&note=kept');
});

it('closing the archive from an open note steps over both entries to where it was opened from', async () => {
  await homeArchiveNote();
  await run(() => nav.closeOpen());
  expect(here).toBe('/');
  /* Nothing left behind: Back from here is whatever was before Home. */
  await run(() => go(1)); expect(here).toBe('/?open=saves');
});

it('from a cold archive link, closing from a note replaces the note entry, leaving no note in Forward', async () => {
  await mount(['/?open=saves']);
  await run(() => nav.write({ ...nav.view!, note: 'kept' }));
  await run(() => nav.closeOpen());
  expect(here).toBe('/');
  /* No dead note entry ahead. */
  await run(() => go(1));
  expect(here).toBe('/');
  /* The list the person did visit is still behind. */
  await run(() => go(-1));
  expect(here).toBe('/?open=saves');
});

it('a replace that drops the note (the bar moving you on) replaces the note entry itself', async () => {
  await homeArchiveNote();
  await run(() => nav.write({ ...nav.view!, open: 'claims', note: null }, { replace: true }));
  expect(here).toBe('/?open=claims');
  /* Nothing ahead: the note's entry became the destination. */
  await run(() => go(1));
  expect(here).toBe('/?open=claims');
  await run(() => go(-1));
  expect(here).toBe('/?open=saves');
});

/* Only the push that opens a note FROM THE LIST records the list as its
   return. A push made while a note is already open (the canonicaliser
   recording a moved world) stands on a note entry, not the list. */
it('a push made while a note is open records no list beneath it', async () => {
  await homeArchiveNote();
  await run(() => nav.write({ ...nav.view!, section: 'sky' }));
  expect(here).toBe('/?view=sky&open=saves&note=kept');
  expect(noteFrom).toBeUndefined();
  /* So closing the note there rewrites to its list rather than stepping
     back onto the other note entry. */
  await run(() => nav.closeNote());
  expect(here).toBe('/?view=sky&open=saves');
  await run(() => go(-1)); expect(here).toBe('/?open=saves&note=kept');
});

/* The return is stored canonically. A list reached by a non-canonical
   address (`view=top` is the default and is not written) still counts as
   the list beneath, so closing the note is a step back, not a rewrite. */
it('a list reached by a non-canonical address is still the return of the note opened over it', async () => {
  await mount(['/', '/?open=saves&view=top']);
  await run(() => nav.write({ ...nav.view!, note: 'kept' }));
  await run(() => nav.closeNote());
  expect(here).toBe('/?open=saves&view=top');
  await run(() => go(-1)); expect(here).toBe('/');
});

it('a replace that keeps the note but rewrites the rest is refused, so the list beneath never goes stale', async () => {
  await homeArchiveNote();
  await run(() => nav.write({ ...nav.view!, section: 'sky' }, { replace: true }));
  expect(here).toBe('/?open=saves&note=kept');
  /* Moving between notes in place keeps the list beneath, and its return. */
  await run(() => nav.write({ ...nav.view!, note: 'other' }, { replace: true }));
  expect(here).toBe('/?open=saves&note=other');
  await run(() => nav.closeNote());
  expect(here).toBe('/?open=saves');
  await run(() => go(-1)); expect(here).toBe('/');
});

it('a cold note link has no list beneath, so closing the note rewrites the address to the list', async () => {
  await mount(['/', '/?open=saves&note=kept']);
  await run(() => nav.closeNote());
  expect(here).toBe('/?open=saves');
  await run(() => go(-1)); expect(here).toBe('/');
});

it.each([
  ['/w/noah/noah?compose=1', '/w/noah/noah'],
  ['/w/noah/noah?open=saves&note=kept', '/w/noah/noah'],
  ['/w/anotherone?open=conversations', '/w/anotherone'],
  ['/chat/new?profile=noah', '/w/noah'],
  ['/chat/existing?profile=anotherone', '/w/anotherone'],
])('Close returns %s to its own profile even without prior history', async (path, home) => {
  await mount([path]);
  await run(() => nav.closeToHome());
  expect(here).toBe(home);
  expect(nav.view?.compose).toBe(false);
  expect(nav.view?.open).toBeNull();
  expect(nav.view?.conversationId).toBeNull();
});

it('a pending note close cannot undo the explicit Close to home', async () => {
  await homeArchiveNote();
  await run(() => { nav.closeToHome(); nav.closeNote(); });
  expect(here).toBe('/');
});
