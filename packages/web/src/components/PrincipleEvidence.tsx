import type { ApiPrinciple } from "../lib/api/principles";
import { t, type SupportedLocale } from "../lib/i18n";
import { dateWords } from "../lib/words";
import {ReviewEvidence} from './ReviewEvidence';

/** A display excerpt, never a rewrite of the saved statement or its evidence. */
export function principleEvidenceExcerpt(value: string, limit = 150): string {
  const clean = value
    .split(new RegExp("\\s*\\((?:this is a pattern|this pattern|i also see)\\b", "i"))[0]!
    .split(/\s*(?:[—–]\s*)?(?:grounded in|earlier witness|evidence ids?|source ids?)\s*:/i)[0]!
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{8,12}\b/gi, "")
    .replace(/\b[0-9a-f]{32,64}\b/gi, "")
    .replace(/\s+/g, " ").trim();
  if (clean.length <= limit) return clean;
  const sentence = clean.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim();
  if (sentence && sentence.length <= limit) return sentence;
  const slice = clean.slice(0, limit);
  const boundary = slice.lastIndexOf(" ");
  return `${slice.slice(0, boundary > limit / 2 ? boundary : limit).trim()}…`;
}

export function PrincipleEvidence({ signals, locale }: {
  signals: ApiPrinciple["citedSignals"]; locale: SupportedLocale;
}) {
  const shown = new Set<string>();
  const shownAnswers = new Set<string>();
  return <div className="jar-principle-evidence">
    {signals.map((signal) => {
      const excerpt = principleEvidenceExcerpt(signal.statement);
      const example = signal.examples?.find((item) => !shown.has(item.text));
      if (example) shown.add(example.text);
      const sourceText = example ? principleEvidenceExcerpt(example.text, 180) : "";
      const reviews=(signal.reviewExamples??[]).filter(row=>{if(shownAnswers.has(row.answerId))return false;shownAnswers.add(row.answerId);return true;});
      if (!excerpt && !sourceText && !reviews.length) return null;
      return <div className="jar-principle-reference" key={signal.id}>
        {excerpt ? <p>{excerpt}</p> : null}
        {sourceText && example ? <blockquote>
          <p>{sourceText}</p>
          {/* THE SAME DATE WORD THE QUOTE BELOW IT WEARS — see
              `ReviewEvidence`, which carried the identical option bag and the
              identical missing year rule. Two footers under one principle,
              saying when, out of two hand-written `Intl` calls: they agreed
              today and had nothing holding them together. `dateWords` is the
              one place that question is answered. */}
          <footer>{t(locale, "worldPrincipleSavedExample")} · {Number.isFinite(Date.parse(example.createdAt))?dateWords(Date.parse(example.createdAt),Date.now(),locale):''}</footer>
        </blockquote> : null}
        <ReviewEvidence rows={reviews} locale={locale}/>
      </div>;
    })}
  </div>;
}
