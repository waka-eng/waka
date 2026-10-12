// @vitest-environment jsdom
/**
 * ═══ A KOREAN READER MEETS NO ENGLISH ═══════════════════════════════════
 *
 * Two regressions, found by a localisation audit on 2026-10-11, both of which
 * every existing gate was structurally unable to see.
 *
 *   `whyFailed(err, fallback)` took `locale: SupportedLocale = "en-US"`. Its
 *   reason clause is the last half of every failure sentence in the product,
 *   so a Korean reader got
 *
 *       저장되지 않았어요 — The server could not be reached.
 *
 *   with `worldWhyUnreachable`'s Korean row sitting in the catalogue,
 *   translated, two inches away and unreachable.
 *
 *   `AttachmentPreview.tsx` and `AttachmentTranscript.tsx` imported nothing
 *   from `lib/i18n` at all and rendered forty-two English sentences to
 *   everyone.
 *
 * ── WHY NEITHER WAS CATCHABLE BEFORE ──────────────────────────────────────
 *
 * `i18n.test.ts` asks for key PARITY between the two catalogues, and both
 * files were at 626/626 the whole time. `copy.test.ts` asks whether every
 * catalogue key is RENDERED somewhere, and reported zero orphans. Both gates
 * ask questions about the catalogue, and both of these bugs live outside it:
 * one in a default argument, one in two files that never opened it. A
 * catalogue in perfect health is not evidence that a reader meets it.
 *
 * So this gate asks the question from the reader's end instead: mount the
 * surface in Korean, read what it actually says, and fail on a Latin word.
 *
 * ── AND IT IS THE SUITE'S HANGUL PROOF NOW ────────────────────────────────
 *
 * Before this file, the single assertion in the whole suite that proved
 * Korean reaches anybody was `i18n.test.ts`'s
 * `expect(/[가-힣]/.test(t("ko-KR", "tagline"))).toBe(true)` — a catalogue
 * lookup for a key that nothing in the product renders. It proves the FILE
 * holds Hangul. It cannot prove a screen does, which is exactly the gap both
 * regressions above lived in. These cases mount real components and read the
 * DOM, so the claim is about a screen.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): `lib/api`'s four attachment transport
 * methods, to supply a response without a server. Nothing about the language
 * is mocked — the components' own render, their own `t()` calls and the real
 * catalogue files all run.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AttachmentPreview } from '../src/components/AttachmentPreview';
import { AttachmentTranscript } from '../src/components/AttachmentTranscript';
import { ApiError, fetchAttachmentDetails, fetchAttachmentTranscript, type ApiAttachmentDetails, type ApiAttachmentTranscript } from '../src/lib/api';
import { whyFailed, whyOf } from '../src/lib/why-failed';

vi.mock('../src/lib/api', async original => ({ ...await original<typeof import('../src/lib/api')>(),
  fetchAttachmentDetails: vi.fn(), retryAttachmentAnalysis: vi.fn(),
  fetchAttachmentTranscript: vi.fn(), correctAttachmentTranscript: vi.fn(), retryAttachmentTranscript: vi.fn(),
}));

/**
 * A RUN OF LATIN LETTERS THAT IS THE PRODUCT'S OWN WORDING.
 *
 * Not "any Latin character": a Korean screen legitimately carries proper
 * nouns and machine strings a translator must not touch — `WAKA`, a hostname,
 * a person's name, the body text of the saved page itself. What must never
 * appear is a WORD THIS PRODUCT CHOSE and failed to translate, and the
 * cheapest honest proxy for that is two or more Latin words in a row, which
 * is a phrase rather than a name.
 *
 * The fixtures below are written in Hangul for exactly this reason, so that
 * any Latin phrase in the output came from the component rather than from the
 * data it was handed.
 */
const LATIN_PHRASE = /[A-Za-z]{2,}[ ’'-]+[A-Za-z]{2,}/g;

function englishIn(text: string): string[] {
  return [...new Set(text.match(LATIN_PHRASE) ?? [])];
}

describe("a reason clause speaks the reader's language", () => {
  /* THE COMPILER IS THE REAL GATE, AND THIS CASE SAYS SO IN ONE PLACE.
     `locale` is a required parameter on both functions now, so omitting it is
     a `tsc --noEmit` error at the call site — in the editor, before anything
     runs, on call sites that do not exist yet. That is strictly stronger than
     any test, which can only ever check the call sites somebody thought to
     look at. This case guards the one thing a type cannot: that nobody
     "helpfully" restores the default to quieten a red build. */
  it('takes no default locale, so an omission cannot compile', async () => {
    const { readFileSync } = await import('node:fs');
    const { dirname, resolve } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const source = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../src/lib/why-failed.ts'),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, ' ');
    const defaulted = [...source.matchAll(/locale\s*:\s*SupportedLocale\s*=/g)];
    expect(
      defaulted.map((match) => match[0]),
      'a locale parameter here has a default again. A default makes the ' +
        'omission compile, and the omission IS the bug — it printed an ' +
        'English reason clause onto the end of a Korean sentence everywhere ' +
        'in the product. Every caller already holds the reader’s locale; ' +
        'it needed one to write its own fallback. Pass it.',
    ).toEqual([]);
  });

  it('says why a request failed with no English in it', () => {
    /* status 0 and 401 are the two cases whose every word this product
       chooses. 500 deliberately is not: `worldWhyServerSaidNo` embeds the API
       client's own message, which is English by design — `copy.test.ts`
       records that those strings are copy precisely BECAUSE this function
       prints them — and translating `lib/api` is a separate job in a separate
       package. What is asserted here is that every word the WEB chooses is
       Korean. */
    for (const status of [0, 401]) {
      const sentence = whyFailed(new ApiError({ status, message: 'network unreachable' }), '저장되지 않았어요.', 'ko-KR');
      expect(englishIn(sentence), `ko-KR, status ${status}: ${sentence}`).toEqual([]);
      expect(/[가-힣]/.test(sentence), sentence).toBe(true);
    }
    /* And the clause alone, which the boot's failure screen prints without a
       fallback in front of it. */
    expect(englishIn(whyOf(new ApiError({ status: 0, message: 'x' }), 'ko-KR'))).toEqual([]);
    /* English is unchanged — this is a localisation fix, not a rewrite. */
    expect(whyFailed(new ApiError({ status: 401, message: 'x' }), 'That was not saved.', 'en-US'))
      .toBe('That was not saved — You are signed out. Sign in and it is still here.');
  });
});

describe('an attachment speaks the reader’s language', () => {
  let host: HTMLDivElement, root: Root;
  beforeEach(() => {
    vi.resetAllMocks();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });

  /* EVERY FIXTURE FIELD IS HANGUL OR A NUMBER. A fixture carrying English —
     a page title, a transcript, a site name — would make this gate pass or
     fail for reasons that have nothing to do with the component. */
  function linkDetails(status: ApiAttachmentDetails['analysis']['status'], errorReason: string | null = null): ApiAttachmentDetails {
    return { attachment: { id: 'link', inspirationId: 'source', type: 'link', url: 'https://example.test/글',
      name: null, contentType: null, size: null, createdAt: new Date().toISOString(),
      enrichment: { status: status === 'ready' ? 'ready' : 'failed', kind: 'page_body', text: '본문', errorReason,
        updatedAt: null, image: null, link: { title: '생각하기 좋은 곳', description: '짧은 소개', siteName: '보기',
          hostname: 'example.test', finalUrl: 'https://example.test/글', previewImageUrl: null } } },
      previewImageAvailable: false, analysis: { status, canRetry: status !== 'ready', retryAfter: null } };
  }

  it.each(['ready', 'pending', 'failed', 'unavailable'] as const)('renders a saved link in Korean while %s', async status => {
    vi.mocked(fetchAttachmentDetails).mockImplementation(async () => linkDetails(status));
    await act(async () => root.render(<AttachmentPreview item={{ id: 'link', type: 'link', label: 'https://example.test/글', url: 'https://example.test/글' }} locale="ko-KR" />));
    const said = `${host.textContent ?? ''} ${[...host.querySelectorAll('[aria-label]')].map(node => node.getAttribute('aria-label')).join(' ')}`;
    expect(englishIn(said), `${status}: ${said}`).toEqual([]);
    expect(/[가-힣]/.test(said), said).toBe(true);
  });

  it('explains an access-required page in Korean', async () => {
    vi.mocked(fetchAttachmentDetails).mockImplementation(async () => linkDetails('unavailable', 'http_403'));
    await act(async () => root.render(<AttachmentPreview item={{ id: 'link', type: 'link', label: 'https://example.test/글' }} locale="ko-KR" />));
    expect(englishIn(host.textContent ?? ''), host.textContent ?? '').toEqual([]);
  });

  it('says in Korean that a preview could not be loaded at all', async () => {
    vi.mocked(fetchAttachmentDetails).mockImplementation(async () => { throw new ApiError({ status: 0, message: 'network unreachable' }); });
    await act(async () => root.render(<AttachmentPreview item={{ id: 'photo', type: 'image', label: '사진' }} locale="ko-KR" />));
    const said = host.textContent ?? '';
    /* The failure path is the one that was worst in English: a person whose
       photo would not read got a sentence in a language they had not
       chosen, at the moment they most needed to understand it. */
    expect(englishIn(said), said).toEqual([]);
    expect(/[가-힣]/.test(said), said).toBe(true);
  });

  function transcript(over: Partial<ApiAttachmentTranscript> = {}): ApiAttachmentTranscript {
    return { attachmentId: 'audio', inspirationId: 'source', profileId: 'owner', revision: '1', status: 'ready',
      transcript: '기계가 옮긴 문구', correction: null, effectiveText: '기계가 옮긴 문구', correctedAt: null,
      reason: null, canEdit: true, canRetry: false, retryAfter: null, ...over };
  }

  it.each([
    ['ready', transcript()],
    ['pending', transcript({ status: 'pending', effectiveText: null })],
    ['no speech', transcript({ status: 'unavailable', reason: 'audio_no_speech', effectiveText: null, canRetry: true })],
    ['too long', transcript({ status: 'unavailable', reason: 'audio_too_long', effectiveText: null })],
    ['too large', transcript({ status: 'unavailable', reason: 'audio_too_large_to_transcribe', effectiveText: null })],
    ['corrected', transcript({ correction: '내가 고친 문구', effectiveText: '내가 고친 문구' })],
  ])('renders a recording in Korean while %s', async (_name, row) => {
    vi.mocked(fetchAttachmentTranscript).mockImplementation(async () => ({ ...row }));
    await act(async () => root.render(<AttachmentTranscript id="audio" locale="ko-KR" />));
    const said = `${host.textContent ?? ''} ${[...host.querySelectorAll('[aria-label]')].map(node => node.getAttribute('aria-label')).join(' ')}`;
    expect(englishIn(said), said).toEqual([]);
    expect(/[가-힣]/.test(said), said).toBe(true);
  });

  it('writes the correction editor and its controls in Korean', async () => {
    vi.mocked(fetchAttachmentTranscript).mockImplementation(async () => transcript());
    await act(async () => root.render(<AttachmentTranscript id="audio" locale="ko-KR" />));
    const edit = [...host.querySelectorAll('button')][0]!;
    await act(async () => edit.click());
    const said = `${host.textContent ?? ''} ${[...host.querySelectorAll('[aria-label]')].map(node => node.getAttribute('aria-label')).join(' ')}`;
    expect(host.querySelector('textarea'), 'the editor did not open').not.toBeNull();
    expect(englishIn(said), said).toEqual([]);
    expect(/[가-힣]/.test(said), said).toBe(true);
  });

  it('still says every one of those things in English', async () => {
    /* THE OTHER HALF OF THE RATCHET. The cheapest way to make the cases above
       green is to render nothing, or to render Hangul to everybody. The
       fixture's own words are English here so that any Hangul in the output
       came from the component. */
    vi.mocked(fetchAttachmentTranscript).mockImplementation(async () => transcript({
      transcript: 'Machine transcript', effectiveText: 'Machine transcript',
      status: 'unavailable', reason: 'audio_too_long', canRetry: true,
    }));
    await act(async () => root.render(<AttachmentTranscript id="audio" locale="en-US" />));
    expect(host.textContent).toContain('Transcript');
    expect(host.textContent).toContain('too long to transcribe');
    expect(host.textContent).toContain('Retry transcription');
    expect(/[가-힣]/.test(host.textContent ?? ''), host.textContent ?? '').toBe(false);
  });
});
