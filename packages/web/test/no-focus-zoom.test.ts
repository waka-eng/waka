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
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
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
  expect(selectors).toEqual(expect.arrayContaining(['body .field-input', 'body input', 'body select', 'body textarea']));
  expect(guard![2]).toMatch(/font-size:\s*var\(--t-input\)\s*!important/);
});

/* NO WAY OUT OF THE FLOOR BY WHAT A STYLE ATTRIBUTE MENTIONS. It used to
   exempt `:not([style*="font"])` — meant for a field sized in script, but a
   substring match also let out any field whose inline style named a
   font-family, a weight or a `--font-*` variable, and each of those zoomed
   the page again (retro review of #440, 2026-10-17). No field sets one. */
it('exempts no field from the floor by its inline style', () => {
  expect(blank(read('chrome.css'))).not.toMatch(/\[style\*=/);
});

/** The selectors of every `!important` `--t-lead` restatement, by media query:
    a field larger than the floor keeps its size only by being listed here. */
function restatements(): {all: string[]; byMedia: Map<string, string[]>} {
  const css = blank(read('chrome.css'));
  const byMedia = new Map<string, string[]>();
  for (const media of css.matchAll(/@media ([^{]+)\{((?:[^{}]*\{[^{}]*\})*)\s*\}/g)) {
    for (const rule of media[2]!.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!/font-size:\s*var\(--t-lead\)\s*!important/.test(rule[2]!)) continue;
      const key = media[1]!.trim();
      byMedia.set(key, [...(byMedia.get(key) ?? []), ...rule[1]!.split(',').map((s) => s.trim())]);
    }
  }
  return {all: [...byMedia.values()].flat(), byMedia};
}

/* THE LARGER FIELDS ARE A HAND-KEPT LIST, SO THE LIST IS HELD HERE. Delete a
   line from it and that field drops to 16 on a phone — quietly, because the
   floor is still doing exactly what it says. */
it('restates every larger field at its own size, after the floor', () => {
  const {byMedia} = restatements();
  expect(byMedia.get('(pointer: coarse)')).toEqual(expect.arrayContaining([
    'body .jar-principle-share select',
    'body .jar-principle-share textarea',
    'body .jar-thing-share textarea',
    'body .waka-note-page:not(.waka-over--note .waka-note-page)',
  ]));
  expect(byMedia.get('(pointer: coarse) and (max-width: 600px)')).toEqual(['body .jar-attachment-transcript textarea']);
});

/** Classes the app puts on an <input>, <textarea> or <select>, read from the
    TSX — a field styled by class alone is still a field. Best effort: an
    attribute list that holds a `>` outside an arrow hides its className. */
function fieldClasses(): Set<string> {
  const root = fileURLToPath(new URL('../src/', import.meta.url));
  const walk = (d: string): string[] => readdirSync(d, {withFileTypes: true})
    .flatMap((e) => e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith('.tsx') ? [join(d, e.name)] : []);
  const out = new Set(['field-input']);
  for (const f of walk(root)) {
    for (const m of readFileSync(f, 'utf8').matchAll(/<(?:textarea|input|select)\b(?:[^>]|=>)*?className=(?:"([^"]*)"|\{`([^`]*)`\}|\{"([^"]*)"\})/g))
      for (const c of (m[1] ?? m[2] ?? m[3])!.split(/\s+/)) if (/^[\w-]+$/.test(c)) out.add(c);
  }
  return out;
}

/* AND A NEW LARGER FIELD CANNOT SKIP THE LIST. Any rule in any stylesheet
   that gives a field `--t-lead` or a larger step (or more than 16px) without
   `!important` will be flattened by the floor unless it is restated — so it
   has to appear in the restatement, here. Best effort: the field is read off
   the selector's last compound (a tag, or a class the TSX puts on a field),
   and the size off the LAST font-size or `font` in the block. */
it('finds every stylesheet rule that sizes a field above the floor in the restatement', () => {
  const classes = fieldClasses();
  const LARGE = /var\(--t-(lead|reading|home-reading|display)\)|(?<![\w.-])(1[7-9]|[2-9]\d|\d{3,})(\.\d+)?px\b/;
  const norm = (sel: string) => sel.replace(/^body\s+/, '').replace(/:not\((?:[^()]|\([^()]*\))*\)/g, '').trim();
  const listed = new Set(restatements().all.map(norm));
  const missing: string[] = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.css'))) {
    for (const rule of blank(read(f)).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const sizes = rule[2]!.split(';').map((d) => /^\s*(?:font|font-size)\s*:\s*([\s\S]*)$/i.exec(d)?.[1]?.trim()).filter(Boolean) as string[];
      const size = sizes.at(-1);
      if (!size || /!\s*important/.test(size) || !LARGE.test(size)) continue;
      for (const sel of rule[1]!.split(',').map((s) => s.trim())) {
        const last = norm(sel).split(/[\s>+~]+/).filter(Boolean).at(-1) ?? '';
        const isField = /^(input|textarea|select)(?![\w-])/.test(last)
          || [...last.matchAll(/\.([\w-]+)/g)].some((c) => classes.has(c[1]!));
        if (isField && !listed.has(norm(sel))) missing.push(`${f}: ${sel} { font-size: ${size} }`);
      }
    }
  }
  expect(missing).toEqual([]);
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
