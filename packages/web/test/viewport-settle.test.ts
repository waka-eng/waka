// @vitest-environment jsdom
/**
 * THE VISUAL VIEWPORT IS READ ONCE IT SETTLES (code review, 2026-11-08).
 *
 * A raw `visualViewport` resize listener called the world's `measure`
 * directly, so a pinch re-read the zoom and re-baked every sprite on each
 * frame of the gesture, bypassing the 160ms settle. Height (iOS toolbars,
 * the keyboard) and zoom now share one settled listener.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): nothing imported. jsdom has no
 * visual viewport, so the test stands one up (an EventTarget whose `scale`
 * and `height` it sets) and drives the timers; `onViewportSettle` is the
 * shipped one.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { onViewportSettle } from '../src/canvas/scale';

let viewport: EventTarget & { scale: number; height: number };
beforeEach(() => {
  vi.useFakeTimers();
  viewport = Object.assign(new EventTarget(), { scale: 1, height: 800 });
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
});
afterEach(() => { vi.useRealTimers(); Reflect.deleteProperty(window, 'visualViewport'); });
const resize = () => viewport.dispatchEvent(new Event('resize'));

it('re-measures once a pinch settles, never during it', () => {
  const measure = vi.fn();
  const off = onViewportSettle(measure);
  for (const scale of [1.1, 1.3, 1.6, 2]) { viewport.scale = scale; resize(); vi.advanceTimersByTime(50); }
  expect(measure, 'the world re-measured mid-pinch').not.toHaveBeenCalled();
  vi.advanceTimersByTime(200);
  expect(measure).toHaveBeenCalledTimes(1);
  off();
});

it('re-measures when only the visible height changes — the iPhone toolbar', () => {
  const measure = vi.fn();
  onViewportSettle(measure);
  viewport.height = 700; resize(); vi.advanceTimersByTime(200);
  expect(measure).toHaveBeenCalledTimes(1);
  resize(); vi.advanceTimersByTime(200);
  expect(measure, 'a resize that changed nothing re-measured').toHaveBeenCalledTimes(1);
});

it('leaves no raw viewport listener in the world that skips the settle', () => {
  const simulation = readFileSync(join('src', 'canvas', 'simulation.ts'), 'utf8');
  expect(simulation).not.toMatch(/visualViewport[\s\S]{0,80}addEventListener\("resize", measure\)/);
  expect(simulation).toContain('onViewportSettle(measure)');
});

/* Code review, 2026-11-08: a second helper (onZoomChange) repeated this one
   minus height. One helper, with height as an option. */
it('ignores a height change when asked to watch the zoom alone, and is the only viewport listener', () => {
  const measure = vi.fn();
  onViewportSettle(measure, { height: false });
  viewport.height = 600; resize(); vi.advanceTimersByTime(200);
  expect(measure, 'a zoom-only listener re-measured for height').not.toHaveBeenCalled();
  viewport.scale = 2; resize(); vi.advanceTimersByTime(200);
  expect(measure).toHaveBeenCalledTimes(1);
  const scale = readFileSync(join('src', 'canvas', 'scale.ts'), 'utf8');
  expect(scale.match(/addEventListener\("resize"/g), 'two viewport listeners again').toHaveLength(1);
  expect(scale).not.toContain('export function onZoomChange');
});
