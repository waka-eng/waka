/** WHAT THIS MOCKS, AND WHY: `window` and `document` simulate cold device preferences,
 * DOM metadata and disabled storage in Vitest's Node environment. Real locale
 * resolution and writes run unchanged. */
import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { applyDocumentLocale, LOCALE_STORAGE_KEY, readStoredLocale, writeStoredLocale } from '../src/lib/locales';

afterEach(() => vi.unstubAllGlobals());

it('uses the first supported browser language on a cold Korean device', () => {
  vi.stubGlobal('window', { navigator: { languages: ['fr-FR', 'ko', 'en-US'], language: 'fr-FR' } });
  vi.stubGlobal('document', { documentElement: { lang: 'en' } });
  applyDocumentLocale(readStoredLocale());
  expect(document.documentElement.lang).toBe('ko-KR');
});

it('honors a saved preference and updates document language even when storage is unavailable', () => {
  const getItem = vi.fn(() => 'en-US');
  vi.stubGlobal('window', {
    navigator: { language: 'ko-KR' },
    localStorage: { getItem, setItem: () => { throw new Error('Synthetic storage denial'); } },
  });
  vi.stubGlobal('document', { documentElement: { lang: 'ko-KR' } });
  expect(readStoredLocale()).toBe('en-US');
  expect(getItem).toHaveBeenCalledWith(LOCALE_STORAGE_KEY);
  writeStoredLocale('en-US');
  expect(document.documentElement.lang).toBe('en-US');
});

it('uses the single browser language when its language list is unavailable', () => {
  vi.stubGlobal('window', { navigator: { language: 'ko-KP' } });
  expect(readStoredLocale()).toBe('ko-KR');
});

it('opens the matching install description while keeping the same app and share target', () => {
  let href = '/manifest.webmanifest';
  const manifestLink = { getAttribute: () => href, setAttribute: (_name: string, value: string) => { href = value; } };
  vi.stubGlobal('document', { documentElement: { lang: 'en' }, head: { querySelector: () => manifestLink } });
  const readManifest = () => JSON.parse(readFileSync(new URL('../public' + href, import.meta.url), 'utf8'));
  applyDocumentLocale('ko-KR');
  const { description: ko, lang: koLocale, ...koApp } = readManifest();
  applyDocumentLocale('en-US');
  const { description: en, lang: enLocale, ...enApp } = readManifest();
  expect([koLocale, enLocale]).toEqual(['ko-KR', 'en-US']);
  expect(ko).toContain('메모');
  expect(en).toContain('Save');
  expect(koApp).toEqual(enApp);
});
