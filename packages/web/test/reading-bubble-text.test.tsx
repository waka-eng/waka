// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY (gate G6): nothing imported. JSDOM has no layout,
 * so element heights and `ResizeObserver` supply the measured overflow.
 * `requestAnimationFrame` and `cancelAnimationFrame` deliver the deferred layout check. */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { ReadingBubbleText } from '../src/components/ReadingBubbleText';

afterEach(() => vi.restoreAllMocks());
it('holds the expanded version, focus, scroll and share target until it is closed', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const firstShare = vi.fn(), nextShare = vi.fn();
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<ReadingBubbleText text="The original reading." locale="en-US" onShare={firstShare} />));
    await act(async () => host.querySelector<HTMLButtonElement>('button')!.click());
    const dialog = document.querySelector<HTMLElement>('.waka-reading-full')!;
    const body = dialog.querySelector<HTMLElement>('.waka-reading-full-body')!;
    body.scrollTop = 120;
    const focused = document.activeElement;
    await act(async () => root.render(<ReadingBubbleText text="A refreshed reading." locale="en-US" onShare={nextShare} />));
    expect(document.querySelector('.waka-reading-full')).toBe(dialog);
    expect(dialog.querySelector('p')?.textContent).toBe('The original reading.');
    expect(body.scrollTop).toBe(120); expect(document.activeElement).toBe(focused);
    await act(async () => dialog.querySelector<HTMLButtonElement>('footer button')!.click());
    expect(firstShare).toHaveBeenCalledOnce(); expect(nextShare).not.toHaveBeenCalled();
    await act(async () => host.querySelector<HTMLButtonElement>('button')!.click());
    expect(document.querySelector('.waka-reading-full p')?.textContent).toBe('A refreshed reading.');
    await act(async () => root.render(<ReadingBubbleText key="another-profile" text="Another profile." locale="en-US" />));
    expect(document.querySelector('.waka-reading-full')).toBeNull();
  } finally { await act(async () => root.unmount()); host.remove(); }
});
it('keeps sharing available for a short reading only inside its expanded view', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const share = vi.fn(), chat = vi.fn(), host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<ReadingBubbleText text="A short reading." locale="en-US" onShare={share} onChat={chat} />));
    expect(host.textContent).not.toContain('Share it');
    await act(async () => host.querySelector<HTMLButtonElement>('.jar-char-bubble-acts button:last-child')!.click());
    expect(chat).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    const opener = host.querySelector<HTMLButtonElement>('button')!;
    expect(opener.textContent).toBe('View reading');
    await act(async () => { opener.focus(); opener.click(); });
    const shareButton = document.querySelector<HTMLButtonElement>('.waka-reading-full footer button')!;
    expect(shareButton.textContent).toBe('Share it');
    await act(async () => shareButton.click());
    expect(share).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(opener);
  } finally { await act(async () => root.unmount()); host.remove(); }
});
it('offers a full reading only when clipped, closes by Escape, and returns focus', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let height = 120, measure: () => void = () => {};
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => height);
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(240);
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { measure = callback; } observe() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<ReadingBubbleText text="Every word remains available." locale="en-US" />));
    const more = host.querySelector<HTMLButtonElement>('button')!;
    expect(more.textContent).toBe('Read in full');
    await act(async () => { more.focus(); more.click(); });
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.textContent).toContain('Every word remains available.');
    expect(dialog.querySelector('button')?.textContent).toBe('Close');
    await act(async () => dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(more);
    await act(async () => { height = 300; measure(); });
    expect(host.querySelector('button')).toBeNull();
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});
