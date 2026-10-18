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
function restatements(): Map<string, string[]> {
  const byMedia = new Map<string, string[]>();
  for (const rule of scoped(read('chrome.css'))) {
    if (!rule.media || !/font-size:\s*var\(--t-lead\)\s*!important/.test(rule.body)) continue;
    byMedia.set(rule.media, [...(byMedia.get(rule.media) ?? []), ...rule.selector.split(',').map((s) => s.trim())]);
  }
  return byMedia;
}

/** Every style rule in `css` with the media condition it is under — nested
    `@media` conditions joined with `and`, whitespace collapsed, null when
    unconditional. Other at-rules (`@layer`, `@supports`) add no condition. */
function scoped(css: string): {media: string | null; selector: string; body: string}[] {
  const text = blank(css);
  const out: {media: string | null; selector: string; body: string}[] = [];
  const groups: string[] = [];
  let head = '';
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]!;
    if (c === '{') {
      const h = head.trim().replace(/\s+/g, ' ');
      head = '';
      if (h.startsWith('@')) { groups.push(h); continue; }
      const end = text.indexOf('}', i);
      const media = groups.filter((g) => g.startsWith('@media')).map((g) => g.replace(/^@media\s*/, '')).join(' and ');
      out.push({media: media || null, selector: h, body: text.slice(i + 1, end)});
      i = end;
    } else if (c === '}') { groups.pop(); head = ''; }
    else if (c === ';') head = '';
    else head += c;
  }
  return out;
}

/* THE LARGER FIELDS ARE A HAND-KEPT LIST, SO THE LIST IS HELD HERE. Delete a
   line from it and that field drops to 16 on a phone — quietly, because the
   floor is still doing exactly what it says. */
it('restates every larger field at its own size, after the floor', () => {
  const byMedia = restatements();
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

/** Every custom property any stylesheet defines, by name — so a size that
    names a token is read through to what the token says. */
function tokens(): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.css')))
    for (const m of blank(read(f)).matchAll(/(--[\w-]+)\s*:\s*([^;{}]+)/g)) if (!out.has(m[1]!)) out.set(m[1]!, m[2]!.trim());
  return out;
}

/** The LARGEST pixel size `value` can resolve to, best effort: px as is,
    rem/em at 16, a `var()` read through its token, `clamp`/`min`/`max` at
    their largest length and `calc` as the sum of its lengths. Viewport and
    percentage units are not lengths here; a value with no length is null. */
function largestPx(value: string, defs: Map<string, string>, seen = new Set<string>()): number | null {
  const vars = [...value.matchAll(/var\((--[\w-]+)\s*(?:,([^()]*))?\)/g)].map((m) => {
    if (seen.has(m[1]!)) return null;
    const def = defs.get(m[1]!) ?? m[2];
    return def ? largestPx(def, defs, new Set([...seen, m[1]!])) : null;
  });
  const lengths = [...value.replace(/var\([^()]*\)/g, ' ').matchAll(/(?<![\w.-])(\d*\.?\d+)(px|rem|em)\b/g)]
    .map((m) => Number(m[1]) * (m[2] === 'px' ? 1 : 16));
  const all = [...lengths, ...vars.filter((v): v is number => v !== null)];
  if (all.length === 0) return null;
  return /^\s*calc\(/.test(value) ? all.reduce((a, b) => a + b, 0) : Math.max(...all);
}

it('reads a field size through rem, em, clamp, calc and tokens', () => {
  const defs = new Map([['--big', 'clamp(16px, 1.2vw, 19px)'], ['--small', 'max(16px, 15px)'], ['--via', 'var(--big)']]);
  expect(largestPx('1.0625rem', defs)).toBe(17);
  expect(largestPx('1em', defs)).toBe(16);
  expect(largestPx('var(--big)', defs)).toBe(19);
  expect(largestPx('var(--via)', defs)).toBe(19);
  expect(largestPx('var(--small)', defs)).toBe(16);
  expect(largestPx('calc(1rem + 2px)', defs)).toBe(18);
  expect(largestPx('min(20px, 5vw)', defs)).toBe(20);
  expect(largestPx('inherit', defs)).toBeNull();
});

/* AND A NEW LARGER FIELD CANNOT SKIP THE LIST. Any rule in any stylesheet
   that gives a field `--t-lead` or a larger step (or more than 16px) without
   `!important` will be flattened by the floor unless it is restated — so it
   has to appear in the restatement, here. "Larger" is read through rem, em,
   clamp, calc and every `--t-*` token (`largestPx`). Best effort: the field is read off
   the selector's last compound (a tag, or a class the TSX puts on a field),
   and the size off the LAST font-size or `font` in the block. */
it('finds every stylesheet rule that sizes a field above the floor in the restatement', () => {
  const classes = fieldClasses();
  const defs = tokens();
  const above = (size: string) => (largestPx(size, defs) ?? 0) > 16;
  const norm = (sel: string) => sel.replace(/^body\s+/, '').replace(/:not\((?:[^()]|\([^()]*\))*\)/g, '').trim();
  const byMedia = restatements();
  const missing: string[] = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.css'))) {
    for (const rule of scoped(read(f))) {
      /* WHERE IT IS LARGER IS WHERE IT IS RESTATED. A field larger at every
         width is restated under `(pointer: coarse)` alone; one larger only
         under a width (or any) condition is restated under that condition
         too — unconditionally would grow it where it was never large, and
         under the wrong width would leave it floored where it is. */
      const want = rule.media ? `(pointer: coarse) and ${rule.media}` : '(pointer: coarse)';
      const listed = new Set((byMedia.get(want) ?? []).map(norm));
      const sizes = rule.body.split(';').map((d) => /^\s*(?:font|font-size)\s*:\s*([\s\S]*)$/i.exec(d)?.[1]?.trim()).filter(Boolean) as string[];
      const size = sizes.at(-1);
      if (!size || /!\s*important/.test(size) || !above(size)) continue;
      for (const sel of rule.selector.split(',').map((s) => s.trim())) {
        const last = norm(sel).split(/[\s>+~]+/).filter(Boolean).at(-1) ?? '';
        const isField = /^(input|textarea|select)(?![\w-])/.test(last)
          || [...last.matchAll(/\.([\w-]+)/g)].some((c) => classes.has(c[1]!));
        if (isField && !listed.has(norm(sel))) missing.push(`${f}: ${sel} { font-size: ${size} } wants a restatement under @media ${want}`);
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
