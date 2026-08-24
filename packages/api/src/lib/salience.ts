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

/**
 * The whole rule for what may be stored on an evidence row, in one place a
 * test can run.
 *
 * `verifyQuote` above answers "is this real, and whose words is it". This
 * answers the question the derivation pass actually asks: "what, if
 * anything, do I write to `signal_evidence.quote`" — and it exists as its
 * own function because the answer has two ordering rules that are invisible
 * when they are four inline lines, and both of them are wrong in the
 * direction of attributing invented text to a person.
 *
 * ONLY THE PERSON'S OWN WORDS. An enrichment quote is real but it is the
 * article speaking. There is no column recording which, and the world's
 * renderer prints an unfound quote by itself inside the memory's card, so an
 * enrichment quote would arrive indistinguishable from a sentence the member
 * wrote. No quote is the honest answer until there is somewhere to put the
 * provenance.
 *
 * CLIP AFTER VERIFYING — AND THE REASON IS NOT THE OBVIOUS ONE.
 *
 * The obvious reason would be that clipping first shortens an honest quote
 * into something the source no longer contains. That is not true and it was
 * worth finding out: a prefix of a span that appears verbatim also appears
 * verbatim, so at any budget above `verifyQuote`'s twelve-character floor the
 * two orders return the same answer. Mutating this function to clip first
 * leaves every test below green, which is the honest state of affairs and is
 * recorded here so the next reader does not add a comment claiming otherwise.
 *
 * The order is kept this way because it is the one that reads correctly —
 * decide whether the words are the person's, then fit them — and because it
 * keeps the budget a question of storage rather than of trust. What IS worth
 * asserting is the property both orders happen to give: whatever is stored is
 * a verbatim span of the person's own text. That is what the tests pin.
 */
export function quoteForEvidence(
  quote: string | null | undefined,
  memory: { text: string; enrichment: string | null },
  maxLength: number,
): string | null {
  const verified = verifyQuote(quote, memory);
  if (!verified || verified.source !== "own") return null;
  return verified.quote.length > maxLength
    ? verified.quote.slice(0, maxLength)
    : verified.quote;
}
