// @vitest-environment jsdom
/**
 * ═══ A ROOM TO TALK IN (founder, 2026-11-09) ═══════════════════════════════
 *
 * "space feels so limited i dont feel like i can talk for hours". The view
 * held the words as one short centred line. What is held here: a long talk
 * is rendered in full inside a page that scrolls (never clipped to a line),
 * the newest words stay in view unless the person scrolled up to reread,
 * and the words still being guessed at arrive softly until they settle.
 * jsdom has no layout, so the scroll geometry is given by hand and the CSS is
 * read for the rules that would clip.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): `components/Companion` stands in for
 * the creature, which draws on a canvas. The view's own words, scroll and
 * settling run.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { ListeningView, settledLength } from '../src/components/ListeningView';

vi.mock('../src/components/Companion', () => ({ Companion: () => null }));

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });

const show = (words: string, notice?: string) =>
  act(async () => root.render(<ListeningView locale="en-US" words={words} notice={notice} onDone={() => {}} />));
const page = () => host.querySelector<HTMLDivElement>('.waka-listening-page')!;
const words = () => host.querySelector<HTMLElement>('.waka-listening-words')!;
/** jsdom lays nothing out; give the page a height and a scroll height. */
const geometry = (el: HTMLElement, scrollHeight: number, clientHeight: number) => {
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => scrollHeight });
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => clientHeight });
};
const css = readFileSync(join(__dirname, '..', 'src', 'styles', 'claims.css'), 'utf8');
const rule = (selector: string) => {
  const found = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(match => match[1]!.replace(/\/\*[\s\S]*?\*\//g, '').split(',').some(part => part.trim() === selector));
  return found?.[2] ?? '';
};

it('renders a long talk in full inside a page that scrolls, not cut to one line', async () => {
  const talk = Array.from({ length: 60 }, (_, at) => `This is sentence number ${at + 1} of a long talk about the coffee shop.`).join(' ')
    + '\n\nAnd a second paragraph after a pause.';
  await show(talk);
  expect(words().textContent, 'the transcript was shortened').toBe(talk);
  expect(page().contains(words()), 'the words are not inside the scrolling page').toBe(true);
  expect(rule('.waka-listening-page'), 'the page does not scroll').toMatch(/overflow-y:\s*auto/);
  const look = rule('.waka-listening-words');
  expect(look, 'the words do not keep their line breaks').toMatch(/white-space:\s*pre-wrap/);
  expect(look, 'the words are clipped to a line').not.toMatch(/nowrap|line-clamp|text-overflow|max-height/);
  /* The words are not a live region; "Listening…" is the one thing said. */
  expect(words().closest('[aria-live], [role="status"], [role="log"]')).toBeNull();
});

it('keeps the newest words in view, but not while the person has scrolled up to reread', async () => {
  await show('first words');
  const el = page();
  geometry(el, 2000, 500);
  await show('first words and more');
  expect(el.scrollTop, 'the newest words were not brought into view').toBe(2000);

  /* Up to reread: the page holds still as more words arrive. */
  el.scrollTop = 300; await act(async () => el.dispatchEvent(new Event('scroll')));
  geometry(el, 2400, 500);
  await show('first words and more and even more');
  expect(el.scrollTop, 'the page yanked the reader back down').toBe(300);

  /* Back down near the end: it follows again. */
  el.scrollTop = 1880; await act(async () => el.dispatchEvent(new Event('scroll')));
  geometry(el, 2800, 500);
  await show('first words and more and even more and the end');
  expect(el.scrollTop).toBe(2800);
});

it('lets the words still being guessed at arrive softly, then settle', async () => {
  vi.useFakeTimers();
  await show('what I wrote before.');
  expect(host.querySelector('.waka-listening-arriving'), 'the note already there read as arriving').toBeNull();
  await show('what I wrote before. the guy at the cof');
  expect(host.querySelector('.waka-listening-arriving')?.textContent).toBe(' the guy at the cof');
  await show('what I wrote before. the guy at the coffee shop');
  expect(host.querySelector('.waka-listening-arriving')?.textContent, 'a rewritten guess did not stay soft').toBe('coffee shop');
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(host.querySelector('.waka-listening-arriving'), 'the words never settled').toBeNull();
  expect(words().textContent).toBe('what I wrote before. the guy at the coffee shop');
});

it('rests what was said a while ago in dimmer ink than the last stretch', async () => {
  const long = 'An earlier thought that goes on for a while. '.repeat(20);
  await show(long);
  expect(host.querySelector('.waka-listening-earlier')?.textContent?.length).toBeGreaterThan(0);
  expect(host.querySelector('.waka-listening-recent')?.textContent?.length).toBeGreaterThan(0);
  expect(words().textContent).toBe(long);
});

it('finds where a new result stops matching the last, at a word\'s start', () => {
  expect(settledLength('the guy at the cof', 'the guy at the coffee shop')).toBe('the guy at the '.length);
  expect(settledLength('same', 'same')).toBe(4);
  expect(settledLength('', 'hello')).toBe(0);
  expect(settledLength('one two', 'one two three')).toBe('one two'.length);
  expect(settledLength('one tw', 'one two')).toBe('one '.length);
});

it('says where speech goes in one quiet line, with Done as a word', async () => {
  await show('', 'Your browser sends speech to its own service to turn it into text.');
  const foot = host.querySelector('.waka-listening-foot')!;
  expect(foot.querySelector('.waka-listening-notice')?.textContent).toBe('Your browser sends speech to its own service to turn it into text.');
  expect(foot.querySelector('.waka-listening-done')?.textContent).toBe('Done');
  expect(document.activeElement).toBe(foot.querySelector('.waka-listening-done'));
});
