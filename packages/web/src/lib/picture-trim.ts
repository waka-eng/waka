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
 * a 96px-wide sample of it answers in a millisecond, for every picture, old
 * or new, with no model call. If the server ever stores a box, `trimBox` is
 * the rule to move there: it is pure and reads only pixels.
 *
 * CONSERVATIVE BY CONSTRUCTION. A picture that is not phone-tall, or whose
 * top is not a status bar (a clock and icons at the sides, nothing in the
 * middle), is not trimmed at all. The header and the tab bar are trimmed only
 * where a hairline or a change of ground marks their edge. Nothing beyond
 * `MAX_TRIM` of the height is ever taken. A missed trim shows chrome; a wrong
 * one hides words, so every doubt resolves to keeping.
 */

/** Fractions of the picture's height hidden at its top and its bottom. */
export interface Trim { top: number; bottom: number }

export const NO_TRIM: Trim = Object.freeze({ top: 0, bottom: 0 });

/** Phones are at least 19.5:9 now; 1.9 keeps a 16:9 photo out. */
const PHONE_TALL = 1.9;
/** The analysis sample's width: about one pixel per point of a phone's
    screen, so a header's one-point hairline survives the downscale. Rows are
    medians, so this is a few milliseconds even for a 2556px-tall picture. */
const SAMPLE_WIDTH = 390;
/** Never more of the height than this, top and bottom together. */
const MAX_TRIM = 0.3;
/** Channel distance under which two colours are the same ground. */
const SAME = 18;
/** A hairline is fainter than a change of ground (a 0.33pt rule averaged
    into a 1pt row), but a row's median does not carry noise, so a small
    distance on the median is still a line. */
const LINE = 6;

type Rgb = [number, number, number];

function at(data: ArrayLike<number>, width: number, x: number, y: number): Rgb {
  const i = (y * width + x) * 4;
  return [data[i]!, data[i + 1]!, data[i + 2]!];
}
const far = (a: Rgb, b: Rgb, limit = SAME) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2])) > limit;

/** A row's ground (its median colour, channel by channel) and how much of
    [from, to) of its width is not that ground. */
function row(data: ArrayLike<number>, width: number, y: number) {
  const chan = (c: number) => {
    const values: number[] = [];
    for (let x = 0; x < width; x++) values.push(data[(y * width + x) * 4 + c]!);
    values.sort((a, b) => a - b);
    return values[values.length >> 1]!;
  };
  const ground: Rgb = [chan(0), chan(1), chan(2)];
  const busy = (from: number, to: number) => {
    const a = Math.floor(from * width), b = Math.ceil(to * width);
    let n = 0;
    for (let x = a; x < b; x++) if (far(at(data, width, x, y), ground)) n++;
    return n / Math.max(1, b - a);
  };
  return { ground, busy };
}

/**
 * Where the status bar, the app's header and its tab bar end, as fractions
 * of the height. `data` is RGBA, row-major, `width` x `height`.
 */
export function trimBox(data: ArrayLike<number>, width: number, height: number): Trim {
  if (width < 8 || height < width * PHONE_TALL) return NO_TRIM;
  const rows = Array.from({ length: height }, (_, y) => row(data, width, y));
  const quiet = (y: number) => rows[y]!.busy(0, 1) < 0.02;

  /* ── THE STATUS BAR: a clock at the left, icons at the right, and NOTHING
     in the middle third, on one ground. Measured off iPhone screenshots
     (2026-11-27): 44 to 62pt of 375 to 430pt wide, 0.11 to 0.16 of the
     width; Android's is shorter. A picture whose middle is busy up there
     (a photo, a video running under the clock) is not a screenshot's top. */
  const statusCap = Math.round(width * 0.17);
  let lastSide = -1;
  for (let y = 0; y < statusCap; y++) {
    const r = rows[y]!;
    if (r.busy(0.36, 0.64) > 0.04 || far(r.ground, rows[0]!.ground)) {
      /* the middle filled: the top is over unless it is past the clock */
      if (lastSide < 0) return NO_TRIM;
      break;
    }
    if (r.busy(0, 0.3) > 0.06 || r.busy(0.7, 1) > 0.06) lastSide = y;
  }
  if (lastSide < Math.round(width * 0.03)) return NO_TRIM;
  /* Half the quiet gap under the clock stays, as the page's top margin. */
  let gap = 0;
  while (lastSide + 1 + gap < statusCap && quiet(lastSide + 1 + gap)) gap++;
  let top = lastSide + 1 + Math.floor(gap / 2);

  /* ── THE HEADER: only where an edge says where it ends. */
  const header = edgeBelow(rows, top, Math.min(height, top + Math.round(width * 0.22)), 1, Math.round(width * 0.06));
  if (header !== null) top = header;

  /* ── THE TAB BAR AND THE HOME INDICATOR, from the foot up. A tab bar is
     49pt and the indicator's strip 34pt (0.13 to 0.21 of the width), so an
     edge closer to the foot than 0.12 of the width is the content's own
     (a figure's foot, a rule), never the bar's, and is kept. */
  let bottom = height;
  const tabs = edgeBelow(rows, height - 1, Math.max(top, height - 1 - Math.round(width * 0.3)), -1, Math.round(width * 0.12));
  if (tabs !== null) bottom = tabs;

  const trim = { top: top / height, bottom: (height - bottom) / height };
  if (trim.top + trim.bottom > MAX_TRIM) return { top: Math.min(trim.top, MAX_TRIM), bottom: 0 };
  return trim;
}

/**
 * Walking from `from` toward `to` (step +1 down, -1 up), the first edge of a
 * bar: a hairline (one to three rows unlike the ground on both sides of it,
 * which match each other) or a change of ground that holds. Returns the row
 * just past the edge, or null when the band shows none. The band before the
 * edge must hold something (a title, icons), and be at least `least` rows:
 * an empty or thin band is the page's own margin or rule.
 */
function edgeBelow(rows: ReadonlyArray<ReturnType<typeof row>>, from: number, to: number, step: 1 | -1, least: number): number | null {
  const start = rows[from]?.ground;
  if (!start) return null;
  let held = false;
  for (let y = from + step; step > 0 ? y < to - 4 : y > to + 4; y += step) {
    const r = rows[y]!;
    if (r.busy(0, 1) > 0.04) held = true;
    if (!far(r.ground, start, LINE) || r.busy(0, 1) > 0.2) continue;
    /* too near to be a bar's edge: the band is still the bar's own */
    if (Math.abs(y - from) < least) return null;
    /* a hairline: within three rows the ground comes back */
    for (let w = 1; w <= 3; w++) {
      const after = rows[y + step * w];
      if (after && !far(after.ground, start, LINE) && after.busy(0, 1) < 0.2) {
        return held ? (step > 0 ? y + w : y - w + 1) : null;
      }
    }
    if (!far(r.ground, start)) continue;
    /* a change of ground that holds for four rows */
    let holds = true;
    for (let w = 1; w <= 4; w++) {
      const next = rows[y + step * w];
      if (!next || far(next.ground, r.ground)) { holds = false; break; }
    }
    if (holds) return held ? (step > 0 ? y : y + 1) : null;
  }
  return null;
}

/**
 * The trim of a loaded picture, read off a small sample of it. A picture
 * whose pixels the page may not read (no CORS) is shown whole.
 */
export function readTrim(image: HTMLImageElement): Trim {
  const w = image.naturalWidth, h = image.naturalHeight;
  if (!w || !h || h < w * PHONE_TALL) return NO_TRIM;
  try {
    const width = SAMPLE_WIDTH, height = Math.round(SAMPLE_WIDTH * h / w);
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
