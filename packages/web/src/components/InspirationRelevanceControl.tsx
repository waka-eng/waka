import { useEffect, useRef, useState } from 'react';
import { readInspirationRelevance, reviewInspiration, type InspirationRelevance } from '../lib/api/inspiration-relevance';
import { t, type SupportedLocale } from '../lib/locales';

/** The archive retains originals and lets their owner reverse a relevance choice. */
export function InspirationRelevanceControl({id,profileId,locale,onChanged}: {id:string;profileId:string;locale:SupportedLocale;onChanged?:()=>void}){
  const [item,setItem]=useState<InspirationRelevance|null>(null),[failed,setFailed]=useState(false),[busy,setBusy]=useState(false),[attempt,setAttempt]=useState(0);
  const epoch=useRef(0),intent=useRef<string|null>(null),committing=useRef(false);
  useEffect(()=>{const run=++epoch.current;setItem(null);setFailed(false);intent.current=null;
    void readInspirationRelevance(id,profileId).then(row=>{if(run===epoch.current)setItem(row);}).catch(()=>{if(run===epoch.current)setFailed(true);});
    return()=>{epoch.current++;};
  },[id,profileId,attempt]);
  const say=(key:Parameters<typeof t>[1])=>t(locale,key);
  return <div className="waka-inspiration-relevance">
    {item?<><span>{say(item.memoryExcludedAt?'worldInspirationExcluded':'worldInspirationIncluded')}</span>{' '}
      <button type="button" className="waka-inspiration-review-action" disabled={busy} onClick={()=>{
        if(committing.current)return;committing.current=true;setBusy(true);setFailed(false);intent.current??=crypto.randomUUID();const run=epoch.current;
        void reviewInspiration(item,profileId,item.memoryExcludedAt?'relevant':'not_relevant',intent.current).then(()=>{if(run===epoch.current){onChanged?.();setAttempt(v=>v+1);}})
          .catch(()=>{if(run===epoch.current){setFailed(true);setItem(null);}}).finally(()=>{committing.current=false;if(run===epoch.current)setBusy(false);});
      }}>{say(busy?'worldReviewAnswerSaving':item.memoryExcludedAt?'worldInspirationMakeRelevant':'worldInspirationNotRelevant')}</button></>:null}
    {failed?<p role="alert">{say('worldReviewAnswerFailed')} <button type="button" className="waka-inspiration-review-action" onClick={()=>setAttempt(v=>v+1)}>{say('worldRetry')}</button></p>:null}
  </div>;
}
