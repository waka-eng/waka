/**
 * ═══ TRIM THE OTHER PHONE OFF THE PICTURE (founder, 2026-11-27, approving
 * "Trim the other phone off the picture" on the picture-saves board) ═══════
 *
 * A screenshot carries another phone's clock, its app's header and its tab
 * bar, and on a saved inspiration's page those push the words the person
 * saved it for below the fold. So the page SHOWS it trimmed. Display only:
 * the stored file is never touched, the full-screen view shows it whole, and
 * a download is the original.
 *
 * WHY HERE AND NOT ON THE SERVER. The brief preferred a crop box stored when
 * the server reads the image. The API has no PNG decoder (screenshots are
 * PNG or HEIC; only JPEG and HEIF decode there today), a stored box needs a
 * column and so a migration, and every picture saved before it would stay
 * untrimmed until re-read. The browser already holds the decoded picture, so
 * a 390px-wide sample of it (about one pixel per point) answers in a few
 * milliseconds, for every picture, old or new, with no model call. If the
 * server ever stores a box, `trimBox` is the rule to move there: it is pure
 * and reads only pixels.
 *
 * CONSERVATIVE BY CONSTRUCTION (code review, 2026-11-28: an edge alone cut a
 * reader's quote block and a Notes title). Each of the three cuts needs the
 * whole signature of the thing it removes, and every doubt keeps:
 *
 *   STATUS BAR   a phone-tall picture whose top rows hold a clock and icons
 *                at the sides and NOTHING in the middle, on one ground.
 *   HEADER       directly under it, a band on the status bar's own ground
 *                whose marks are header-sized (a title, a back arrow: no run
 *                of ink taller than a header line), closed by a FULL-WIDTH
 *                hairline or a full-width change of ground. An inset picture
 *                is not an edge; a bold title is not a header.
 *   TAB BAR      at the foot, a band holding a row of ICONS (three to six
 *                marks spread across the width with wide gaps between them,
 *                never a line of words) and closed above by a full-width
 *                hairline or change of ground. The home indicator alone is
 *                not a tab bar and is kept.
 *
 * Nothing beyond `MAX_TRIM` of the height is ever taken.
 */

/** Fractions of the picture's height hidden at its top and its bottom. */
export interface Trim { top: number; bottom: number }

export const NO_TRIM: Trim = Object.freeze({ top: 0, bottom: 0 });

/** Phones are at least 19.5:9 now; 1.9 keeps a 16:9 photo out. */
const PHONE_TALL = 1.9;
/** The analysis sample's width: about one pixel per point of a phone's
    screen, so a header's one-point hairline survives the downscale. */
const SAMPLE_WIDTH = 390;
/** Never more of the height than this, top and bottom together. */
const MAX_TRIM = 0.3;
/** Channel distance under which two colours are the same ground. */
const SAME = 18;
/** A hairline is fainter than a change of ground (a 0.33pt rule averaged
    into a 1pt row), but a row's median carries no noise, so a small
    distance on the median is still a line. */
const LINE = 6;
/** A row is full width when at most this share of it is off its ground. */
const FULL = 0.03;

type Rgb = [number, number, number];
const far = (a: Rgb, b: Rgb, limit = SAME) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2])) > limit;

interface Row { ground: Rgb; busy: (from: number, to: number) => number; marks: () => Array<[number, number]> }

/** Rows read on demand and kept: only the bands the cuts look at are ever
    sorted (code review, 2026-11-28). */
function rowReader(data: ArrayLike<number>, width: number): (y: number) => Row {
  const cache = new Map<number, Row>();
  const pixel = (x: number, y: number): Rgb => { const i = (y * width + x) * 4; return [data[i]!, data[i + 1]!, data[i + 2]!]; };
  return (y: number) => {
    const hit = cache.get(y);
    if (hit) return hit;
    const chan = (c: number) => {
      const values = new Uint8Array(width);
      for (let x = 0; x < width; x++) values[x] = data[(y * width + x) * 4 + c]!;
      values.sort();
      return values[width >> 1]!;
    };
    const ground: Rgb = [chan(0), chan(1), chan(2)];
    const off = (x: number) => far(pixel(x, y), ground);
    const row: Row = {
      ground,
      busy: (from, to) => {
        const a = Math.floor(from * width), b = Math.ceil(to * width);
        let n = 0;
        for (let x = a; x < b; x++) if (off(x)) n++;
        return n / Math.max(1, b - a);
      },
      /* runs of marks, merged across gaps narrower than 2% of the width
         (the space inside a glyph, or between two strokes of an icon) */
      marks: () => {
        const out: Array<[number, number]> = [];
        const join = Math.max(1, Math.round(width * 0.02));
        for (let x = 0; x < width; x++) {
          if (!off(x)) continue;
          const last = out[out.length - 1];
          if (last && x - last[1] <= join) last[1] = x + 1; else out.push([x, x + 1]);
        }
        return out;
      },
    };
    cache.set(y, row);
    return row;
  };
}

/** A row of tab icons: three to six marks, each icon-sized, wide gaps
    between them, spread over half the width. A line of words has many
    marks with narrow gaps and never passes. */
function iconRow(row: Row, width: number): boolean {
  const marks = row.marks();
  if (marks.length < 3 || marks.length > 6) return false;
  if (marks.some(([a, b]) => b - a < width * 0.025 || b - a > width * 0.15)) return false;
  for (let i = 1; i < marks.length; i++) if (marks[i]![0] - marks[i - 1]![1] < width * 0.06) return false;
  return marks[marks.length - 1]![1] - marks[0]![0] >= width * 0.5;
}

/**
 * Walking from `from` in `step`, the first full-width edge within `reach`
 * rows: a hairline (one to three rows unlike `ground` on both sides, which
 * match it) or a change of ground that holds full width for four rows.
 * Returns [first row of the edge, first row past it on the far side].
 */
function edge(rowAt: (y: number) => Row, from: number, reach: number, step: 1 | -1, height: number, ground: Rgb): [number, number] | null {
  for (let i = 1; i <= reach; i++) {
    const y = from + step * i;
    if (y < 0 || y >= height) return null;
    const r = rowAt(y);
    if (!far(r.ground, ground, LINE) || r.busy(0, 1) > FULL) continue;
    for (let w = 1; w <= 3; w++) {
      const after = from + step * (i + w);
      if (after < 0 || after >= height) break;
      const a = rowAt(after);
      if (!far(a.ground, ground, LINE)) return [y, after];
    }
    if (!far(r.ground, ground)) continue;
    let holds = true;
    for (let w = 1; w <= 4 && holds; w++) {
      const next = from + step * (i + w);
      if (next < 0 || next >= height) { holds = false; break; }
      const n = rowAt(next);
      holds = !far(n.ground, r.ground) && n.busy(0, 1) <= FULL;
    }
    if (holds) return [y, y];
  }
  return null;
}

/**
 * Where the status bar, the app's header and its tab bar end, as fractions
 * of the height. `data` is RGBA, row-major, `width` x `height`.
 */
export function trimBox(data: ArrayLike<number>, width: number, height: number): Trim {
  if (width < 8 || height < width * PHONE_TALL) return NO_TRIM;
  const rowAt = rowReader(data, width);
  const quiet = (y: number) => rowAt(y).busy(0, 1) < 0.02;
  const paper = rowAt(0).ground;

  /* ── THE STATUS BAR. Measured off iPhone screenshots (2026-11-27): 44 to
     62pt of 375 to 430pt wide, 0.11 to 0.16 of the width. */
  const statusCap = Math.round(width * 0.17);
  let lastSide = -1;
  for (let y = 0; y < statusCap; y++) {
    const r = rowAt(y);
    if (r.busy(0.36, 0.64) > 0.04 || far(r.ground, paper)) {
      if (lastSide < 0) return NO_TRIM;
      break;
    }
    if (r.busy(0, 0.3) > 0.06 || r.busy(0.7, 1) > 0.06) lastSide = y;
  }
  if (lastSide < Math.round(width * 0.03)) return NO_TRIM;
  const below = lastSide + 1;
  let gap = 0;
  while (below + gap < statusCap && quiet(below + gap)) gap++;
  /* Half the quiet gap under the clock stays, as the page's top margin. */
  let top = below + Math.floor(gap / 2);

  /* ── THE HEADER, only with a header's whole signature. */
  const headEdge = edge(rowAt, below - 1, Math.round(width * 0.18), 1, height, paper);
  if (headEdge && headEdge[0] - below >= width * 0.06) {
    let run = 0, tallest = 0, marked = false, sameGround = true;
    for (let y = below; y < headEdge[0]; y++) {
      const r = rowAt(y);
      if (far(r.ground, paper, LINE)) { sameGround = false; break; }
      if (r.busy(0, 1) > 0.01) { marked = true; run++; tallest = Math.max(tallest, run); } else run = 0;
    }
    /* a header line is 17pt type in a 44pt bar; a title over a picture is
       bigger, and anything taller than this is the page's own */
    if (sameGround && marked && tallest <= width * 0.06) top = headEdge[1];
  }

  /* ── THE TAB BAR, only with a row of icons in it. */
  let bottom = height;
  const foot = rowAt(height - 1).ground;
  const tabEdge = edge(rowAt, height - 1, Math.round(width * 0.3), -1, height, foot);
  if (tabEdge && height - 1 - tabEdge[0] >= width * 0.12) {
    let icons = false, sameGround = true;
    for (let y = tabEdge[0] + 1; y < height; y++) {
      const r = rowAt(y);
      if (far(r.ground, foot, LINE)) { sameGround = false; break; }
      if (!icons && iconRow(r, width)) icons = true;
    }
    /* the edge's far side is the content's last row */
    if (sameGround && icons) bottom = tabEdge[1] + 1;
  }

  const trim = { top: top / height, bottom: (height - bottom) / height };
  if (trim.top + trim.bottom > MAX_TRIM) return { top: Math.min(trim.top, MAX_TRIM), bottom: 0 };
  return trim;
}

/**
 * The trim of a loaded picture, read off a small sample of it. A picture
 * whose pixels the page may not read (no CORS) is shown whole.
 */
export function readTrim(image: HTMLImageElement): Trim {
  const w = image.naturalWidth, h = image.naturalHeight;
  if (!w || !h || h < w * PHONE_TALL) return NO_TRIM;
  try {
    const width = Math.min(SAMPLE_WIDTH, w), height = Math.round(width * h / w);
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return NO_TRIM;
    context.drawImage(image, 0, 0, width, height);
    return trimBox(context.getImageData(0, 0, width, height).data, width, height);
  } catch {
    return NO_TRIM;
  }
}
