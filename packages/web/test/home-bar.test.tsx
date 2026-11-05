// @vitest-environment jsdom
/**
 * THE HOME BAR AND THE STREAM, HELD TO THE BRIEF (waka-design-brief.md §3c,
 * §3d, §6, §8, §9).
 *
 * These render the two components on their own, with plain props, because
 * what they promise is about the components — one primary control, Enter
 * saves, "Saved" stands for 1.5s and leaves, a section with nothing in it is
 * not drawn, delete asks once — and none of it needs the world behind it.
 * The world's wiring (Home → keepIt → the save pipeline) is covered by the
 * home suites that mount `Home`.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): nothing. No API is reached; the
 * components take data and hand acts back as callbacks, and the callbacks
 * are what is asserted.
 */
import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { AddMenu } from '../src/components/AddMenu';
import { HomeStream } from '../src/components/HomeStream';
import { InspirationBar, SAVED_NOTICE_MS } from '../src/components/InspirationBar';
import type { ApiPrinciple } from '../src/lib/api/principles';
import type { Inspiration, Signal } from '../src/lib/data';

let root: Root, host: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = ''; vi.useRealTimers(); });

type BarProps = Parameters<typeof InspirationBar>[0];
function bar(overrides: Partial<BarProps> = {}): BarProps {
  return { locale: 'en-US', text: '', onText: () => {}, media: [], onRemoveMedia: () => {}, onFiles: () => {},
    onSubmit: () => {}, busy: false, error: '', savedAt: 0, inputRef: createRef<HTMLTextAreaElement>(), ...overrides };
}
const field = () => host.querySelector<HTMLTextAreaElement>('textarea')!;
const press = (key: string, init: KeyboardEventInit = {}) =>
  act(async () => { field().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })); });

it('is the one primary control, and says paste/type/drop rather than "inspiration"', async () => {
  await act(async () => root.render(<InspirationBar {...bar()} />));
  expect(host.querySelectorAll('[data-primary="true"]')).toHaveLength(1);
  expect(field().placeholder).toBe('Paste, type, or drop anything');
  // §3c: "The word 'inspiration' does not appear on this screen as a verb or button."
  const said = [...host.querySelectorAll('button, [aria-label], [placeholder]')]
    .map((node) => `${node.textContent} ${node.getAttribute('aria-label') ?? ''} ${node.getAttribute('placeholder') ?? ''}`).join(' ');
  expect(said.toLowerCase()).not.toContain('inspiration');
  // The arrow only appears when there is something to keep.
  expect(host.querySelector('button[type="submit"]')).toBeNull();
  await act(async () => root.render(<InspirationBar {...bar({ text: 'a thought' })} />));
  expect(host.querySelector('button[type="submit"]')?.getAttribute('aria-label')).toBe('Save');
});

it('saves on Enter and on Ctrl/Cmd+Enter; Shift+Enter is a new line; an IME composition is not ours', async () => {
  const onSubmit = vi.fn();
  await act(async () => root.render(<InspirationBar {...bar({ text: 'https://example.com', onSubmit })} />));
  await press('Enter'); expect(onSubmit).toHaveBeenCalledTimes(1);
  await press('Enter', { ctrlKey: true }); expect(onSubmit).toHaveBeenCalledTimes(2);
  await press('Enter', { metaKey: true }); expect(onSubmit).toHaveBeenCalledTimes(3);
  await press('Enter', { shiftKey: true }); expect(onSubmit).toHaveBeenCalledTimes(3);
  await press('Enter', { isComposing: true }); expect(onSubmit).toHaveBeenCalledTimes(3);
});

it('does not save nothing, and does not save while a save is already going', async () => {
  const onSubmit = vi.fn();
  await act(async () => root.render(<InspirationBar {...bar({ text: '   ', onSubmit })} />));
  await press('Enter');
  await act(async () => root.render(<InspirationBar {...bar({ text: 'words', busy: true, onSubmit })} />));
  await press('Enter');
  expect(onSubmit).not.toHaveBeenCalled();
});

it('raises "Saved" for 1.5s per save, and says "Saved, will sync" with no connection', async () => {
  const props = bar();
  await act(async () => root.render(<InspirationBar {...props} savedAt={0} />));
  const notice = () => host.querySelector('[role="status"]')!;
  expect(notice().textContent).toBe('');
  await act(async () => root.render(<InspirationBar {...props} savedAt={1} />));
  expect(notice().textContent).toBe('Saved');
  await act(async () => { vi.advanceTimersByTime(SAVED_NOTICE_MS - 1); });
  expect(notice().textContent).toBe('Saved');
  await act(async () => { vi.advanceTimersByTime(1); });
  expect(notice().textContent).toBe('');
  // A re-render alone does not bring it back; only a new save does.
  await act(async () => root.render(<InspirationBar {...props} savedAt={1} text="x" />));
  expect(notice().textContent).toBe('');
  await act(async () => root.render(<InspirationBar {...props} savedAt={2} savedLater />));
  expect(notice().textContent).toBe('Saved, will sync');
});

it('says a failure under the field and keeps the words in it', async () => {
  await act(async () => root.render(<InspirationBar {...bar({ text: 'still here', error: 'Couldn’t save this. Your draft is still here.' })} />));
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Couldn’t save');
  expect(field().value).toBe('still here');
  expect(field().getAttribute('aria-invalid')).toBe('true');
});

const save = (id: string, preview: string, daysAgo: number, source: Inspiration['source'] = 'app'): Inspiration => ({
  id, preview, isPublic: false, kind: 'note', source, capturedMs: Date.parse('2026-11-05T12:00:00Z') - daysAgo * 864e5,
  updatedMs: 0, attachments: [], reflectionCount: 0, category: null,
});
const signal = (id: string, statement: string, status: Signal['status'], inspirationIds: string[] = []): Signal => ({
  id, statement, status, inspirationIds, confidence: 72, evidenceCount: 3, lastEvidenceMs: 1, createdMs: 1, locked: false, unsupported: false,
} as Signal);
const principle = (id: string, statement: string, rank: number) => ({ id, statement, rank } as ApiPrinciple);
type StreamProps = Parameters<typeof HomeStream>[0];
function stream(overrides: Partial<StreamProps> = {}): StreamProps {
  return { locale: 'en-US', inspirations: [], signals: [], principles: [], textOf: () => undefined, onDelete: async () => {}, ...overrides };
}

it('draws nothing at all when there is nothing — no placeholder (§6)', async () => {
  await act(async () => root.render(<HomeStream {...stream()} />));
  expect(host.innerHTML).toBe('');
});

it('reads in the loop\'s order — saves, patterns, principles — newest save first, no numbers but dates', async () => {
  await act(async () => root.render(<HomeStream {...stream({
    inspirations: [save('old', 'older one', 4), save('new', 'newest one', 0), save('agent', 'from the agent', 2, 'agent')],
    signals: [signal('s1', 'You return to rituals.', 'active'), signal('s2', 'You might like making by hand.', 'emerging')],
    principles: [principle('p2', 'Second', 2), principle('p1', 'First', 1)],
  })} />));
  const labels = [...host.querySelectorAll('h2')].map((node) => node.textContent);
  expect(labels).toEqual(['Saves', 'Patterns', 'Principles']);
  const cards = [...host.querySelectorAll('.waka-stream-card')].map((node) => node.querySelector('.waka-stream-preview')!.textContent);
  expect(cards).toEqual(['newest one', 'from the agent', 'older one']);
  expect(host.textContent).toContain('From your agent');
  // §9.6: a tentative signal is marked in words, not only in light.
  const forming = host.querySelector('[data-forming]')!;
  expect(forming.textContent).toContain('Still forming');
  expect([...host.querySelectorAll('.waka-stream-statement p')].slice(-2).map((n) => n.textContent)).toEqual(['First', 'Second']);
  // §8 and "states render, numerals never": no count, score or confidence.
  const withoutDates = host.textContent!.replace(/[A-Z][a-z]{2} \d{1,2}, \d{4}/g, '');
  expect(withoutDates).not.toMatch(/\d/);
});

it('opens a save in a sheet with what it supports, and deletes only on the second press', async () => {
  const onDelete = vi.fn(async () => {});
  await act(async () => root.render(<HomeStream {...stream({
    inspirations: [save('a', 'a kept thought', 0)],
    signals: [signal('s1', 'It supports this.', 'active', ['a']), signal('s2', 'Not this one.', 'active', ['b'])],
    textOf: (id) => (id === 'a' ? 'a kept thought, in full' : undefined), onDelete,
  })} />));
  await act(async () => host.querySelector<HTMLButtonElement>('.waka-stream-card')!.click());
  const sheet = document.querySelector('[role="dialog"]')!;
  expect(sheet.textContent).toContain('a kept thought, in full');
  expect(sheet.textContent).toContain('What this supports');
  expect(sheet.textContent).toContain('It supports this.');
  expect(sheet.textContent).not.toContain('Not this one.');
  const button = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((node) => node.textContent === name)!;
  await act(async () => button('Delete').click());
  expect(onDelete).not.toHaveBeenCalled();
  await act(async () => button('Keep it').click());
  await act(async () => button('Delete').click());
  await act(async () => button('Delete for good').click());
  expect(onDelete).toHaveBeenCalledTimes(1);
});

it('draws a save the server has not answered yet, marked, and does not let it be opened', async () => {
  await act(async () => root.render(<HomeStream {...stream({
    inspirations: [save('pending:r1', 'kept offline', 0)],
    optimisticIds: new Set(['pending:r1']), pendingIds: new Set(['pending:r1']),
  })} />));
  const card = host.querySelector('.waka-stream-card')!;
  expect(card.tagName).toBe('DIV');
  expect(card.textContent).toContain('Not synced yet');
});

it('dictates while the voice row is held and stops on release; the keyboard toggles it', async () => {
  const onHoldStart = vi.fn(), onHoldEnd = vi.fn();
  const render = (listening: boolean) => root.render(<AddMenu buttonClassName="x" label="Add" photoLabel="Add photo" fileLabel="Add file"
    onPhotos={() => {}} onFiles={() => {}} voice={{ label: 'Hold to speak', listening, onHoldStart, onHoldEnd }} />);
  await act(async () => render(false));
  await act(async () => host.querySelector<HTMLButtonElement>('button')!.click());
  const row = () => [...host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((node) => node.textContent === 'Hold to speak')!;
  await act(async () => { row().dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 })); });
  expect(onHoldStart).toHaveBeenCalledTimes(1);
  await act(async () => { row().dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 })); });
  expect(onHoldEnd).toHaveBeenCalledTimes(1);
  await act(async () => host.querySelector<HTMLButtonElement>('button')!.click());
  await act(async () => { row().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
  expect(onHoldStart).toHaveBeenCalledTimes(2);
  await act(async () => render(true));
  await act(async () => { row().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
  expect(onHoldEnd).toHaveBeenCalledTimes(2);
});
