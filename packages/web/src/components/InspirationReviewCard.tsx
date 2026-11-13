import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../lib/api/http';
import { readInspirationRelevance, reviewInspiration, type InspirationRelevance, type RelevanceChoice } from '../lib/api/inspiration-relevance';
import { t, type SupportedLocale } from '../lib/locales';
import { dateStamp } from '../lib/words';
import { createPortal } from 'react-dom';
import { ClaimSlip } from './ClaimSlip';
import { DialogSurface } from './DialogSurface';
import { SurfaceHeader } from './SurfaceHeader';

/** A check of the original, visually and semantically separate from a signal verdict. */
export function InspirationReviewCard({item:initial,profileId,locale,more,onDone,onChanged,onChat}: {
  item:InspirationRelevance;profileId:string;locale:SupportedLocale;more:boolean;
  onDone:()=>void;onChanged:(choice:RelevanceChoice)=>void | Promise<void>;
  /** "Chat about this": a chat that opens on this same question, the
      inspiration quoted (founder, 2026-11-12). */
  onChat:(question:string,text:string)=>void;
}) {
  const [item,setItem]=useState(initial),[busy,setBusy]=useState(false),[changed,setChanged]=useState(false),[failed,setFailed]=useState(false);
  /* ═══ OPEN READS IT WHOLE, OVER THE REVIEW (founder, 2026-11-12) ═══════
     "It needs to open without disturbing the workflow and be easily
     closeable." Open used to leave the review for the archive. Now it lays
     the whole inspiration on a page over the card; "<" (or Escape) puts it
     away onto the same card, and its own foot answers Not really or Yes. */
  const [reading,setReading]=useState(false);
  const stopSlip=(event:{stopPropagation:()=>void})=>event.stopPropagation();
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
    onAnswer={choice=>answer(choice==='keep'?'relevant':'not_relevant')} onLeft={onDone}
    middle={<button type="button" className="jar-pick-act jar-pick-act--chat" disabled={busy}
      onClick={()=>onChat(say('worldInspirationReviewQuestion'),item.text||item.attachmentLabel||say('worldSavedWord'))}>{say('worldTalkAboutThis')}</button>}>
    <p className="waka-inspiration-review-question">{say('worldInspirationReviewQuestion')}</p>
    <p className="jar-pick-source">{say('worldInspirationReviewOriginal')} · {dateStamp(new Date(item.createdAt).getTime(),locale)}</p>
    <blockquote className="jar-pick-statement waka-inspiration-review-text">{item.text || item.attachmentLabel || say('worldSavedWord')}</blockquote>
    {item.text&&item.attachmentLabel?<p className="jar-pick-source">{item.attachmentLabel}</p>:null}
    {/* "NOT NOW" WENT (founder, 2026-11-12: "what's the purpose of not
        now?"). Open reads the whole inspiration without leaving; the row
        under the card answers: Not really, Chat about this, Yes. A card that
        changed elsewhere offers Read it again instead. */}
    {changed?<button type="button" className="waka-inspiration-review-action" disabled={busy} onClick={()=>{
      setBusy(true);void readInspirationRelevance(item.id,profileId).then(fresh=>{if(!alive.current)return;setItem(fresh);setChanged(false);setFailed(false);intent.current=null;}).catch(()=>{if(alive.current)setFailed(true);}).finally(()=>{if(alive.current)setBusy(false);});
    }}>{say('worldInspirationReviewReload')}</button>:<button type="button" className="waka-inspiration-review-action" onClick={()=>setReading(true)}>{say('worldInspirationReviewOpen')}</button>}
    {reading?createPortal(<DialogSurface className="waka-review-reader" modal={false} aria-label={say('worldInspirationReviewQuestion')} onClose={()=>setReading(false)}
      /* Portalled, but still the slip's React child: a drag or a text
         selection here must never reach the slip and answer the card (code
         review, 2026-11-12). */
      onPointerDown={stopSlip} onPointerMove={stopSlip} onPointerUp={stopSlip} onPointerCancel={stopSlip}>
      <SurfaceHeader locale={locale} back={{kind:'back',onBack:()=>setReading(false)}} title={`${say('worldInspirationReviewOriginal')} · ${dateStamp(new Date(item.createdAt).getTime(),locale)}`}/>
      <div className="waka-review-reader-page">
        <p className="waka-review-reader-text">{item.text || item.attachmentLabel || say('worldSavedWord')}</p>
        {item.text&&item.attachmentLabel?<p className="jar-pick-source">{item.attachmentLabel}</p>:null}
      </div>
      <div className="waka-review-reader-foot">
        <p className="waka-review-reader-ask">{say('worldInspirationReviewQuestion')}</p>
        <p className="jar-pick-acts">
          <button type="button" className="jar-pick-act jar-pick-act--not" disabled={busy||changed} onClick={()=>{void answer('not_relevant').then(ok=>{if(ok&&alive.current){setReading(false);onDone();}});}}><span>{say('worldInspirationNotRelevant')}</span></button>
          <button type="button" className="jar-pick-act jar-pick-act--keep" disabled={busy||changed} onClick={()=>{void answer('relevant').then(ok=>{if(ok&&alive.current){setReading(false);onDone();}});}}><span>{say('worldInspirationStillRelevant')}</span></button>
        </p>
        {failed?<p className="jar-pick-source" role="alert">{say(changed?'worldInspirationReviewChanged':'worldReviewAnswerFailed')}</p>:null}
      </div>
    </DialogSurface>,document.body):null}
    {failed?<p role="alert">{say(changed?'worldInspirationReviewChanged':'worldReviewAnswerFailed')}</p>:null}
  </ClaimSlip>;
}
