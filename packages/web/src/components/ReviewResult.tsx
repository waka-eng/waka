import {useEffect,useRef,useState} from 'react';
import {fetchReviewProcessing,retryReviewProcessing,fetchTopOfMindVersion,type ApiReviewProcessing,type ApiTopOfMind} from '../lib/api';
import {t,type SupportedLocale} from '../lib/locales';

async function timed<T>(work:(signal:AbortSignal)=>Promise<T>,parent:AbortSignal):Promise<T>{
  const request=new AbortController();let timer:number|undefined;
  const abort=()=>request.abort();parent.addEventListener('abort',abort,{once:true});
  try{return await Promise.race([work(request.signal),new Promise<never>((_,reject)=>{
    request.signal.addEventListener('abort',()=>reject(new Error('Review result request ended')),{once:true});
    timer=window.setTimeout(abort,15000);
  })]);}finally{window.clearTimeout(timer);parent.removeEventListener('abort',abort);request.abort();}
}
export function ReviewResult({profileId,id,revision,locale,onOpenPrinciple}:{profileId:string;id:string;revision:number;locale:SupportedLocale;onOpenPrinciple?:(id:string|null)=>void}){
  const [request,setRequest]=useState({serial:0,retry:false,owner:profileId,session:id}),[stored,setState]=useState<(ApiReviewProcessing&{observedRevision:number})|null>(null);
  const consumedRetry=useRef<number|null>(null);
  const state=stored?.profileId===profileId&&stored.sessionId===id&&stored.observedRevision===revision?stored:null;
  const [checking,setChecking]=useState(true),[failed,setFailed]=useState(false),[waiting,setWaiting]=useState(false);
  const [open,setOpen]=useState(false),[reading,setReading]=useState<ApiTopOfMind|null>(null),[readingError,setReadingError]=useState(false),[readAttempt,setReadAttempt]=useState(0);
  const say=(key:Parameters<typeof t>[1])=>t(locale,key);
  useEffect(()=>{
    const controller=new AbortController();let timer:number|undefined,polls=0,errors=0;
    setState(null);setChecking(true);setFailed(false);setWaiting(false);setOpen(false);setReading(null);
    const run=async(retry=false)=>{
      if(controller.signal.aborted||document.hidden)return;
      try{
        const next=await timed(signal=>retry?retryReviewProcessing(id,profileId,signal):fetchReviewProcessing(id,profileId,signal),controller.signal);
        if(controller.signal.aborted)return;setState({...next,observedRevision:revision});setChecking(false);setFailed(false);errors=0;
        if(next.phase==='pending'&&++polls<20){
          const until=next.runAfter?Date.parse(next.runAfter)-Date.now():0;
          timer=window.setTimeout(()=>void run(),Math.max(2000,Math.min(10000,until)));
        }else if(next.phase==='pending')setWaiting(true);
      }catch{
        if(controller.signal.aborted)return;
        // A lost retry response is observed with GET, never another POST.
        if(++errors<2)timer=window.setTimeout(()=>void run(),1000);
        else{setChecking(false);setFailed(true);setState(null);}
      }
    };
    const retry=request.retry&&request.owner===profileId&&request.session===id&&consumedRetry.current!==request.serial;
    if(retry)consumedRetry.current=request.serial;
    void run(retry);
    return()=>{controller.abort();window.clearTimeout(timer);};
  },[profileId,id,revision,request]);
  useEffect(()=>{
    const resume=()=>{if(!document.hidden)setRequest(current=>({...current,serial:current.serial+1,retry:false}));};
    window.addEventListener('focus',resume);document.addEventListener('visibilitychange',resume);
    return()=>{window.removeEventListener('focus',resume);document.removeEventListener('visibilitychange',resume);};
  },[]);
  const result=state?.phase==='ready'?state.result:null;
  useEffect(()=>{
    setReading(null);setReadingError(false);if(!open||!result?.topOfMindId)return;
    const controller=new AbortController(),expected=result;
    void timed(signal=>fetchTopOfMindVersion(expected.topOfMindId!,{profile:profileId},signal),controller.signal).then(next=>{
      if(controller.signal.aborted)return;
      if(!next||next.id!==expected.topOfMindId||next.version!==expected.version||next.profileId&&next.profileId!==profileId||!Array.isArray(next.entries)||!Number.isFinite(Date.parse(next.createdAt)))throw new Error('Reading identity changed');
      setReading(next);
    }).catch(()=>{if(!controller.signal.aborted)setReadingError(true);});
    return()=>controller.abort();
  },[open,result?.topOfMindId,result?.version,profileId,readAttempt]);
  if(state?.phase==='empty')return null;
  const message=checking?'worldReviewResultChecking':failed?'worldReviewResultCheckFailed':state?.phase==='pending'?(waiting?'worldReviewResultWaiting':'worldReviewResultPending'):
    state?.phase==='needs_context'?'worldReviewResultContext':state?.phase==='failed'?'worldReviewResultFailed':result?.outcome==='changed'?'worldReviewResultChanged':result?.outcome==='unchanged'?'worldReviewResultUnchanged':'worldReviewResultEmpty';
  return <section className="jar-review-result" aria-label={say('worldReviewResultTitle')}>
    <h3>{say('worldReviewResultTitle')}</h3><p role="status">{say(message)}</p>
    {state?.canRetry&&!checking?<button type="button" onClick={()=>setRequest(current=>({serial:current.serial+1,retry:true,owner:profileId,session:id}))}>{say('worldReviewResultResume')}</button>:null}
    {!checking&&(failed||waiting)?<button type="button" onClick={()=>setRequest(current=>({serial:current.serial+1,retry:false,owner:profileId,session:id}))}>{say('worldReviewCheckThoughts')}</button>:null}
    {result?.topOfMindId?<button type="button" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>{say(open?'worldReviewResultHide':'worldReviewResultOpen')}</button>:null}
    {open&&result?.topOfMindId?<div className="jar-review-reading">
      {readingError?<p role="alert">{say('worldReviewResultReadFailed')} <button type="button" onClick={()=>setReadAttempt(value=>value+1)}>{say('worldReviewCheckThoughts')}</button></p>:
        !reading?<p role="status">{say('worldReviewResultChecking')}</p>:<>
          <p className="jar-review-context">{new Date(reading.createdAt).toLocaleDateString(locale,{dateStyle:'medium'})}</p>
          {reading.supportChanged?<p>{say('worldReadingSupportChanged')}</p>:null}
          {reading.entries.length?reading.entries.map(entry=><p key={entry.id}>{entry.body}</p>):<p>{say('worldReviewResultEmpty')}</p>}
        </>}
    </div>:null}
    {state?.relatedPrinciples.length?<details><summary>{say('worldReviewResultRelated')}</summary><ul>{state.relatedPrinciples.map(principle=><li key={principle.id}>{onOpenPrinciple?<button type="button" onClick={()=>onOpenPrinciple(principle.id)}>{principle.statement}</button>:principle.statement}</li>)}</ul></details>:null}
    {onOpenPrinciple&&!checking?<button type="button" onClick={()=>onOpenPrinciple(null)}>{say('worldReviewPrinciples')}</button>:null}
  </section>;
}
