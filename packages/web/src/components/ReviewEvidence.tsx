import type {ApiSignalReviewEvidence} from '../lib/api/signals';
import {t,type SupportedLocale} from '../lib/locales';

/** A literal excerpt of human words, never cleaned as generated reasoning. */
export function ReviewEvidence({rows,locale}:{rows:ApiSignalReviewEvidence[];locale:SupportedLocale}){
  const seen=new Set<string>();
  return <>{rows.filter(row=>{if(seen.has(row.answerId))return false;seen.add(row.answerId);return true;}).map(row=>{
    const text=row.preview.trim(),excerpt=text.length>240?`${text.slice(0,237)}…`:text;
    return <blockquote className="jar-review-evidence" key={row.answerId}>
      <p>{excerpt}</p>
      <footer>{t(locale,'worldReviewEvidence')} · {new Date(row.createdAt).toLocaleDateString(locale,{month:'short',day:'numeric'})}</footer>
      <a href={`/review/${encodeURIComponent(row.sessionId)}?thought=${encodeURIComponent(row.answerId)}`}>{t(locale,'worldReviewReadThought')} ↗</a>
    </blockquote>;
  })}</>;
}
