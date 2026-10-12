import type {ApiSignalReviewEvidence} from '../lib/api/signals';
import {t,type SupportedLocale} from '../lib/locales';
import {dateWords} from '../lib/words';

/**
 * A literal excerpt of human words, never cleaned as generated reasoning.
 *
 * THE ONE SURVIVOR OF THE REVIEW FOLD, AND THE REASON IT SURVIVED.
 *
 * Founder's workflow design listed this with the four components it folded —
 * but `PrincipleEvidence` cites it, and so does the home screen's provenance
 * block, and what it renders is not a flow: it is the words a person wrote,
 * quoted under the principle they are evidence for. That is workflow three
 * ("read — outputs, not activities"), not the writing flow that was cut. The
 * review that collected these words is gone; deleting the words with it would
 * have made a principle rest on evidence nobody can see.
 *
 * WHAT WENT: the `Read your thought ↗` link under each quote. It addressed
 * `/review/:session?thought=:answer`, and that route is deleted — so the link
 * was about to become the thing `docs/six-laws.md` Law 8 is entirely about, a
 * control that renders, reads correctly, and does nothing. There is no
 * replacement destination to point it at, and inventing one would rebuild the
 * surface this change removed. The quote carries its own date instead, which
 * is what the link was mostly being pressed for.
 *
 * AND THE DATE IS `words.ts`'S WORD FOR A DATE. It was
 * `toLocaleDateString(locale, { month: 'short', day: 'numeric' })` written
 * here — the same option bag `dateWords` holds, minus the one rule
 * `dateWords` adds: the year appears when it is not this one. A quote under a
 * principle is EVIDENCE, and evidence dated "Oct 11" with no year is the one
 * kind of imprecision this surface cannot afford, on a product built for
 * somebody reading their own material back across years. Fixing it by adding
 * `year: 'numeric'` here would have been the fourth file to decide that
 * question for itself; calling the module is how it gets decided once.
 *
 * `Number.isFinite` GUARDS THE PARSE, which the `Intl` call did not need to —
 * it prints "Invalid Date" for a bad timestamp and `dateWords` would print
 * "Invalid Date NaN". A row whose `createdAt` the server mangled drops its
 * date and keeps its quote: the words are the evidence, the date is the
 * provenance, and losing the second is not a reason to hide the first.
 */
export function ReviewEvidence({rows,locale}:{rows:ApiSignalReviewEvidence[];locale:SupportedLocale}){
  const seen=new Set<string>();
  return <>{rows.filter(row=>{if(seen.has(row.answerId))return false;seen.add(row.answerId);return true;}).map(row=>{
    const text=row.preview.trim(),excerpt=text.length>240?`${text.slice(0,237)}…`:text;
    return <blockquote className="jar-review-evidence" key={row.answerId}>
      <p>{excerpt}</p>
      <footer>{t(locale,'worldReviewEvidence')} · {Number.isFinite(Date.parse(row.createdAt))?dateWords(Date.parse(row.createdAt),Date.now(),locale):''}</footer>
    </blockquote>;
  })}</>;
}
