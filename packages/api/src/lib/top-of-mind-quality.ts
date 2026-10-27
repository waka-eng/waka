import type { SupportedLocale } from './locales.js';
import type { ModelProvider, TopOfMindReviewInput } from './model-provider.js';

/** The sources behind an entry, not the number of signal IDs it names. */
export interface TopOfMindQualityContext {
  locale: SupportedLocale;
  signalOrigins: ReadonlyMap<string, readonly string[]>;
  sourceTexts: ReadonlyMap<string, readonly string[]>;
}

const normalize = (text: string) => text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/** Cheap script prefilter. The separate publication review checks the actual
 * language, including Latin-script languages and mostly-English Korean text. */
export function readingMatchesLocale(text: string, locale: SupportedLocale): boolean {
  const letters = text.match(/\p{L}/gu)?.length ?? 0;
  const hangul = text.match(/\p{Script=Hangul}/gu)?.length ?? 0;
  const latin = text.match(/\p{Script=Latin}/gu)?.length ?? 0;
  return locale === 'ko-KR'
    ? hangul > 0 && hangul >= letters * 0.2
    : latin > 0 && latin >= letters * 0.8;
}

/** Punctuation/spacing changes do not turn a quotation into synthesis.
 * Check full excerpts and pasted sentences, including a quote followed by
 * newly generated filler. Short shared names and phrases are allowed. */
export function copiesSource(text: string, sources: readonly string[]): boolean {
  const candidate = normalize(text);
  if (!candidate) return true;
  return sources.some(source => {
    const original = normalize(source);
    if (!original) return false;
    if (original.includes(candidate)) return true;
    if (original.length >= 12 && candidate.includes(original)) return true;
    return source.split(/[.!?。！？\n]+/u).some(sentence => {
      const passage = normalize(sentence);
      return passage.length >= 24 && candidate.includes(passage);
    });
  });
}

function sourceFingerprint(id: string, context: TopOfMindQualityContext): string | null {
  const parts = [...new Set((context.sourceTexts.get(id) ?? []).map(normalize).filter(Boolean))].sort();
  return parts.length ? JSON.stringify(parts) : null;
}

export function distinctReadingOrigins(ids: readonly string[], context: TopOfMindQualityContext): number {
  const originals = new Set<string>();
  for (const id of new Set(ids.flatMap(id => context.signalOrigins.get(id) ?? []))) {
    const fingerprint = sourceFingerprint(id, context);
    // Re-saving identical material does not supply a different inspiration.
    if (fingerprint) originals.add(fingerprint);
  }
  return originals.size;
}

/** Applied to generated and carried machine text. Human-kept words bypass
 * this check at the caller and always remain byte-identical. */
export function readingQualityIssue(entry: {
  body: string; belief?: string | null; prompt?: string | null; citedSignalIds: string[];
}, context: TopOfMindQualityContext): 'language' | 'single_source' | 'copied_source' | null {
  const wording = [entry.body, entry.belief, entry.prompt].filter((text): text is string => Boolean(text?.trim()));
  if (wording.some(text => !readingMatchesLocale(text, context.locale))) return 'language';
  if (distinctReadingOrigins(entry.citedSignalIds, context) < 2) return 'single_source';
  const sources = [...context.sourceTexts.values()].flat();
  if (wording.some(text => copiesSource(text, sources))) return 'copied_source';
  return null;
}

type ReviewEntry = TopOfMindReviewInput['entries'][number] & { citedSignalIds: string[] };

/** One bounded review for new and carried machine entries together. Original
 * IDs come from current evidence, never from a model-provided citation. */
export async function reviewReadingEntries(
  entries: Array<Omit<ReviewEntry, 'inspirationIds'>>,
  context: TopOfMindQualityContext,
  provider: Pick<ModelProvider, 'reviewTopOfMind'>,
): Promise<Set<number>> {
  if (!entries.length) return new Set();
  if (entries.length > 14) throw new Error('Top of mind review exceeds entry limit');
  const originals = new Map<string, TopOfMindReviewInput['inspirations'][number]>();
  const input: TopOfMindReviewInput = {
    preferredLocale: context.locale,
    entries: entries.map(entry => {
      const seen = new Set<string>();
      const inspirationIds = [...new Set(entry.citedSignalIds.flatMap(id => context.signalOrigins.get(id) ?? []))]
        .filter(id => {
          const fingerprint = sourceFingerprint(id, context);
          if (!fingerprint || seen.has(fingerprint)) return false;
          seen.add(fingerprint); return true;
        }).slice(0, 4);
      for (const id of inspirationIds) {
        const text = context.sourceTexts.get(id)!.join('\n\n');
        originals.set(id, { id, text: text.slice(0, 1600), truncated: text.length > 1600 });
      }
      return { body: entry.body, belief: entry.belief, prompt: entry.prompt, inspirationIds };
    }),
    inspirations: [],
  };
  input.inspirations = [...originals.values()];
  const result = await provider.reviewTopOfMind(input);
  const approved = new Set<number>();
  const seen = new Set<number>();
  for (const verdict of result.entries) {
    const entry = input.entries[verdict.index];
    if (!Number.isInteger(verdict.index) || !entry || seen.has(verdict.index)) {
      throw new Error('Invalid top of mind review verdict');
    }
    seen.add(verdict.index);
    // A positive verdict needs actual, distinct cited originals. Invented or
    // unrelated source IDs cannot turn an unsupported conclusion into a pass.
    const ids = verdict.supportingInspirationIds;
    const supporting = new Map([['review', ids]]);
    if (verdict.languageMatches && verdict.grounded && verdict.synthesized &&
        ids.every(id => entry.inspirationIds.includes(id)) &&
        distinctReadingOrigins(['review'], { ...context, signalOrigins: supporting }) >= 2) {
      approved.add(verdict.index);
    }
  }
  if (seen.size !== entries.length) throw new Error('Incomplete top of mind review');
  return approved;
}
