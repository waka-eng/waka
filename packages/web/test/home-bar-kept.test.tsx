// @vitest-environment jsdom
/**
 * "{n} KEPT ⌃" ABOVE THE HOME BAR (founder, 2026-11-09: "should be x kept").
 *
 * The pull over the bar says how many you have kept once that is known, and
 * only "Saved" before then or at none. The count rides on the catalogue's
 * `worldBarKeptCount`, so Korean says it in its own order.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): nothing. `HomeBar` is rendered alone,
 * with the count handed in the way Home hands it.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { HomeBar } from '../src/components/HomeBar';
import type { SupportedLocale } from '../src/lib/locales';

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

async function pullFor(locale: SupportedLocale, kept: number | undefined): Promise<string> {
  await act(async () => root.render(<HomeBar locale={locale} onChat={() => undefined} pull={{ onOpen: () => undefined, kept }} />));
  return host.querySelector('.waka-home-bar-pull')?.textContent?.trim() ?? '';
}

/* "x inspirations" (founder, 2026-11-10); Home draws no handle at none. */
it('says how many inspirations, and only "Inspirations" when it is not told', async () => {
  expect(await pullFor('en-US', 12)).toBe('12 inspirations');
  expect(await pullFor('en-US', 1)).toBe('1 inspiration');
  expect(await pullFor('en-US', undefined)).toBe('Inspirations');
});

it('says it in Korean order in Korean', async () => {
  expect(await pullFor('ko-KR', 12)).toBe('메모 12개');
  expect(await pullFor('ko-KR', undefined)).toBe('메모');
});

/* A LIT GRABBER, TAPPED OR DRAGGED UP (founder meeting, 2026-11-20). */
it('opens once on a tap, and once on a drag up, never twice for the drag', async () => {
  let opened = 0;
  await act(async () => root.render(<HomeBar locale="en-US" onChat={() => undefined} pull={{ onOpen: () => { opened += 1; }, kept: 3 }} />));
  const pull = host.querySelector<HTMLButtonElement>('.waka-home-bar-pull')!;
  expect(pull.querySelector('.waka-home-bar-grab'), 'the handle has no grabber').not.toBeNull();
  await act(async () => pull.click());
  expect(opened).toBe(1);
  const at = (type: string, clientY: number) => pull.dispatchEvent(Object.assign(new MouseEvent(type, { bubbles: true, clientY }), { pointerId: 1 }));
  await act(async () => { at('pointerdown', 400); at('pointermove', 390); });
  expect(opened, 'a small move opened it').toBe(1);
  await act(async () => { at('pointermove', 360); at('pointermove', 300); at('pointerup', 300); pull.click(); });
  expect(opened, 'the drag did not open it exactly once').toBe(2);
});

it('lights the handle when the creature points at it', async () => {
  await act(async () => root.render(<HomeBar locale="en-US" onChat={() => undefined} pull={{ onOpen: () => undefined, kept: 3 }} beckon={{ n: 1, to: 'pull' }} />));
  expect(host.querySelector('.waka-home-bar-pull .waka-home-bar-beckon')).not.toBeNull();
  expect(host.querySelector('.waka-home-bar-pill .waka-home-bar-beckon'), 'the pill lit for the handle').toBeNull();
});
