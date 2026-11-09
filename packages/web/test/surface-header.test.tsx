// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY (gate G6): `lib/platform`, `@capacitor/core` and
 * `@capacitor/app` stand in for the device bridge (Capacitor's platform and
 * its Android back listener); synthetic touch events supply finger
 * coordinates. Nothing else is mocked: the real header, its gesture guards,
 * the real `DialogSurface` and the real `ListeningView` run.
 *
 * THE ONE HEADER, HELD (nav system, 2026-11-09). Founder: "some parts just use
 * < but some are < back and like certain headers and things appear in certain
 * places vs disappear in certain". Every surface that is not home draws
 * `SurfaceHeader`; this suite holds what the component itself promises, and
 * `nav-system.test.tsx` holds every page and sheet to drawing it. */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SurfaceHeader } from '../src/components/SurfaceHeader';
import { DialogSurface } from '../src/components/DialogSurface';
import { ListeningView } from '../src/components/ListeningView';

const device = vi.hoisted(() => ({ platform: 'ios', native: true, back: null as (() => void) | null, remove: vi.fn() }));
vi.mock('../src/lib/platform', () => ({ get isMobileBuild() { return device.native; } }));
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => device.platform } }));
vi.mock('@capacitor/app', () => ({ App: { addListener: vi.fn(async (_name: string, callback: () => void) => {
  device.back = callback; return { remove: device.remove };
}) } }));

let host: HTMLDivElement, root: Root;
const back = vi.fn();
beforeEach(() => {
  device.platform = 'ios'; device.native = true; device.back = null; device.remove.mockClear(); back.mockClear();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

/** What a sighted reader sees in an element: its text without the screen-reader-only parts. */
function seen(node: Element): string {
  const copy = node.cloneNode(true) as Element;
  copy.querySelectorAll('.sr-only').forEach(part => part.remove());
  return copy.textContent?.trim() ?? '';
}

describe('the "<" is one glyph, named by what it does', () => {
  it.each([['back', 'Back'], ['close', 'Close']] as const)('a %s "<" is named %s and shows no word', async (kind, name) => {
    await act(async () => root.render(<SurfaceHeader locale="en-US" back={{ kind, onBack: back }} title="Kept" />));
    const head = host.querySelector('header.waka-surface-head')!;
    const presses = head.querySelectorAll('button');
    expect(presses, 'the header holds more than its "<"').toHaveLength(1);
    const glyph = head.querySelector<HTMLButtonElement>(':scope > button.waka-surface-back')!;
    expect(glyph.getAttribute('aria-label')).toBe(name);
    expect(glyph.querySelector('svg'), 'the "<" is not drawn').not.toBeNull();
    expect(seen(glyph), 'a word is written beside the "<"').toBe('');
    expect(head.firstElementChild, 'the "<" is not first in the row').toBe(glyph);
    await act(async () => glyph.click());
    expect(back).toHaveBeenCalledOnce();
  });

  it('says the same two names in Korean', async () => {
    await act(async () => root.render(<SurfaceHeader locale="ko-KR" back={{ kind: 'back', onBack: back }} />));
    expect(host.querySelector('.waka-surface-back')!.getAttribute('aria-label')).toBe('뒤로');
    await act(async () => root.render(<SurfaceHeader locale="ko-KR" back={{ kind: 'close', onBack: back }} />));
    expect(host.querySelector('.waka-surface-back')!.getAttribute('aria-label')).toBe('닫기');
  });

  it('centres one title, names an empty one for a reader, and holds at most one right-hand item', async () => {
    await act(async () => root.render(<SurfaceHeader locale="en-US" back={{ kind: 'close', onBack: back }} title="Past chats"
      right={<button type="button">New chat</button>} />));
    const head = host.querySelector('.waka-surface-head')!;
    expect([...head.children].map(child => child.className.split(' ')[0])).toEqual(['waka-surface-back', 'waka-surface-title', 'waka-surface-right']);
    expect(head.querySelector('h2.waka-surface-title')?.textContent).toBe('Past chats');
    expect(head.querySelector('.waka-surface-right')!.children).toHaveLength(1);

    await act(async () => root.render(<SurfaceHeader locale="en-US" back={{ kind: 'back', onBack: back }} srTitle="Principles" />));
    expect(host.querySelector('h2.waka-surface-title.sr-only')?.textContent, 'an empty title has no name for a reader').toBe('Principles');
  });

  it('is in the flow of its surface, never fixed or floating', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../src/styles/claims.css'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ');
    const rules = [...css.matchAll(/([^{}]*\.waka-surface-head[^{}]*)\{([^{}]*)\}/g)];
    expect(rules.length, 'no rule draws the header').toBeGreaterThan(0);
    for (const [, selector, body] of rules) {
      if (/login-shell|waka-surface-strip/.test(selector!)) continue;
      expect(body, `${selector!.trim()} takes the header out of its surface's flow`).not.toMatch(/position:\s*(fixed|absolute)/);
    }
    const head = rules.find(([, selector]) => selector!.trim() === '.waka-surface-head')![2]!;
    expect(head).toMatch(/height:\s*var\(--waka-corner\)/);
  });
});

describe('Escape is the "<"', () => {
  it('calls the same handler from inside a surface that passes its back as onClose', async () => {
    await act(async () => root.render(<DialogSurface modal={false} onClose={back} aria-label="Kept">
      <SurfaceHeader locale="en-US" back={{ kind: 'close', onBack: back }} title="Kept" /><input aria-label="field" />
    </DialogSurface>));
    await act(async () => host.querySelector('input')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    await act(async () => host.querySelector<HTMLButtonElement>('.waka-surface-back')!.click());
    expect(back).toHaveBeenCalledTimes(2);
  });
});

describe('a page\'s native back is the "<" too', () => {
  async function touch(type: string, x: number, y: number, target: Element = host, count = 1) {
    await act(async () => {
      const point = { clientX: x, clientY: y };
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, {
        touches: { value: type === 'touchend' ? [] : Array.from({ length: count }, () => point) },
        changedTouches: { value: [point] },
      });
      target.dispatchEvent(event);
    });
  }
  const page = (key: string | null = 'note') => act(async () => root.render(
    <SurfaceHeader locale="en-US" back={{ kind: 'back', onBack: back }} gesture={key} />));

  it('finishes a left-edge swipe with the same handler as the "<"', async () => {
    await page();
    await touch('touchstart', 8, 200); await touch('touchmove', 90, 205);
    expect(host.querySelector('.waka-back-swipe')).not.toBeNull();
    await touch('touchend', 90, 205);
    expect(back).toHaveBeenCalledOnce();
    expect(host.querySelector('.waka-back-swipe')).toBeNull();
  });

  it('leaves interior drags, vertical scrolls, short swipes, cancellation and two fingers alone', async () => {
    await page();
    for (const [x, dx, dy, finish, fingers] of [[80, 90, 0, 'touchend', 1], [8, 10, 80, 'touchend', 1],
      [8, 25, 0, 'touchend', 1], [8, 90, 0, 'touchcancel', 1], [8, 90, 0, 'touchend', 2]] as const) {
      await touch('touchstart', x, 200); await touch('touchmove', x + dx, 200 + dy, host, fingers);
      await touch(finish, x + dx, 200 + dy);
    }
    expect(back).not.toHaveBeenCalled();
  });

  it('does not navigate through editors or an open sheet, or finish a gesture from an old page', async () => {
    await page();
    const editor = document.createElement('textarea'); host.append(editor);
    await touch('touchstart', 8, 200, editor); await touch('touchend', 100, 200, editor);
    const modal = document.createElement('div'); modal.setAttribute('aria-modal', 'true'); document.body.append(modal);
    await touch('touchstart', 8, 200); await touch('touchend', 100, 200); modal.remove();
    await touch('touchstart', 8, 200); await page('list'); await touch('touchend', 100, 200);
    expect(back).not.toHaveBeenCalled();
  });

  it('turns no gesture on for a sheet, or in a browser', async () => {
    await page(null);
    await touch('touchstart', 8, 200); await touch('touchend', 100, 200);
    device.native = false; await page('note');
    await touch('touchstart', 8, 200); await touch('touchend', 100, 200);
    expect(back).not.toHaveBeenCalled();
  });

  it("answers Android's back with the page's handler, or an open sheet's Escape", async () => {
    device.platform = 'android'; await page();
    for (let turn = 0; turn < 5 && !device.back; turn += 1) await act(async () => { await Promise.resolve(); });
    await act(async () => device.back!());
    expect(back).toHaveBeenCalledOnce();
    const sheet = document.createElement('div'); sheet.setAttribute('aria-modal', 'true'); document.body.append(sheet);
    const heard = vi.fn(); sheet.addEventListener('keydown', event => heard(event.key));
    await act(async () => device.back!());
    expect(heard).toHaveBeenCalledWith('Escape');
    expect(back).toHaveBeenCalledOnce();
    sheet.remove();
  });
});

describe('listening is a full-screen layer', () => {
  it('makes everything behind it inert while open, Escape is Done, and the page under it never hears it', async () => {
    const outside = document.createElement('button'); outside.textContent = 'behind'; document.body.append(outside);
    const done = vi.fn(), leave = vi.fn();
    const mount = (listening: boolean) => act(async () => root.render(<DialogSurface modal={false} onClose={leave} aria-label="Note">
      <SurfaceHeader locale="en-US" back={{ kind: 'close', onBack: leave }} />
      <p className="page-words">words</p>
      {listening ? <ListeningView locale="en-US" words="hello" onDone={done} /> : null}
    </DialogSurface>));
    try {
      await mount(true);
      expect(host.querySelector('.waka-surface-head')!.closest('[inert]'), 'the header behind the view can still be tabbed to').not.toBeNull();
      expect(host.querySelector('.page-words')!.closest('[inert]')).not.toBeNull();
      expect(outside.closest('[inert]'), 'the page beyond the surface is still live').not.toBeNull();
      expect(host.querySelector('.waka-listening')!.closest('[inert]'), 'the view itself went inert').toBeNull();
      await act(async () => host.querySelector('.waka-listening-done')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
      expect(done).toHaveBeenCalledOnce();
      expect(leave, 'Escape in the view closed the note under it').not.toHaveBeenCalled();
      await mount(false);
      expect(document.querySelectorAll('[inert]'), 'the page stayed inert after the view closed').toHaveLength(0);
    } finally { outside.remove(); }
  });
});
