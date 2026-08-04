/**
 * Which words in a save carried a reading.
 *
 * A save already says *that* it fed a reading, and a citation says *why* in
 * prose. Neither says which words — and the gap is widest exactly where the
 * save is longest, since a thousand-word essay gets credited whole for a
 * reading that turned on one sentence.
 *
 * The judge names the span; this decides whether to believe it.
 *
 * **The refusal is the feature.** Models paraphrase. A quote is kept only when
 * it genuinely appears in the save, because a missing highlight is honest and a
 * wrong one attributes words to a person who never wrote them. Same discipline
 * `combination-reading` applies to member quotes, one layer down.
 */

/**
 * Whitespace is the only difference allowed.
 *
 * A model reliably re-wraps and re-spaces what it copies — a line break becomes
 * a space, a double space collapses — and refusing those would throw away
 * almost every honest quote to catch nothing. Anything beyond whitespace is a
 * different set of words, and a different set of words is not a quote.
 */
function normalizeForMatch(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * A save's readable text has two authors.
 *
 * What the person wrote, and what the page they linked said. A quote from the
 * enrichment is the article speaking, not the member — and attributing an
 * article's argument to someone who only saved a link would be a claim about
 * them that nobody made.
 */
export type QuoteSource = "own" | "enrichment";

export interface VerifiedQuote {
  quote: string;
  source: QuoteSource;
}

/**
 * Keep the judge's quote only if the save actually contains it.
 *
 * Returns null for anything unverifiable — absent, empty, or not present in
 * either the person's words or the page's. The citation then renders exactly
 * as it does today, which is a worse card and never a false one.
 */
export function verifyQuote(
  quote: string | null | undefined,
  signal: { text: string; enrichment: string | null },
): VerifiedQuote | null {
  if (typeof quote !== "string") return null;
  const needle = normalizeForMatch(quote);
  // A quote of a couple of words points at nothing and matches everywhere.
  if (needle.length < 12) return null;

  if (normalizeForMatch(signal.text).includes(needle)) {
    return { quote: quote.trim(), source: "own" };
  }
  if (signal.enrichment && normalizeForMatch(signal.enrichment).includes(needle)) {
    return { quote: quote.trim(), source: "enrichment" };
  }
  return null;
}
