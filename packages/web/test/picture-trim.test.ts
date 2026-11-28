/**
 * ═══ THE OTHER PHONE IS TRIMMED OFF, AND NOTHING ELSE (founder, 2026-11-27,
 * approving "Trim the other phone off the picture") ═══════════════════════
 *
 * `trimBox` decides, from pixels alone, how much of a screenshot's top and
 * foot is another phone's chrome. These pictures are drawn here rather than
 * loaded, so each case names exactly the shape it pins: a status bar with a
 * header and a tab bar, a status bar alone, a photo, a wide picture, and a
 * page whose only edges are its own content's.
 *
 * WHAT THIS MOCKS (gate G6): nothing. `trimBox` is pure; the canvas half
 * (`readTrim`) is the browser's and is checked in the browser.
 */
import { describe, expect, it } from 'vitest';

import { NO_TRIM, trimBox } from '../src/lib/picture-trim';

type Rgb = [number, number, number];
const W = 120, H = 260;
function picture(ground: Rgb, height = H, width = W) {
  const data = new Uint8ClampedArray(width * height * 4);
  const fill = (x0: number, y0: number, x1: number, y1: number, c: Rgb) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4; data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255;
    }
  };
  fill(0, 0, width, height, ground);
  return { data, fill, width, height };
}
const PAPER: Rgb = [246, 244, 240], INK: Rgb = [60, 62, 68], RULE: Rgb = [225, 221, 214];
/** A clock at the left and icons at the right, rows 5 to 10 (0.04 to 0.09 of
    the width), the middle third empty: the status bar every phone draws. */
function statusBar(p: ReturnType<typeof picture>) {
  p.fill(10, 5, 26, 10, INK); p.fill(92, 6, 110, 10, INK);
}
/** The words of the page, from `from` down: lines of letters, ink over
    less than half of each row as type is, so the row's ground stays paper. */
function words(p: ReturnType<typeof picture>, from: number, to: number) {
  for (let y = from; y < to; y += 6) for (let x = 8; x < 112; x += 7) p.fill(x, y, x + 3, y + 2, INK);
}

describe('trimBox', () => {
  it('trims the status bar, the header to its hairline and the tab bar from its hairline', () => {
    const p = picture(PAPER);
    statusBar(p);
    p.fill(8, 16, 16, 22, INK); p.fill(46, 16, 74, 22, INK);   // back, title
    p.fill(0, 28, W, 29, RULE);                                // header hairline, 0.11w under the clock
    words(p, 36, 226);
    p.fill(0, 236, W, 237, RULE);                              // tab bar hairline, 0.2w up
    for (const x of [14, 38, 62, 86]) p.fill(x, 242, x + 12, 250, INK);
    p.fill(44, 255, 76, 257, INK);                             // home indicator
    const trim = trimBox(p.data, W, H);
    expect(Math.round(trim.top * H)).toBe(29);
    expect(Math.round(trim.bottom * H)).toBe(H - 236);
  });

  it('trims only the status bar when no edge marks a header, and keeps half the gap as margin', () => {
    const p = picture(PAPER);
    statusBar(p);
    words(p, 30, 250);
    const trim = trimBox(p.data, W, H);
    /* the clock ends at row 9; the gap is read up to 0.17 of the width
       (row 20), so 10 quiet rows and half of them stay */
    expect(Math.round(trim.top * H)).toBe(15);
    expect(trim.bottom).toBe(0);
  });

  it('keeps a figure near the foot: a content edge is not a tab bar', () => {
    const p = picture(PAPER);
    statusBar(p);
    words(p, 30, 236);
    p.fill(0, 240, W, H - 4, [207, 198, 184]);                 // a figure, 0.02w off the foot
    expect(trimBox(p.data, W, H).bottom).toBe(0);
  });

  it('keeps a reader\'s quote block near the foot: no row of icons, no tab bar', () => {
    const p = picture(PAPER);
    statusBar(p);
    words(p, 30, 200);
    p.fill(0, 206, W, 240, [236, 232, 224]);                   // a quote block, full width
    p.fill(8, 206, 10, 240, INK);                              // its rule
    for (let y = 212; y < 236; y += 6) for (let x = 16; x < 112; x += 7) p.fill(x, y, x + 3, y + 2, INK);
    p.fill(44, 255, 76, 257, INK);                             // the home indicator alone
    expect(trimBox(p.data, W, H).bottom).toBe(0);
  });

  it('keeps a Notes title over a picture: a bold title is not a header', () => {
    const p = picture(PAPER);
    statusBar(p);
    p.fill(8, 16, 100, 27, INK);                               // a bold title, 11 rows of ink
    p.fill(0, 30, W, 120, [120, 140, 160]);                    // a picture, full bleed, under it
    words(p, 126, 250);
    expect(Math.round(trimBox(p.data, W, H).top * H), 'only the status bar goes').toBeLessThanOrEqual(15);
    const inset = picture(PAPER);
    statusBar(inset);
    inset.fill(8, 16, 60, 21, INK);                            // a title
    inset.fill(8, 26, 112, 110, [120, 140, 160]);              // an inset picture: not an edge
    words(inset, 116, 250);
    expect(Math.round(trimBox(inset.data, W, H).top * H)).toBeLessThanOrEqual(15);
  });

  it('never trims a photo, whose top is not a status bar', () => {
    const p = picture([40, 48, 90]);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if ((x * 7 + y * 13) % 5 === 0) p.fill(x, y, x + 1, y + 1, [220, 160, 140]);
    expect(trimBox(p.data, W, H)).toEqual(NO_TRIM);
  });

  it('never trims a video under the clock: the middle is busy up there', () => {
    const p = picture(PAPER);
    statusBar(p);
    p.fill(0, 0, W, 60, [30, 30, 34]);                         // full-bleed video from the top
    for (let y = 0; y < 60; y += 2) for (let x = (y * 3) % 9; x < W; x += 9) p.fill(x, y, x + 4, y + 2, [150, 120, 90]);
    p.fill(10, 5, 26, 10, [240, 240, 240]);
    expect(trimBox(p.data, W, H)).toEqual(NO_TRIM);
  });

  it('never trims a picture that is not phone-tall', () => {
    const p = picture(PAPER, 200);
    statusBar(p);
    words(p, 30, 190);
    expect(trimBox(p.data, W, 200)).toEqual(NO_TRIM);
  });

  it('never takes more than 30% of the height', () => {
    const p = picture(PAPER);
    statusBar(p);
    p.fill(8, 22, 16, 28, INK);
    p.fill(0, 34, W, 35, RULE);
    words(p, 42, 120);
    p.fill(0, 130, W, 131, RULE);
    for (let y = 140; y < 250; y += 12) p.fill(14, y, 30, y + 6, INK);
    const trim = trimBox(p.data, W, H);
    expect(trim.top + trim.bottom).toBeLessThanOrEqual(0.3);
  });
});
