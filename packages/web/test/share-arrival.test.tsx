// @vitest-environment jsdom
/**
 * SAVING FROM OUTSIDE THE APP (waka-design-brief.md §4): the share sheet's
 * `/share`, and the bookmarklet that opens it.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): nothing. `sharedText` and
 * `bookmarkletHref` are pure; `ShareArrival` is rendered under a real
 * in-memory router and its hand-off is read back from session storage.
 * The save itself is the home's existing outbox, covered by the home suites.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it } from 'vitest';

import { SHARED_KEY, ShareArrival, sharedText, type SharedPayload } from '../src/components/ShareArrival';
import { bookmarkletHref } from '../src/lib/bookmarklet';

let root: Root, host: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  sessionStorage.clear();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it('keeps the words, then the address — each once', () => {
  expect(sharedText({ title: 'An essay', text: '', url: 'https://example.com/a' }))
    .toEqual({ text: 'An essay\nhttps://example.com/a', url: 'https://example.com/a' });
  expect(sharedText({ title: 'Page', text: 'a selected sentence', url: 'https://example.com/b' }))
    .toEqual({ text: 'a selected sentence\nhttps://example.com/b', url: 'https://example.com/b' });
  // Android often sends the page's address as `text`, with no `url`.
  expect(sharedText({ title: '', text: 'https://example.com/c', url: '' }))
    .toEqual({ text: 'https://example.com/c', url: 'https://example.com/c' });
  expect(sharedText({ title: '', text: 'just words', url: '' })).toEqual({ text: 'just words', url: null });
  // Not a web address: not a link.
  expect(sharedText({ title: '', text: 'x', url: 'javascript:alert(1)' }).url).toBeNull();
  expect(sharedText({ title: '', text: '', url: '' }).text).toBe('');
});

it('hands a share to the home and steps there, with nothing on screen', async () => {
  await act(async () => root.render(
    <MemoryRouter initialEntries={['/share?title=T&url=https%3A%2F%2Fexample.com%2Fx&via=bookmarklet']}>
      <Routes><Route path="/share" element={<ShareArrival />} /><Route path="/" element={<p>home</p>} /></Routes>
    </MemoryRouter>,
  ));
  expect(host.textContent).toBe('home');
  const handed = JSON.parse(sessionStorage.getItem(SHARED_KEY)!) as SharedPayload;
  expect(handed).toMatchObject({ title: 'T', url: 'https://example.com/x', text: '', via: 'bookmarklet' });
});

it('hands nothing over when nothing was shared', async () => {
  await act(async () => root.render(
    <MemoryRouter initialEntries={['/share']}>
      <Routes><Route path="/share" element={<ShareArrival />} /><Route path="/" element={<p>home</p>} /></Routes>
    </MemoryRouter>,
  ));
  expect(sessionStorage.getItem(SHARED_KEY)).toBeNull();
});

it('builds a bookmarklet that opens this origin\'s /share with the page, its title and the selection', () => {
  const href = bookmarkletHref('https://dev.waka.im');
  expect(href.startsWith('javascript:')).toBe(true);
  const opened: string[] = [];
  const fake = { getSelection: () => 'picked words', location: { href: 'https://news.example/story?id=1' }, document: { title: 'A story' },
    window: { open: (url: string) => { opened.push(url); } } };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function('getSelection', 'location', 'document', 'window', href.slice('javascript:'.length))(fake.getSelection, fake.location, fake.document, fake.window);
  const url = new URL(opened[0]!);
  expect(url.origin + url.pathname).toBe('https://dev.waka.im/share');
  expect(Object.fromEntries(url.searchParams)).toEqual({
    via: 'bookmarklet', url: 'https://news.example/story?id=1', title: 'A story', text: 'picked words',
  });
});
