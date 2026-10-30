import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../lib/api/http';
import { readInspirationRelevance, reviewInspiration, type InspirationRelevance, type RelevanceChoice } from '../lib/api/inspiration-relevance';
import { t, type SupportedLocale } from '../lib/locales';
import { dateStamp } from '../lib/words';
import { ClaimSlip } from './ClaimSlip';

/** A check of the original, visually and semantically separate from a signal verdict. */
export function InspirationReviewCard({item:initial,profileId,locale,more,onDone,onChanged,onOpen}: {
  item:InspirationRelevance;profileId:string;locale:SupportedLocale;more:boolean;
  onDone:()=>void;onChanged:(choice:RelevanceChoice)=>void | Promise<void>;onOpen:()=>void;
}) {
  const [item,setItem]=useState(initial),[busy,setBusy]=useState(false),[changed,setChanged]=useState(false),[failed,setFailed]=useState(false);
  const saving=useRef(false),intent=useRef<{choice:RelevanceChoice;id:string}|null>(null);
  const alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  // Parent keys this component to the profile and source; late replies cannot advance another card.
  const say=(key:Parameters<typeof t>[1])=>t(locale,key);
  async function answer(choice:RelevanceChoice){
    if(saving.current||changed)return false;
    saving.current=true;setBusy(true);setFailed(false);
    if(intent.current?.choice!==choice)intent.current={choice,id:crypto.randomUUID()};
    try { await reviewInspiration(item,profileId,choice,intent.current.id);if(alive.current && choice!=='later')await onChanged(choice);return alive.current; }
    catch(error){if(!alive.current)return false;setFailed(true);if(error instanceof ApiError&&error.status===409)setChanged(true);return false;}
    finally{saving.current=false;if(alive.current)setBusy(false);}
  }
  return <ClaimSlip id={`${item.id}:${item.reviewVersion}:${item.sourceRevision}`} tone="reading" label={say('worldInspirationReviewQuestion')}
    more={more}
    labelKeep={say('worldInspirationStillRelevant')} labelNot={say('worldInspirationNotRelevant')}
    savingLabel={say('worldReviewAnswerSaving')} failureLabel={say(changed?'worldInspirationReviewChanged':'worldReviewAnswerFailed')}
    onAnswer={choice=>answer(choice==='keep'?'relevant':'not_relevant')} onLeft={onDone}>
    <p className="waka-inspiration-review-question">{say('worldInspirationReviewQuestion')}</p>
    <p className="jar-pick-source">{say('worldInspirationReviewOriginal')} · {dateStamp(new Date(item.createdAt).getTime(),locale)}</p>
    <blockquote className="jar-pick-statement waka-inspiration-review-text">{item.text || item.attachmentLabel || say('worldSavedWord')}</blockquote>
    {item.text&&item.attachmentLabel?<p className="jar-pick-source">{item.attachmentLabel}</p>:null}
    <p className="jar-pick-source">{say('worldInspirationReviewExplain')}</p>
    <button type="button" className="waka-inspiration-review-action" disabled={busy} onClick={onOpen}>{say('worldInspirationReviewOpen')}</button>{' '}
    {changed?<button type="button" className="waka-inspiration-review-action" disabled={busy} onClick={()=>{
      setBusy(true);void readInspirationRelevance(item.id,profileId).then(fresh=>{if(!alive.current)return;setItem(fresh);setChanged(false);setFailed(false);intent.current=null;}).catch(()=>{if(alive.current)setFailed(true);}).finally(()=>{if(alive.current)setBusy(false);});
    }}>{say('worldInspirationReviewReload')}</button>:<button type="button" className="waka-inspiration-review-action" disabled={busy} onClick={()=>{void answer('later').then(ok=>{if(ok&&alive.current)onDone();});}}>{say('worldInspirationReviewLater')}</button>}
    {failed?<p role="alert">{say(changed?'worldInspirationReviewChanged':'worldReviewAnswerFailed')}</p>:null}
  </ClaimSlip>;
}
