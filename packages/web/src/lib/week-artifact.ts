/**
 * ═══ YOUR WEEK, AS THE FILE THAT IS SHARED ═══
 *
 * The sheet's picture (`WeeklyCard`) is the first principle's reveal laid out
 * at 390 by 693 (9:16). This draws the same picture at 1080 by 1920, every
 * measure multiplied by one factor, so what leaves is what was seen:
 *
 *   - the home screen's night, with a few faint stars;
 *   - the reveal's words from 144 down: a small muted label, the line in
 *     Jost 300 (28 on the 390 picture), "From n inspirations", and where the
 *     reveal's acts sit, "My week · November 20 to 26" and a tiny WAKA;
 *   - the real creature at rest in the middle, in its warm light.
 *
 * Nothing boxed, no rule, no buttons.
 */
import { OWNER_BEING } from '../character/body';
import { restPose } from '../character/raster';
import { rampFromCss } from '../canvas/palette';
import { ArtifactLayoutError, wrapArtifactText } from './principle-artifact';

/** The picture as the sheet lays it out, in CSS px (claims.css `.waka-week-*`). */
export const WEEK_PICTURE = { width: 390, height: 693, wordsTop: 144, wordsWidth: 318, being: 104, beingCenterY: 520 } as const;
const OUT = { width: 1080, height: 1920 } as const;
const K = OUT.width / WEEK_PICTURE.width;
/** The reveal's measures at 390: label 13, line 28 on 1.3, from 13, gaps 16. */
const SIZE = { label: 13, line: 28, lineLeading: 1.3, from: 13, foot: 13, mark: 10, gap: 16 } as const;
const MAX_LINES = 3;

function seeded(seed: number): () => number {
  return () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
}

export async function renderWeekCard(words: { label: string; statement: string; from: string; foot: string }): Promise<Blob> {
  const line = words.statement.trim();
  if (!line) throw new ArtifactLayoutError('empty');
  if (line.length > 400 || words.foot.length > 80) throw new ArtifactLayoutError('too_long');
  let fallbackFont = true, timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (document.fonts) {
      const wanted = Promise.all([document.fonts.load(`300 ${SIZE.line * K}px Jost`, line), document.fonts.load(`400 ${SIZE.label * K}px Jost`, words.label),
        document.fonts.load(`300 ${SIZE.line * K}px Pretendard`, line)]);
      const loaded = await Promise.race([wanted, new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 3000); })]);
      fallbackFont = !loaded || loaded.every(faces => !faces.length);
    }
  } catch { /* A device font still makes the whole picture. */ } finally { clearTimeout(timer); }
  const family = fallbackFont ? 'Arial, "Apple SD Gothic Neo", sans-serif' : 'Jost, Pretendard, "Apple SD Gothic Neo", sans-serif';

  const { width, height } = OUT;
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d'); if (!ctx) throw new ArtifactLayoutError('unavailable');

  /* THE NIGHT: the home screen's own, as the reveal settles over it. */
  const ground = ctx.createLinearGradient(0, 0, 0, height);
  ground.addColorStop(0, '#080d18'); ground.addColorStop(0.6, '#04070e'); ground.addColorStop(1, '#020309');
  ctx.fillStyle = ground; ctx.fillRect(0, 0, width, height);
  const rand = seeded(11);
  for (let i = 0; i < 60; i += 1) {
    const x = rand() * width, y = rand() * height, r = 0.8 + rand() * 1.5;
    ctx.fillStyle = `rgba(255,242,220,${0.04 + rand() * 0.12})`; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }

  /* THE CREATURE, in the middle, in its warm light. */
  const being = WEEK_PICTURE.being * K, cx = width / 2, cy = WEEK_PICTURE.beingCenterY * K;
  const light = ctx.createRadialGradient(cx, cy, 0, cx, cy, being * 2);
  light.addColorStop(0, 'rgba(255,242,220,0.26)'); light.addColorStop(0.4, 'rgba(255,242,220,0.08)'); light.addColorStop(1, 'rgba(255,242,220,0)');
  ctx.fillStyle = light; ctx.fillRect(0, cy - being * 2, width, being * 4);
  ctx.save(); ctx.translate(cx - being / 2, cy - being / 2);
  restPose(ctx, being, rampFromCss(document.documentElement), OWNER_BEING, 1, 1);
  ctx.restore();

  /* THE REVEAL'S WORDS, centred, from the reveal's top. */
  const textW = WEEK_PICTURE.wordsWidth * K;
  const muted = 'rgba(232,237,244,0.6)';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  let y = WEEK_PICTURE.wordsTop * K;
  const say = (text: string, size: number, weight: number, ink: string, leading = 1.35) => {
    ctx.font = `${weight} ${size * K}px ${family}`; ctx.fillStyle = ink;
    const lines = wrapArtifactText(text, textW, value => ctx.measureText(value).width);
    for (const one of lines) { ctx.fillText(one, cx, y); y += size * K * leading; }
    return lines.length;
  };
  say(words.label, SIZE.label, 400, muted); y += SIZE.gap * K;
  ctx.font = `300 ${SIZE.line * K}px ${family}`;
  if (wrapArtifactText(line, textW, value => ctx.measureText(value).width).length > MAX_LINES + 1) throw new ArtifactLayoutError('too_long');
  say(line, SIZE.line, 300, '#fff6e6', SIZE.lineLeading); y += SIZE.gap * K;
  say(words.from, SIZE.from, 400, muted); y += SIZE.gap * 2 * K;
  say(words.foot, SIZE.foot, 400, muted); y += 6 * K;
  ctx.font = `500 ${SIZE.mark * K}px ${family}`; ctx.fillStyle = 'rgba(232,237,244,0.4)';
  ctx.fillText('WAKA', cx, y);

  return new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new ArtifactLayoutError('unavailable')), 'image/png'));
}
