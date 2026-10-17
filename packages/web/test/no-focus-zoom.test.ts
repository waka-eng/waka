/** WHAT THIS MOCKS, AND WHY (gate G6): nothing. Source checks pin the floor;
 * the computed 16px on every field and the creature's edge under zoom were
 * measured in a browser (see the guard in `chrome.css`).
 *
 * Founder, 2026-10-17: "the 화질 of the character breaks in mobile setting."
 * iOS zooms the page when a field under 16px takes focus and never zooms
 * back, and a zoomed page stretches every canvas while `devicePixelRatio`
 * stays put — so the creature goes soft and the text beside it does not.
 * The 16px guard existed and eight later selectors were beating it. */
import {readFileSync, readdirSync} from 'node:fs';
import {expect, it} from 'vitest';

const dir = new URL('../src/styles/', import.meta.url);
const read = (name: string) => readFileSync(new URL(name, dir), 'utf8');
const blank = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '');

it('holds sixteen pixels on every touch-device field with a floor nothing can out-rank', () => {
  const css = blank(read('chrome.css'));
  const guard = [...css.matchAll(/@media \(pointer: coarse\) \{\s*([^{}]*)\{([^{}]*)\}\s*\}/g)]
    .find((m) => /body textarea/.test(m[1]!));
  expect(guard).toBeDefined();
  const selectors = guard![1]!.split(',').map((s) => s.trim());
  expect(selectors).toEqual(expect.arrayContaining(['body .field-input', 'body input', 'body select', 'body textarea']));
  expect(guard![2]).toMatch(/font-size:\s*var\(--t-input\)\s*!important/);
});

it('lets --t-input never resolve under 16px', () => {
  expect(blank(read('system.css'))).toMatch(/--t-input:\s*max\(16px,/);
});

it('has no other !important font-size that could lower a field again', () => {
  const offenders: string[] = [];
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.css'))) {
    for (const m of blank(read(name)).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!/font(-size)?\s*:[^;]*!important/.test(m[2]!)) continue;
      if (/var\(--t-input\)\s*!important/.test(m[2]!)) continue;
      offenders.push(`${name}: ${m[1]!.trim()}`);
    }
  }
  expect(offenders).toEqual([]);
});
