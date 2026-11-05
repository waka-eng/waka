/**
 * THE HOME BRIEF'S TOKENS, MEASURED (waka-design-brief.md §2, §5).
 *
 * The brief gives values as starting points and RELATIONSHIPS as the
 * contract: primary ink on the ground at 10:1 or better, secondary ink at
 * 4.5:1 from a dedicated colour rather than an opacity, paper ink readable on
 * the paper, an accent a control border can be seen in, six type steps and
 * nothing between, motion that eases out inside 180-240ms. This suite reads
 * the stylesheets as text, resolves `var()` and `color-mix()` itself, and
 * pins those relationships — so a token retuned later re-measures on the
 * next run instead of drifting under a comment that still quotes the old
 * number.
 *
 * It also pins "defined once". The brief's instruction "change the token,
 * not the component" only works if there is exactly one place to change, so
 * a second declaration of any of these names anywhere in the stylesheets
 * fails here.
 *
 * WHAT THIS MOCKS (gate G6): nothing. Text in, WCAG's arithmetic out.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const STYLES = resolve(dirname(fileURLToPath(import.meta.url)), "../src/styles");
const SHEETS = Object.fromEntries(
  readdirSync(STYLES)
    .filter((f) => f.endsWith(".css"))
    .map((f) => [f, readFileSync(resolve(STYLES, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "")]),
);

const BRIEF_TOKENS = [
  "--bg", "--bg-glass", "--paper", "--paper-ink", "--paper-muted", "--ink",
  "--ink-secondary", "--accent", "--radius-field", "--radius-card", "--space-unit",
] as const;

function definitions(name: string): Array<{ sheet: string; value: string }> {
  const found: Array<{ sheet: string; value: string }> = [];
  const pattern = new RegExp(`(?<![\\w-])${name}:\\s*([^;]+);`, "g");
  for (const [sheet, css] of Object.entries(SHEETS)) {
    for (const match of css.matchAll(pattern)) found.push({ sheet, value: match[1]!.trim() });
  }
  return found;
}

/* Declarations made directly on `:root` or `body` — the palette block in
   chrome.css is on `body`. A token declared there can only reach names on
   that element or its ancestors — `var()` resolves where the property is
   declared, not where it is used — so resolving through a name declared on
   `.jar` would measure a colour the browser never paints.
   (It happened: `--paper` was first built from `--jar-live`, which lives on
   `.jar`, and the bubble lost its fill while this suite stayed green.) */
const ROOT = Object.values(SHEETS)
  .flatMap((css) => [...css.matchAll(/(?:^|[\s}])(?::root|body)\s*\{([^{}]*)\}/g)].map((m) => m[1]!))
  .join("\n");

function token(name: string): string {
  const match = ROOT.match(new RegExp(`(?<![\\w-])${name}:\\s*([^;]+);`));
  if (!match) throw new Error(`${name} is not declared on :root or body, so the palette cannot read it`);
  return match[1]!.trim();
}

type Rgba = { r: number; g: number; b: number; a: number };

function color(value: string): Rgba {
  const v = value.trim();
  const ref = v.match(/^var\((--[\w-]+)\)$/);
  if (ref) return color(token(ref[1]!));
  const hex = v.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = Number.parseInt(hex[1]!, 16);
    return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff, a: 1 };
  }
  const rgba = v.match(/^rgba?\(([^)]+)\)$/);
  if (rgba) {
    const [r, g, b, a = 1] = rgba[1]!.split(",").map((p) => Number.parseFloat(p.trim()));
    return { r: r!, g: g!, b: b!, a };
  }
  const mix = v.match(/^color-mix\(in srgb,\s*(.+?)\s+([\d.]+)%,\s*(.+)\)$/);
  if (mix) {
    const p = Number.parseFloat(mix[2]!) / 100;
    const x = color(mix[1]!), y = color(mix[3]!);
    return { r: x.r * p + y.r * (1 - p), g: x.g * p + y.g * (1 - p), b: x.b * p + y.b * (1 - p), a: 1 };
  }
  throw new Error(`unparseable colour: ${value}`);
}

/** What the eye gets: a translucent colour composited over what is under it. */
function over(top: Rgba, under: Rgba): Rgba {
  return {
    r: top.a * top.r + (1 - top.a) * under.r,
    g: top.a * top.g + (1 - top.a) * under.g,
    b: top.a * top.b + (1 - top.a) * under.b,
    a: 1,
  };
}

function luminance({ r, g, b }: Rgba): number {
  const c = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
}

function ratio(ink: Rgba, ground: Rgba): number {
  const seen = over(ink, ground);
  const [hi, lo] = [luminance(seen), luminance(ground)].sort((a, b) => b - a);
  return Math.round(((hi! + 0.05) / (lo! + 0.05)) * 100) / 100;
}

describe("the brief's tokens exist once", () => {
  it.each(BRIEF_TOKENS)("%s is declared exactly once, in chrome.css", (name) => {
    const defs = definitions(name);
    expect(defs.map((d) => d.sheet)).toEqual(["chrome.css"]);
  });
});

describe("the brief's colour relationships hold on the real surfaces", () => {
  const bg = color(token("--bg"));
  const glass = over(color(token("--bg-glass")), bg);
  const paper = color(token("--paper"));

  it("measures every pair the home surface sets text in", () => {
    const measured = {
      inkOnBg: ratio(color(token("--ink")), bg),
      inkOnGlass: ratio(color(token("--ink")), glass),
      secondaryOnBg: ratio(color(token("--ink-secondary")), bg),
      secondaryOnGlass: ratio(color(token("--ink-secondary")), glass),
      paperInkOnPaper: ratio(color(token("--paper-ink")), paper),
      paperMutedOnPaper: ratio(color(token("--paper-muted")), paper),
      accentOnBg: ratio(color(token("--accent")), bg),
      accentOnGlass: ratio(color(token("--accent")), glass),
    };
    console.log("brief contrast:", JSON.stringify(measured));

    // §2: primary text on dark ≥ 10:1.
    expect(measured.inkOnBg).toBeGreaterThanOrEqual(10);
    expect(measured.inkOnGlass).toBeGreaterThanOrEqual(10);
    // §2: secondary text ≥ 4.5:1.
    expect(measured.secondaryOnBg).toBeGreaterThanOrEqual(4.5);
    expect(measured.secondaryOnGlass).toBeGreaterThanOrEqual(4.5);
    // The paper speaks in the app's voice; its body ink reads at AAA.
    expect(measured.paperInkOnPaper).toBeGreaterThanOrEqual(7);
    expect(measured.paperMutedOnPaper).toBeGreaterThanOrEqual(4.5);
    // The accent is a border and a focus ring: WCAG 1.4.11 asks 3:1.
    expect(measured.accentOnBg).toBeGreaterThanOrEqual(3);
    expect(measured.accentOnGlass).toBeGreaterThanOrEqual(3);
  });

  it("secondary ink is its own colour, not the primary dimmed by opacity", () => {
    // §2: "do not dim with opacity below 0.72; use a dedicated secondary
    // color token instead."
    expect(color(token("--ink-secondary")).a).toBe(1);
  });
});

describe("the brief's type scale is six steps and nothing between", () => {
  it("declares exactly 13 / 15 / 16 / 20 / 24 / 32", () => {
    const steps = [...SHEETS["system.css"]!.matchAll(/--type-(\d+):\s*(\d+)px;/g)].map((m) => {
      expect(m[2]).toBe(m[1]); // a step named 16 is 16px
      return Number(m[1]);
    });
    expect(steps).toEqual([13, 15, 16, 20, 24, 32]);
  });

  it("body is 16px on phones and 15px from the desktop step", () => {
    expect(token("--type-body")).toBe("var(--type-16)");
    expect(SHEETS["system.css"]).toMatch(/@media \(min-width: 761px\)\s*{\s*:root\s*{\s*--type-body:\s*var\(--type-15\);/);
  });
});

describe("the brief's motion eases out and never overshoots", () => {
  it("lasts 180-240ms on an ease-out curve inside the unit square", () => {
    const ms = Number.parseFloat(token("--motion-dur"));
    expect(ms).toBeGreaterThanOrEqual(180);
    expect(ms).toBeLessThanOrEqual(240);
    const points = token("--motion-ease").match(/^cubic-bezier\(([^)]+)\)$/)![1]!.split(",").map(Number);
    for (const p of points) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1); // > 1 is a bounce
    }
    // ease-out: both control points on or above y = x, so the curve lies
    // above the diagonal — fast away, slow to settle — and not on it.
    const [x1, y1, x2, y2] = points as [number, number, number, number];
    expect(y1).toBeGreaterThanOrEqual(x1);
    expect(y2).toBeGreaterThanOrEqual(x2);
    expect(y1 - x1 + (y2 - x2)).toBeGreaterThan(0);
  });
});

describe("the home surface is built only from the brief's scale and palette", () => {
  const css = SHEETS["home-surface.css"]!;

  it("sets every font size from a --type-* step", () => {
    const sizes = [...css.matchAll(/font-size:\s*([^;]+);/g)].map((m) => m[1]!.trim());
    expect(sizes.length).toBeGreaterThan(0);
    const offScale = sizes.filter((v) => !/^var\(--type-(13|15|16|20|24|32|body)\)$/.test(v));
    expect(offScale, "a font size that is not one of the six steps").toEqual([]);
  });

  it("names no colour of its own — every colour is a token", () => {
    expect(css.match(/#[0-9a-f]{3,8}\b/gi) ?? [], "a hex colour").toEqual([]);
    expect(css.match(/\brgba?\(/g) ?? [], "an rgb() colour").toEqual([]);
    // §2: secondary text is a colour, not opacity — no text dimmed by it.
    const dimmed = [...css.matchAll(/opacity:\s*([\d.]+)/g)].map((m) => Number(m[1])).filter((o) => o > 0 && o < 0.72);
    expect(dimmed, "text dimmed below 0.72 opacity").toEqual([]);
  });

  it("uses weight 300 nowhere (it is only for 24px and up, and nothing here is)", () => {
    expect(css).not.toMatch(/font-weight:\s*(300|var\(--weight-light\))/);
  });
});
