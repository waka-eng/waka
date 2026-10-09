import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {fetchTopOfMindVersions,fetchTopOfMindVersion,type ApiTopOfMind} from '../lib/api';
import {t,type SupportedLocale} from '../lib/locales';
import {DialogSurface} from './DialogSurface';
import {driftWords} from '../lib/drift';

/** Read the two actual stored artifacts around the displayed reading. */
export function ReadingChanges({profileId,readingId,locale,compact=false}:{profileId:string;readingId:string;locale:SupportedLocale;compact?:boolean}){
  const [open,setOpen]=useState(false),[attempt,setAttempt]=useState(0),[failed,setFailed]=useState(false);
  const opener=useRef<HTMLButtonElement>(null);
  const [pair,setPair]=useState<{profileId:string;id:string;before:ApiTopOfMind|null;after:ApiTopOfMind}|null>(null);
  useEffect(()=>{
    if(!open)return;
    const controller=new AbortController();setPair(null);setFailed(false);
    const timer=window.setTimeout(()=>{controller.abort();setFailed(true);},15000);
    void (async()=>{
      const [list,after]=await Promise.all([fetchTopOfMindVersions({profile:profileId},controller.signal),fetchTopOfMindVersion(readingId,{profile:profileId},controller.signal)]);
      if(controller.signal.aborted)return;
      if(after.id!==readingId||after.profileId&&after.profileId!==profileId)throw new Error('Reading owner changed');
      const previous=list.filter(row=>row.version<after.version).sort((a,b)=>b.version-a.version)[0];
      const before=previous?await fetchTopOfMindVersion(previous.id,{profile:profileId},controller.signal):null;
      if(controller.signal.aborted)return;
      if(before&&(before.id!==previous!.id||before.version!==previous!.version||before.profileId&&before.profileId!==profileId))throw new Error('Earlier reading owner changed');
      setPair({profileId,id:readingId,before,after});
    })().catch(()=>{if(!controller.signal.aborted)setFailed(true);}).finally(()=>window.clearTimeout(timer));
    return()=>{controller.abort();window.clearTimeout(timer);};
  },[profileId,readingId,open,attempt]);
  const shown=pair?.profileId===profileId&&pair.id===readingId?pair:null;
  const say=(key:Parameters<typeof t>[1])=>t(locale,key);
  const text=(row:ApiTopOfMind)=>row.entries.map(entry=>entry.body).join(' ');
  /**
   * ONE PASSAGE, NOT TWO.
   *
   * This was two full readings stacked in a modal, each several paragraphs
   * long, and the reader's job was to read both and find the difference
   * themselves. Founder: "I obviously want to keep it somewhere but not in
   * this format."
   *
   * The product already answered this question about this exact material. The
   * poster's own note: words that survived a rewrite stay lit and still, only
   * new words arrive, "the spine is the still text, the drift is the
   * flicker". So the current reading is printed once, the words it introduced
   * carry the light, and the words it carried over stay quiet — the
   * difference shown in the only channel this product has.
   *
   * What the rewrite dropped is printed beneath, faded, because fading never
   * deletes and a comparison that omits its removals can only flatter the new
   * version.
   */
  const drift=shown?driftWords(shown.before?text(shown.before):null,text(shown.after)):null;
  return <>
    <button ref={opener} className={compact?'jar-reading-changes':undefined} type="button" onClick={()=>setOpen(true)}>{say(compact?'worldReadingChangesShort':'worldReadingChanges')}</button>
    {open?createPortal(<>
      <button type="button" className="jar-review-backdrop" tabIndex={-1} aria-hidden="true" onClick={()=>setOpen(false)}/>
      <DialogSurface className="jar-seek jar-reading-comparison" aria-label={say('worldReadingChanges')} onClose={()=>setOpen(false)} data-jar-chrome="1">
        <header><h2>{say('worldReadingChanges')}</h2><button type="button" onClick={()=>setOpen(false)}>{say('worldClose')}</button></header>
        {failed?<p role="alert">{say('worldReadingChangesFailed')} <button type="button" onClick={()=>setAttempt(value=>value+1)}>{say('worldRoomHistoryRetry')}</button></p>:
          !shown||!drift?<p role="status">{say('worldReviewResultChecking')}</p>:<>
            {!shown.before?<p className="jar-drift-note">{say(shown.after.version===1?'worldReadingFirst':'worldReadingEarlierUnavailable')}</p>:
              drift.same?<p className="jar-drift-note">{say('worldReviewResultUnchanged')}</p>:null}
            {shown.after.supportChanged?<p className="jar-drift-note" role="status">{say('worldReadingSupportChanged')}</p>:null}
            {/* The reading as it stands, with what is new carrying the light. */}
            <p className="jar-drift-reading">
              {drift.words.map((word,index)=>
                <span key={`${index}-${word.text}`} className={word.arrived?'jar-drift-new':undefined}>{word.text}{index<drift.words.length-1?' ':''}</span>)}
            </p>
            {/* AND WHAT LEFT. Faded, never omitted. */}
            {drift.left.length?<p className="jar-drift-left">
              <span className="jar-drift-left-label jar-label">{say('worldReadingDropped')}</span>
              {drift.left.join(' · ')}
            </p>:null}
          </>}
      </DialogSurface>
    </>,opener.current?.closest('.jar')??document.body):null}
  </>;
}
