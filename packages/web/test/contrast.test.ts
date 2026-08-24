/**
 * INK CONTRAST, MEASURED — numbers, not impressions.
 *
 * goal: no-quiet-corners, Phase 8. The world speaks in light, so the ink
 * ramp is the meaning channel — and a meaning channel a reader cannot read
 * is a decoration. This suite computes the WCAG relative-luminance contrast
 * of every ink step against both grounds, from the tokens in `home.css`
 * itself (parsed, not copied — a retuned token re-measures on the next
 * run), and pins the policy:
 *
 *   - `--jar-ink` and `--jar-muted` must clear AA for normal text (≥ 4.5:1)
 *     on both the deep ground and the panel. Every sentence a person must
 *     READ — receipts, provenance rows, the grounds band, the antechamber,
 *     the reading — sits at muted or brighter, and a second check walks the
 *     named reading classes to hold that line.
 * WHAT THIS MOCKS, AND WHY (gate G6): nothing. The stylesheet is read as
 * text and the arithmetic is WCAG's own — there is no seam here to replace.
 *
 *   - `--jar-faint` is NOT a reading ink and is not asked to clear AA. The
 *     exception, argued in writing: faint is de-emphasis — the eyebrow
 *     labels, the quiet rules, the dimmed surround whose full-ink partner
 *     carries the content. Raising it to 4.5:1 would land it on top of
 *     muted and collapse the three-step ramp to two, which destroys the
 *     very distinction (dim versus readable) the accessibility rule exists
 *     to protect. What the law requires is that nothing a person MUST read
 *     is set in it — which is exactly what the class walk asserts.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const CSS = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../src/styles/home.css"),
  "utf8",
);

function token(name: string): string {
  const match = CSS.match(new RegExp(`${name}:\\s*([^;]+);`));
  if (!match) throw new Error(`token ${name} not found in home.css`);
  return match[1]!.trim();
}

type Rgb = { r: number; g: number; b: number };

function parseColor(value: string): { color: Rgb; alpha: number } {
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = Number.parseInt(hex[1]!, 16);
    return {
      color: { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff },
      alpha: 1,
    };
  }
  const rgba = value.match(/^rgba?\(([^)]+)\)$/);
  if (rgba) {
    const parts = rgba[1]!.split(",").map((p) => Number.parseFloat(p.trim()));
    return {
      color: { r: parts[0]!, g: parts[1]!, b: parts[2]! },
      alpha: parts[3] ?? 1,
    };
  }
  throw new Error(`unparseable color: ${value}`);
}

/** The ink as seen: alpha-composited over the ground it sits on. */
function composite(ink: string, ground: Rgb): Rgb {
  const { color, alpha } = parseColor(ink);
  return {
    r: alpha * color.r + (1 - alpha) * ground.r,
    g: alpha * color.g + (1 - alpha) * ground.g,
    b: alpha * color.b + (1 - alpha) * ground.b,
  };
}

function luminance({ r, g, b }: Rgb): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function ratio(ink: string, groundValue: string): number {
  const ground = parseColor(groundValue);
  /* the panel is itself translucent over the deep ground */
  const groundRgb =
    ground.alpha === 1
      ? ground.color
      : composite(groundValue, parseColor(token("--jar-deep")).color);
  const seen = composite(ink, groundRgb);
  const [hi, lo] = [luminance(seen), luminance(groundRgb)].sort((a, b) => b - a);
  return (hi! + 0.05) / (lo! + 0.05);
}

const round = (n: number) => Math.round(n * 100) / 100;

describe("the ink ramp is measured, and the reading inks clear AA", () => {
  it("ink and muted clear 4.5:1 on both grounds — the measured numbers", () => {
    const measured = {
      inkOnDeep: round(ratio(token("--jar-ink"), token("--jar-deep"))),
      mutedOnDeep: round(ratio(token("--jar-muted"), token("--jar-deep"))),
      faintOnDeep: round(ratio(token("--jar-faint"), token("--jar-deep"))),
      inkOnPanel: round(ratio(token("--jar-ink"), token("--jar-panel"))),
      mutedOnPanel: round(ratio(token("--jar-muted"), token("--jar-panel"))),
      faintOnPanel: round(ratio(token("--jar-faint"), token("--jar-panel"))),
    };
    // The record the goal log quotes — printed so a re-measure is one run.
    console.log("contrast:", JSON.stringify(measured));

    expect(measured.inkOnDeep).toBeGreaterThanOrEqual(4.5);
    expect(measured.inkOnPanel).toBeGreaterThanOrEqual(4.5);
    expect(measured.mutedOnDeep).toBeGreaterThanOrEqual(4.5);
    expect(measured.mutedOnPanel).toBeGreaterThanOrEqual(4.5);
    /* faint is de-emphasis by design — see the header. It must still be
       darker than muted, or the ramp has silently collapsed. */
    expect(measured.faintOnDeep).toBeLessThan(measured.mutedOnDeep);
  });

  it("every class a person must READ is set at muted or brighter, never faint", () => {
    // The reading surfaces this and the sibling goals shipped: receipts,
    // the provenance rows and their surround, the grounds band, the
    // antechamber's candidates and anchors, the reading's own lines.
    const READING_CLASSES = [
      ".jar-receipt",
      ".jar-prov-text",
      ".jar-ground",
      ".jar-ante-candidate",
      ".jar-reading-line",
    ];
    for (const selector of READING_CLASSES) {
      const block = CSS.match(
        new RegExp(`(^|\\n)${selector.replace(".", "\\.")}\\s*\\{([^}]*)\\}`),
      );
      expect(block, `${selector} has no rule in home.css`).not.toBeNull();
      const body = block![2]!;
      const color = body.match(/(?:^|;|\s)color:\s*([^;]+);/);
      expect(color, `${selector} declares no color of its own`).not.toBeNull();
      expect(
        color![1]!.includes("--jar-faint"),
        `${selector} is read, and reading ink must be muted or brighter`,
      ).toBe(false);
    }
  });
});
