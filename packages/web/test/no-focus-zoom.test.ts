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
  const guard = [...css.matchAll(/@media \(pointer: coarse\) \{\s*([^{}]*)\{([^{}]*)\}/g)]
    .find((m) => /body textarea/.test(m[1]!));
  expect(guard).toBeDefined();
  const selectors = guard![1]!.split(',').map((s) => s.trim());
  const own = ':not([style*="font"])';
  expect(selectors).toEqual(expect.arrayContaining(['body .field-input', 'body input', 'body select', 'body textarea'].map((s) => s + own)));
  expect(guard![2]).toMatch(/font-size:\s*var\(--t-input\)\s*!important/);
});

it('lets --t-input and --t-lead never resolve under 16px', () => {
  const system = blank(read('system.css'));
  expect(system).toMatch(/--t-input:\s*max\(16px,/);
  expect(system).toMatch(/--t-lead:\s*clamp\(16px,/);
});

/** The sizes an `!important` font declaration may set: the floor itself, and
    the one larger step the fields above it restate (both proven >= 16 above). */
const FLOORED = /^var\(--t-(input|lead)\)$/;

/** Every `!important` font size in `css` that is not a floored one, checked
    DECLARATION BY DECLARATION, so a block that carries the allowed line can
    not smuggle a lower one past it; `font:` shorthand is read for its size. */
function lowered(css: string): string[] {
  const out: string[] = [];
  for (const m of blank(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    for (const decl of m[2]!.split(';')) {
      const d = /^\s*(font|font-size)\s*:\s*([\s\S]*?)\s*!\s*important\s*$/i.exec(decl);
      if (!d) continue;
      const value = d[2]!.trim();
      /* shorthand: the size is the token before an optional `/line-height`,
         or the whole value when it is a bare variable; a keyword like
         `inherit` is a size somebody else chose, so it fails too */
      const size = d[1]!.toLowerCase() === 'font'
        ? (/(var\([^)]*\)|[\d.]+(?:px|r?em|%|vw|cqw)|[a-z-]+\([^)]*\))(?:\s*\/[^\s]+)?(?=\s|$)/i.exec(value)?.[1] ?? value)
        : value;
      if (!FLOORED.test(size)) out.push(`${m[1]!.trim()} { ${d[1]}: ${value} !important }`);
    }
  }
  return out;
}

it('has no other !important font size that could lower a field again', () => {
  const offenders = readdirSync(dir).filter((f) => f.endsWith('.css')).flatMap((f) => lowered(read(f)).map((o) => `${f}: ${o}`));
  expect(offenders).toEqual([]);
});

it('catches a lower size hiding in the same block as the floor, in either spelling', () => {
  expect(lowered('a { font-size: var(--t-input) !important; font-size: 13px !important; }')).toHaveLength(1);
  expect(lowered('a { font-size: var(--t-input) !important; font: 500 13px/1.2 serif !important; }')).toHaveLength(1);
  expect(lowered('a { font: inherit !important; }')).toHaveLength(1);
  expect(lowered('a { font-size:var(--t-body)!important }')).toHaveLength(1);
  expect(lowered('a { font: 400 var(--t-lead)/1.5 serif !important; font-size: var(--t-input) !important; }')).toEqual([]);
});
