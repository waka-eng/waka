import type { ApiPrinciple } from "../lib/api/principles";
import { t, type SupportedLocale } from "../lib/i18n";

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
  return <div className="jar-principle-evidence">
    {signals.map((signal) => {
      const excerpt = principleEvidenceExcerpt(signal.statement);
      const example = signal.examples?.find((item) => !shown.has(item.text));
      if (example) shown.add(example.text);
      const sourceText = example ? principleEvidenceExcerpt(example.text, 180) : "";
      if (!excerpt && !sourceText) return null;
      return <div className="jar-principle-reference" key={signal.id}>
        {excerpt ? <p>{excerpt}</p> : null}
        {sourceText && example ? <blockquote>
          <p>{sourceText}</p>
          <footer>{t(locale, "worldPrincipleSavedExample")} · {new Date(example.createdAt).toLocaleDateString(locale, { month: "short", day: "numeric" })}</footer>
        </blockquote> : null}
      </div>;
    })}
  </div>;
}
