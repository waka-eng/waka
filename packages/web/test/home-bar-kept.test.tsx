// @vitest-environment jsdom
/**
 * "{n} KEPT ⌃" ABOVE THE HOME BAR (founder, 2026-11-09: "should be x kept").
 *
 * The pull over the bar says how many you have kept once that is known, and
 * only "Kept" before then or at none. The count rides on the catalogue's
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

it('says how many are kept, and only "Kept" while that is unknown or none', async () => {
  expect(await pullFor('en-US', 12)).toBe('12 kept');
  expect(await pullFor('en-US', 1)).toBe('1 kept');
  expect(await pullFor('en-US', 0)).toBe('Kept');
  expect(await pullFor('en-US', undefined)).toBe('Kept');
});

it('says it in Korean order in Korean', async () => {
  expect(await pullFor('ko-KR', 12)).toBe('남긴 것 12개');
  expect(await pullFor('ko-KR', undefined)).toBe('남긴 것');
});
