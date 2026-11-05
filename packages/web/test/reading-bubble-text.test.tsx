// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY (gate G6): nothing imported. The component is
 * rendered on its own and its acts are asserted through the DOM.
 *
 * THE READING IS IN FULL NOW (waka-design-brief.md §3b). It was clamped with
 * "Read in full" / "View reading" opening a sheet; the brief shows every word
 * in the bubble and makes the footer "Why?" and "Talk about this". The sheet
 * those buttons opened still exists — it holds the founder's edit, remove and
 * share — and is reached through "Why?" → "Edit or remove". These tests keep
 * every promise the sheet made (it holds its version, focus, scroll and share
 * target until closed; Escape closes it and returns focus), entered the new
 * way. */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { ReadingBubbleText } from '../src/components/ReadingBubbleText';

afterEach(() => vi.restoreAllMocks());

function named(host: ParentNode, name: string): HTMLButtonElement {
  const found = [...host.querySelectorAll<HTMLButtonElement>('button')].find((node) => node.textContent === name);
  if (!found) throw new Error(`no button named ${name}`);
  return found;
}
async function openSheet(host: HTMLElement): Promise<HTMLButtonElement> {
  if (named(host, 'Why?').getAttribute('aria-expanded') !== 'true') await act(async () => named(host, 'Why?').click());
  const opener = named(host, 'Edit or remove');
  await act(async () => { opener.focus(); opener.click(); });
  return opener;
}

it('holds the expanded version, focus, scroll and share target until it is closed', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const firstShare = vi.fn(), nextShare = vi.fn();
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<ReadingBubbleText text="The original reading." locale="en-US" onShare={firstShare} />));
    await openSheet(host);
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
    await openSheet(host);
    expect(document.querySelector('.waka-reading-full p')?.textContent).toBe('A refreshed reading.');
    await act(async () => root.render(<ReadingBubbleText key="another-profile" text="Another profile." locale="en-US" />));
    expect(document.querySelector('.waka-reading-full')).toBeNull();
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it('keeps sharing inside the sheet, and Talk about this goes straight to the chat', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const share = vi.fn(), chat = vi.fn(), host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<ReadingBubbleText text="A short reading." locale="en-US" onShare={share} onChat={chat} />));
    expect(host.textContent).not.toContain('Share it');
    // The footer is the brief's two acts, text only, and nothing else.
    expect([...host.querySelectorAll('.jar-char-bubble-acts > button')].map((n) => n.textContent)).toEqual(['Why?', 'Talk about this']);
    await act(async () => named(host, 'Talk about this').click());
    expect(chat).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    const opener = await openSheet(host);
    const shareButton = document.querySelector<HTMLButtonElement>('.waka-reading-full footer button')!;
    expect(shareButton.textContent).toBe('Share it');
    await act(async () => shareButton.click());
    expect(share).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(opener);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it('shows every word with no "Read in full", and the sheet closes by Escape returning focus', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const long = 'Every word remains available. '.repeat(12).trim();
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<ReadingBubbleText text={long} locale="en-US" onShare={() => {}} />));
    expect(host.querySelector('.jar-char-bubble-reading')?.textContent).toBe(long);
    expect(host.textContent).not.toMatch(/Read in full|View reading|…/);
    const opener = await openSheet(host);
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.textContent).toContain('Every word remains available.');
    expect(dialog.querySelector('button')?.textContent).toBe('Close');
    await act(async () => dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(opener);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it('answers Why? in place with the saves behind the entry, and pages by dots with no numerals', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const onGo = vi.fn(), host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<ReadingBubbleText text="First entry." locale="en-US"
      why={[{ id: 'a', preview: 'A kept walk home' }, { id: 'b', preview: 'A quiet morning' }]}
      pager={{ count: 3, at: 0, onGo }} />));
    expect(host.querySelector('.waka-says-why')).toBeNull();
    await act(async () => named(host, 'Why?').click());
    expect(named(host, 'Why?').getAttribute('aria-expanded')).toBe('true');
    expect([...host.querySelectorAll('.waka-says-why-row')].map((n) => n.textContent)).toEqual(['A kept walk home', 'A quiet morning']);
    expect(document.querySelector('[role="dialog"]'), 'Why? opened a page').toBeNull();
    const dots = [...host.querySelectorAll<HTMLButtonElement>('.waka-says-dot')];
    expect(dots).toHaveLength(3);
    expect(dots[0]!.getAttribute('aria-current')).toBe('true');
    expect(dots.map((d) => d.textContent).join('')).toBe('');
    expect(dots[1]!.getAttribute('aria-label')).toBe('Reading 2 of 3');
    await act(async () => dots[2]!.click());
    expect(onGo).toHaveBeenCalledWith(2);
  } finally { await act(async () => root.unmount()); host.remove(); }
});
