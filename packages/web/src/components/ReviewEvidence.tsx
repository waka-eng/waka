import type {ApiSignalReviewEvidence} from '../lib/api/signals';
import {t,type SupportedLocale} from '../lib/locales';

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
 */
export function ReviewEvidence({rows,locale}:{rows:ApiSignalReviewEvidence[];locale:SupportedLocale}){
  const seen=new Set<string>();
  return <>{rows.filter(row=>{if(seen.has(row.answerId))return false;seen.add(row.answerId);return true;}).map(row=>{
    const text=row.preview.trim(),excerpt=text.length>240?`${text.slice(0,237)}…`:text;
    return <blockquote className="jar-review-evidence" key={row.answerId}>
      <p>{excerpt}</p>
      <footer>{t(locale,'worldReviewEvidence')} · {new Date(row.createdAt).toLocaleDateString(locale,{month:'short',day:'numeric'})}</footer>
    </blockquote>;
  })}</>;
}
