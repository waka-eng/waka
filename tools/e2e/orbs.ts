/**
 * FINDING A MEMORY ON A CANVAS, BY ITS OWN LIGHT.
 *
 * ── NOTHING IN THE `READ` SOURCE MAY CONTAIN A BACKTICK ────────────────────
 *
 * It is a template literal handed to `page.evaluate`, so a backtick anywhere
 * inside it — including inside a comment — ends the string and the rest of the
 * browser code is parsed as TypeScript. I did exactly that while documenting
 * the scale fix below, quoting two identifiers in backticks the way every
 * other comment in this repo does, and it broke two gates at once with
 * `Expected ";" but found "window"` pointing at a line that was fine. Prose
 * about the code inside `READ` belongs in this header, where quoting is safe.
 *
 * ── THE SCALE COMES FROM THE CANVAS, NOT FROM THE DEVICE ───────────────────
 *
 * The read used `window.devicePixelRatio`, and on a phone that is a lie about
 * this canvas: the world caps its backing store at 2x, so at dpr 3 the canvas
 * is 780x1688 behind a 390x844 viewport. Sampling at 3x indexed 1.5x too far
 * into every row and off the right edge entirely — almost nothing came back
 * lit, `e2e:phone` reported "no memory could be opened", and the accusation
 * was against the product for a defect that was entirely the instrument's.
 * The canvas states its own scale; nothing else gets to guess at it.
 *
 * An orb has no selector. It is paint, so every DOM-shaped instrument in this
 * repo is blind to the one thing the world is made of, and a walk that wants
 * to press one has to find it the way a person does — by looking.
 *
 * Extracted because two gates need the same eyes and were about to grow two
 * pairs. `every-orb-answers` presses every orb and requires each to open;
 * `phone` needs to open ONE with a thumb, and its old route was a blind grid
 * of a hundred and seventeen taps that missed every time once the arrival
 * greeting stopped carrying it.
 *
 * ── HOW ────────────────────────────────────────────────────────────────────
 *
 * One `getImageData` of the viewport, flood-fill the lit pixels into blobs,
 * take each blob's centroid.
 *
 * THE THRESHOLD IS THE ORB'S CORE, NOT ITS BLOOM, and that choice is
 * load-bearing: at the bloom's luminance two neighbouring orbs merge into one
 * long blob and a row across the peek line becomes a single 400px smear. At
 * the core they separate.
 *
 * NO NAMED FUNCTIONS INSIDE `page.evaluate`: esbuild's `keepNames` wraps them
 * and the page throws `__name is not defined`. Plain loops and an explicit
 * stack only — which is also why the flood fill is written the way it is.
 */
import type { Page } from "playwright";

export interface Orb {
  x: number;
  y: number;
  w: number;
  h: number;
}

const READ = `(() => {
  const cv = document.querySelector("canvas");
  if (!cv) return "[]";
  const g = cv.getContext("2d");
  const W = window.innerWidth, H = window.innerHeight;
  /* THE SCALE COMES FROM THE CANVAS, NOT FROM THE DEVICE. See the note above
     this template — it cannot be written here, because everything in here is
     inside a template literal and a backtick would end it. */
  const dpr = cv.width / W || 1;
  const STEP = 4;
  const cols = Math.floor(W / STEP), rows = Math.floor(H / STEP);
  const img = g.getImageData(0, 0, cv.width, cv.height);
  const d = img.data, iw = img.width;
  const lit = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const o = (Math.round(r * STEP * dpr) * iw + Math.round(c * STEP * dpr)) * 4;
      if (0.2126 * d[o] + 0.7152 * d[o + 1] + 0.0722 * d[o + 2] > 150) lit[r * cols + c] = 1;
    }
  }
  const seen = new Uint8Array(cols * rows);
  const out = [];
  for (let s = 0; s < cols * rows; s++) {
    if (!lit[s] || seen[s]) continue;
    const stack = [s];
    seen[s] = 1;
    let n = 0, sx = 0, sy = 0, x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1;
    while (stack.length) {
      const i = stack.pop();
      const r = Math.floor(i / cols), c = i - r * cols;
      n += 1; sx += c; sy += r;
      if (c < x0) x0 = c; if (c > x1) x1 = c;
      if (r < y0) y0 = r; if (r > y1) y1 = r;
      if (c > 0 && lit[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; stack.push(i - 1); }
      if (c < cols - 1 && lit[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; stack.push(i + 1); }
      if (i >= cols && lit[i - cols] && !seen[i - cols]) { seen[i - cols] = 1; stack.push(i - cols); }
      if (i < cols * rows - cols && lit[i + cols] && !seen[i + cols]) { seen[i + cols] = 1; stack.push(i + cols); }
    }
    out.push({
      x: Math.round((sx / n) * STEP),
      y: Math.round((sy / n) * STEP),
      w: (x1 - x0 + 1) * STEP,
      h: (y1 - y0 + 1) * STEP,
    });
  }
  return JSON.stringify(out);
})()`;

/**
 * An orb, told from everything else that is lit.
 *
 * Under 20px is a fragment of a root line where it crosses the sample grid;
 * over 70 is the companion, which is far bigger than any orb. Round to within
 * 2.2:1 — a root is a line and never passes that.
 *
 * The bounds are in CSS pixels and hold on a phone as well as a desktop: the
 * orb's drawn radius is not scaled by the viewport, only by the device pixel
 * ratio, which the read above already divides out.
 */
export const isOrb = (b: Orb): boolean =>
  b.w >= 20 && b.h >= 20 && b.w <= 70 && b.h <= 70 && Math.max(b.w / b.h, b.h / b.w) <= 2.2;

/** Every orb the world is drawing right now. */
export async function readOrbs(page: Page): Promise<Orb[]> {
  return (JSON.parse((await page.evaluate(READ)) as string) as Orb[]).filter(isOrb);
}

/**
 * Where that orb is NOW.
 *
 * THE FIELD DRIFTS, and it cost three readings before it was believed:
 * centroids read once and pressed one after another are pressed at where the
 * orbs WERE — 32px out by the eighth — so an instrument aiming at a stale
 * centroid reports the world's failure when the failure is its own latency.
 *
 * Returns null when nothing is within `reach`, which means the thing being
 * aimed at is no longer there to aim at: pressing the nearest other orb would
 * measure something else and call it the same measurement.
 */
export async function aimAt(page: Page, target: Orb, reach = 60): Promise<Orb | null> {
  let best: Orb | null = null;
  let bestD = Infinity;
  for (const b of await readOrbs(page)) {
    const d = Math.hypot(b.x - target.x, b.y - target.y);
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  return best && bestD <= reach ? best : null;
}
