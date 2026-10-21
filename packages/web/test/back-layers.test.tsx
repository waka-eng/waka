// @vitest-environment jsdom
/**
 * BACK CLOSES THE TOPMOST LAYER WITHOUT ADDING ENTRIES — `lib/back-layers.ts`,
 * against jsdom's real session history (real `pushState`, real asynchronous
 * `history.back()` and `popstate`). Router entries are imitated by their state
 * shape `{ usr, key, idx }`, which is all the module reads.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, expect, it } from 'vitest';
import { expectAppPop, noteEntry, useBackLayer } from '../src/lib/back-layers';

beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });

let root: Root | null = null;
afterEach(() => { act(() => root?.unmount()); root = null; });

/** A router push: a fresh entry, then the module told where we are. */
function push(key: string, href: string): void {
  const idx = typeof window.history.state?.idx === 'number' ? window.history.state.idx + 1 : 0;
  window.history.pushState({ usr: null, key, idx }, '', href);
  noteEntry();
}
function replace(key: string, href: string): void {
  window.history.replaceState({ usr: null, key, idx: window.history.state.idx }, '', href);
  noteEntry();
}
/** The person's Back, and whatever listener runs after ours. */
async function back(): Promise<{ heard: boolean }> {
  let heard = false;
  const later = () => { heard = true; };
  window.addEventListener('popstate', later);
  /* A caught pop stops every later listener, so the wait cannot be one. */
  window.history.back();
  await new Promise((resolve) => setTimeout(resolve, 50));
  window.removeEventListener('popstate', later);
  return { heard };
}

function Layers({ open, closed }: { open: string[]; closed: string[] }) {
  return createElement('div', null, ...open.map((name) => createElement(Layer, { key: name, name, closed })));
}
function Layer({ name, closed }: { name: string; closed: string[] }) {
  useBackLayer(true, () => closed.push(name));
  return null;
}
function show(open: string[], closed: string[]): void {
  const host = document.createElement('div');
  document.body.appendChild(host);
  root ??= createRoot(host);
  act(() => root!.render(createElement(Layers, { open, closed })));
}

it('Back with a layer open closes it, keeps the address and key, and adds no entry', async () => {
  push('world', '/a');
  push('list', '/a?open=saves');
  const length = window.history.length;
  const closed: string[] = [];
  show(['note'], closed);
  const { heard } = await back();
  expect(closed).toEqual(['note']);
  expect(heard, 'the router heard a Back the layer took').toBe(false);
  expect(window.location.pathname + window.location.search).toBe('/a?open=saves');
  expect(window.history.state).toMatchObject({ key: 'list' });
  expect(window.history.length, 'a layer left an entry behind').toBe(length);
});

it('Back with no layer open is the router’s', async () => {
  push('world', '/b');
  push('list', '/b?open=saves');
  show([], []);
  const { heard } = await back();
  expect(heard).toBe(true);
  expect(window.location.search).toBe('');
});

it('a replace under an open layer is the address Back keeps', async () => {
  push('world', '/c');
  push('list', '/c?open=saves');
  const closed: string[] = [];
  show(['note'], closed);
  replace('list2', '/w/agent?open=saves');
  await back();
  expect(closed).toEqual(['note']);
  expect(window.location.pathname + window.location.search).toBe('/w/agent?open=saves');
  expect(window.history.state).toMatchObject({ key: 'list2' });
  /* and the very next Back is the router's, one step, to the world */
  show([], closed);
  const { heard } = await back();
  expect(heard).toBe(true);
  expect(window.location.pathname).toBe('/c');
});

it('two stacked layers: each Back closes one, the topmost first', async () => {
  push('world', '/d');
  push('list', '/d?open=saves');
  const closed: string[] = [];
  show(['first', 'second'], closed);
  await back();
  expect(closed).toEqual(['second']);
  show(['first'], closed);
  await back();
  expect(closed).toEqual(['second', 'first']);
  show([], closed);
  const { heard } = await back();
  expect(heard).toBe(true);
  expect(window.location.pathname + window.location.search).toBe('/d');
});

it('the app’s own step back is not taken for the person’s', async () => {
  push('world', '/e');
  push('list', '/e?open=saves');
  const closed: string[] = [];
  show(['note'], closed);
  expectAppPop();
  const { heard } = await back();
  expect(closed).toEqual([]);
  expect(heard).toBe(true);
  expect(window.location.search).toBe('');
});

it('a jump of more than one step goes where the person chose', async () => {
  push('far', '/f');
  push('world', '/f/w');
  push('list', '/f/w?open=saves');
  const closed: string[] = [];
  show(['note'], closed);
  await new Promise<void>((resolve) => {
    const done = () => { window.removeEventListener('popstate', done); setTimeout(resolve, 0); };
    window.addEventListener('popstate', done);
    window.history.go(-2);
  });
  expect(closed).toEqual([]);
  expect(window.location.pathname).toBe('/f');
});
