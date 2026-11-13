// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY (gate G6): `components/ReadingDetails` reads the entry from
 * the API; here it is a stand-in that shows its words and whether it opened
 * for editing, because this file tests the bubble, not the edit flow. */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { ReadingBubbleText } from '../src/components/ReadingBubbleText';

vi.mock('../src/components/ReadingDetails', () => ({
  default: ({ text, startEditing }: { text: string; startEditing?: boolean }) => <p data-editing={String(Boolean(startEditing))}>{text}</p>,
}));

afterEach(() => vi.restoreAllMocks());
const details = { profileId: 'p', onMutation: () => () => undefined, onUpdated: () => undefined };
it('shows the whole read with nothing to open, and its acts in one row', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const share = vi.fn(), chat = vi.fn(), onWhy = vi.fn(), host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<ReadingBubbleText text="A long reading that the bubble holds whole." locale="en-US"
      why={[{ id: 'a', preview: 'x' }]} onWhy={onWhy} onShare={share} onChat={chat} details={details} />));
    /* NO "READ IN FULL": the sentence is plain words, not a door. */
    expect(host.querySelector('.waka-reading-preview button')).toBeNull();
    expect(host.querySelector('.jar-char-bubble-reading')?.textContent).toBe('A long reading that the bubble holds whole.');
    const acts = [...host.querySelectorAll<HTMLButtonElement>('.jar-char-bubble-acts button')];
    expect(acts.map(b => b.textContent || b.getAttribute('aria-label'))).toEqual(['Why?', 'Chat about this', 'Share', 'Edit']);
    await act(async () => acts[2]!.click());
    expect(share).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  } finally { await act(async () => root.unmount()); host.remove(); }
});
it('opens Edit on the quiet page already editing, closes by Escape, and returns focus', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<ReadingBubbleText text="Every word remains available." locale="en-US" details={details} />));
    const edit = host.querySelector<HTMLButtonElement>('button[aria-label="Edit"]')!;
    await act(async () => { edit.focus(); edit.click(); });
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    await vi.waitFor(() => expect(dialog.querySelector('[data-editing="true"]')?.textContent).toBe('Every word remains available.'));
    expect(dialog.querySelector('button')?.getAttribute('aria-label')).toBe('Close');
    await act(async () => dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(edit);
  } finally { await act(async () => root.unmount()); host.remove(); }
});
it('offers no acts row when there is nothing to do', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<ReadingBubbleText text="Just words." locale="en-US" />));
    expect(host.querySelector('.jar-char-bubble-acts')).toBeNull();
    expect(host.querySelector('button')).toBeNull();
  } finally { await act(async () => root.unmount()); host.remove(); }
});

/* DESIGN F2: "Why?" turns the bubble over to the saves behind the read —
   "Because you saved these", each quoted — with Back and See all saves. */
/* WHY? OPENS A CHAT (founder, 2026-11-12): the bubble hands the press to
   Home, which opens WAKA's account of how the read was formed. */
it('hands Why? to Home rather than folding into a list', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const onWhy = vi.fn(), chat = vi.fn(), host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const why = [{ id: 'a', preview: 'Small rituals hold a day together.' }];
  try {
    await act(async () => root.render(<ReadingBubbleText text="You keep returning to small rituals." locale="en-US" why={why} onWhy={onWhy} onChat={chat} />));
    const acts = () => [...host.querySelectorAll<HTMLButtonElement>('.jar-char-bubble-acts button')];
    expect(acts().map(button => button.textContent)).toEqual(['Why?', 'Chat about this']);
    await act(async () => acts()[0]!.click());
    expect(onWhy).toHaveBeenCalledOnce();
    expect(host.textContent, 'the bubble folded into a list').toContain('You keep returning to small rituals.');
  } finally { await act(async () => root.unmount()); host.remove(); }
});
