import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {fetchTopOfMindVersions,fetchTopOfMindVersion,type ApiTopOfMind} from '../lib/api';
import {t,type SupportedLocale} from '../lib/locales';
import {DialogSurface} from './DialogSurface';

/** Read the two actual stored artifacts around the displayed reading. */
export function ReadingChanges({profileId,readingId,locale}:{profileId:string;readingId:string;locale:SupportedLocale}){
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
  const text=(row:ApiTopOfMind)=>row.entries.map(entry=>`${entry.type}:${entry.body}`).join('\n');
  const unchanged=shown?.before&&!shown.before.supportChanged&&!shown.after.supportChanged&&shown.before.entries.length>0&&text(shown.before)===text(shown.after);
  const passage=(row:ApiTopOfMind,label:Parameters<typeof t>[1])=><section>
    <h3>{say(label)}</h3><p className="jar-review-context">{new Date(row.createdAt).toLocaleDateString(locale,{dateStyle:'medium'})}</p>
    {row.supportChanged?<p role="status">{say('worldReadingSupportChanged')}</p>:null}
    {row.entries.length?row.entries.map(entry=><p key={entry.id}>{entry.body}</p>):<p>{say('worldReadingEarlierUnavailable')}</p>}
  </section>;
  return <>
    <button ref={opener} type="button" onClick={()=>setOpen(true)}>{say('worldReadingChanges')}</button>
    {open?createPortal(<>
      <button type="button" className="jar-review-backdrop" tabIndex={-1} aria-hidden="true" onClick={()=>setOpen(false)}/>
      <DialogSurface className="jar-seek jar-reading-comparison" aria-label={say('worldReadingChanges')} onClose={()=>setOpen(false)} data-jar-chrome="1">
        <header><h2>{say('worldReadingChanges')}</h2><button type="button" onClick={()=>setOpen(false)}>{say('worldClose')}</button></header>
        {failed?<p role="alert">{say('worldReadingChangesFailed')} <button type="button" onClick={()=>setAttempt(value=>value+1)}>{say('worldRoomHistoryRetry')}</button></p>:
          !shown?<p role="status">{say('worldReviewResultChecking')}</p>:<>
            {unchanged?<p>{say('worldReviewResultUnchanged')}</p>:null}
            {shown.before?passage(shown.before,'worldReadingBefore'): <p>{say(shown.after.version===1?'worldReadingFirst':'worldReadingEarlierUnavailable')}</p>}
            {passage(shown.after,'worldReadingAfter')}
          </>}
      </DialogSurface>
    </>,opener.current?.closest('.jar')??document.body):null}
  </>;
}
