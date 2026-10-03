import {useEffect,useRef,useState} from 'react';
import {ApiError,fetchInspiration,fetchInspirationPage,fetchReviewSession,type ApiInspiration,type ApiInspirationSummary,type ApiReviewItem} from '../lib/api';
import {useReviewSession} from '../lib/use-review-session';
import type {ProfileStorageScope} from '../lib/profile-storage';
import {t,type SupportedLocale} from '../lib/locales';
import {inspirationPreview} from '../lib/inspiration-preview';
import {toInspirationDetail} from '../lib/data';
import {DialogSurface} from './DialogSurface';
import {InspirationAttachments} from './InspirationAttachments';
import {InspirationSearch} from './InspirationSearch';
import {ReviewDialogue} from './ReviewDialogue';

function ReviewChosenItem({id,profileId,locale,onOpen,onMissing}:{id:string;profileId:string;locale:SupportedLocale;onOpen:(id:string)=>void;onMissing:()=>void}){
  const [label,setLabel]=useState(t(locale,'worldReviewChecking'));
  useEffect(()=>{const controller=new AbortController();const timer=window.setTimeout(()=>{setLabel(t(locale,'worldReviewSourceUnavailable'));controller.abort();},15000);
    void fetchInspiration(id,{profile:profileId},controller.signal).then(row=>{
      if(controller.signal.aborted)return;if(row.id!==id||row.profileId!==profileId)throw new Error('Source owner changed');
      const preview=toInspirationDetail(row).preview;setLabel(preview.length>180?`${preview.slice(0,177)}…`:preview);
    }).catch(reason=>{if(!controller.signal.aborted){setLabel(t(locale,'worldReviewSourceUnavailable'));if(reason instanceof ApiError&&reason.status===404)onMissing();}})
      .finally(()=>window.clearTimeout(timer));return()=>{controller.abort();window.clearTimeout(timer);};},[id,profileId,locale]);
  return <li><button type="button" aria-label={`${t(locale,'worldReviewOpen')}: ${label}`} onClick={()=>onOpen(id)}>{label}</button></li>;
}

function ReviewCard({item,sessionId,profileId,locale,disabled,onChoice,onRefresh,onReady,onOpen}:{
  item:ApiReviewItem;sessionId:string;profileId:string;locale:SupportedLocale;disabled:boolean;
  onChoice:(choice:'keep'|'skip')=>void;onRefresh:()=>void;onReady:(key:string|null)=>void;onOpen:(id:string)=>void;
}){
  const [read,setRead]=useState<{id:string;revision:string;source:ApiInspiration}|null>(null),[failed,setFailed]=useState(false);
  const root=useRef<HTMLDivElement>(null),swipe=useRef<{x:number;y:number;pointerId:number}|null>(null);
  useEffect(()=>{
    const controller=new AbortController();setRead(null);setFailed(false);
    const timer=window.setTimeout(()=>{setFailed(true);controller.abort();},15000);
    void (async()=>{
      try{
        const source=await fetchInspiration(item.inspirationId,{profile:profileId},controller.signal);
        const latest=await fetchReviewSession(sessionId,profileId,controller.signal);
        if(controller.signal.aborted)return;
        const current=latest?.items.find(row=>row.inspirationId===item.inspirationId);
        if(source.id!==item.inspirationId||source.profileId!==profileId||!current||current.currentRevision!==item.currentRevision){setFailed(true);onRefresh();return;}
        setRead({id:source.id,revision:current.currentRevision,source});
      }catch(reason){if(!controller.signal.aborted){setFailed(true);if(reason instanceof ApiError&&reason.status===404)onRefresh();}}
      finally{window.clearTimeout(timer);}
    })();
    return ()=>{controller.abort();window.clearTimeout(timer);};
  },[item.inspirationId,item.currentRevision,sessionId,profileId]);
  const source=read?.id===item.inspirationId&&read.revision===item.currentRevision?read.source:null;
  useEffect(()=>{onReady(source&&!failed?`${item.inspirationId}:${item.currentRevision}`:null);},[source,failed,item.inspirationId,item.currentRevision,onReady]);
  useEffect(()=>{if(source)root.current?.focus({preventScroll:true});},[source?.id]);
  const interactive=(target:EventTarget|null)=>target instanceof Element&&Boolean(target.closest('button,a,input,textarea,audio,summary'));
  return <div className="jar-review-card" ref={root} tabIndex={0} aria-label={t(locale,'worldReviewTitle')}
    onKeyDown={event=>{if(disabled||!source||interactive(event.target)||event.repeat)return;if(event.key==='ArrowRight'||event.key==='ArrowLeft'){event.preventDefault();event.stopPropagation();onChoice(event.key==='ArrowRight'?'keep':'skip');}}}
    onPointerDown={event=>{if(event.isPrimary===false){swipe.current=null;return;}if(event.pointerType==='touch'&&!disabled&&source&&!interactive(event.target))swipe.current={x:event.clientX,y:event.clientY,pointerId:event.pointerId};}}
    onPointerCancel={()=>{swipe.current=null;}}
    onPointerUp={event=>{const start=swipe.current;swipe.current=null;if(!start||start.pointerId!==event.pointerId||disabled||!source)return;const dx=event.clientX-start.x,dy=event.clientY-start.y;if(Math.abs(dx)>=60&&Math.abs(dy)<Math.abs(dx)*.6){event.preventDefault();event.stopPropagation();onChoice(dx>0?'keep':'skip');}}}>
    <div className="jar-review-card-heading"><p className="jar-review-context">{t(locale,item.reason==='unreviewed'?'worldReviewUnreviewed':item.reason==='chosen'?'worldReviewChosen':'worldReviewRevisit')} · {new Intl.DateTimeFormat(locale,{dateStyle:'medium'}).format(new Date(item.inspirationCreatedAt))}</p><button type="button" disabled={disabled||!source} aria-label={t(locale,'worldReviewOpen')} title={t(locale,'worldReviewOpen')} onClick={()=>onOpen(item.inspirationId)}>↗</button></div>
    {item.sourceChanged?<p role="status">{t(locale,'worldReviewChanged')}</p>:null}
    {failed?<p role="alert">{t(locale,'worldReviewSourceUnavailable')} <button type="button" onClick={onRefresh}>{t(locale,'worldRoomHistoryRetry')}</button></p>
      :!source?<p role="status">{t(locale,'worldReviewChecking')}</p>:<>
        <p className="jar-review-text">{toInspirationDetail(source).preview}</p>
        {source.attachments.length?<InspirationAttachments items={toInspirationDetail(source).attachments} locale={locale} readOnly/>:null}
        {source.reflections.some(row=>!row.skipped&&row.answer)?<details><summary>{t(locale,'worldReflectionHistory')}</summary>{source.reflections.filter(row=>!row.skipped&&row.answer).map(row=><p key={row.id}>{row.answer}</p>)}</details>:null}
      </>}
  </div>;
}

export function ReviewPanel({scope,id,locale,onId,onClose,onNewInspiration,onOpen}:{scope:ProfileStorageScope;id:string;locale:SupportedLocale;
  onId:(id:string)=>void;onClose:()=>void;onNewInspiration:()=>void;onOpen:(id:string)=>void;
}){
  const review=useReviewSession(scope,id,onId),[picker,setPicker]=useState(false),[query,setQuery]=useState('');
  const [selected,setSelected]=useState<ApiInspirationSummary[]>([]),[count,setCount]=useState<number|null>(null);
  const [readySource,setReadySource]=useState<string|null>(null);
  const [hasDialogueDraft,setHasDialogueDraft]=useState(false);
  const session=review.session,items=session?.items??[],item=items.find(row=>row.inspirationId===session?.currentInspirationId);
  const last=items.filter(row=>row.position<(session?.cursor??0)&&row.choice!==null).at(-1);
  const disabled=review.busy||Boolean(review.pending)||review.loading;
  const dates=items.map(row=>Date.parse(row.inspirationCreatedAt)).sort((a,b)=>a-b);
  const formatDate=(value:number)=>new Intl.DateTimeFormat(locale,{dateStyle:'medium'}).format(new Date(value));
  useEffect(()=>{const controller=new AbortController();void fetchInspirationPage({profile:scope.profileId,limit:1},controller.signal).then(page=>{if(!controller.signal.aborted)setCount(page.total??page.inspirations.length);}).catch(()=>{});return()=>controller.abort();},[scope.profileId]);
  const say=(key:Parameters<typeof t>[1])=>t(locale,key);
  return <>
    <button className="jar-review-backdrop" type="button" tabIndex={-1} aria-hidden="true" onClick={()=>picker?setPicker(false):onClose()}/>
    <DialogSurface className="jar-seek jar-review" aria-label={say('worldReviewTitle')} active={!picker} onClose={onClose} data-jar-chrome="1">
      <header><h2>{say('worldReviewTitle')}</h2><button type="button" onClick={onClose}>{say('worldClose')}</button></header>
      <div className="jar-review-body">
        {review.loading?<p role="status">{say('worldReviewChecking')}</p>:null}
        {review.error?<div role="alert"><p>{say(review.error==='storage'?'worldReviewStorage':review.error==='conflict'?'worldReviewConflict':review.error==='load'?'worldReviewLoadFailed':'worldReviewSaveFailed')}</p>
          {review.error==='storage'?<button type="button" onClick={review.recoverStorage}>{say('worldReviewReset')}</button>:!review.pending?<button type="button" disabled={review.busy} onClick={review.retry}>{say('worldRoomHistoryRetry')}</button>:null}
        </div>:null}
        {review.pending&&!review.busy?<div role="status">{!review.error?<p>{say('worldReviewPending')}</p>:null}{review.error!=='conflict'?<button type="button" onClick={review.retry}>{say('worldRoomHistoryRetry')}</button>:null}<button type="button" onClick={()=>void review.useLatest()}>{say('worldReviewUseLatest')}</button></div>:null}
        {!session&&!review.loading&&!review.pending&&!review.error?<>
          {review.empty||count===0?<><p>{say('worldReviewEmpty')}</p><button type="button" onClick={onNewInspiration}>{say('worldCaptureInspiration')}</button></>:<>
            <p>{say('worldReviewIntro')}</p><p>{say('worldReviewPickHint')}</p>
            {selected.length?<ul>{selected.map(row=><li key={row.id}>{inspirationPreview(row.textPreview,row.attachmentSummary)} <button type="button" aria-label={`${say('worldRemoveLower')} ${inspirationPreview(row.textPreview,row.attachmentSummary)}`} onClick={()=>setSelected(current=>current.filter(item=>item.id!==row.id))}>×</button></li>)}</ul>:null}
            <button type="button" disabled={selected.length>=5} onClick={()=>setPicker(true)}>{say('worldReviewChoose')}{selected.length?` (${selected.length}/5)`:''}</button>
            <button type="button" onClick={()=>review.start(selected.length?selected.map(row=>row.id):undefined)}>{say('worldReviewStart')}</button>
          </>}
        </>:null}
        {session&&!review.loading?<>
          {dates.length>1&&formatDate(dates[0]!)!==formatDate(dates.at(-1)!)?<p className="jar-review-context">{formatDate(dates[0]!)} – {formatDate(dates.at(-1)!)}</p>:null}
          {!session.completedAt&&item?<><p role="status">{items.indexOf(item)+1} / {items.length}</p>
            <ReviewCard key={`${item.inspirationId}:${item.currentRevision}`} item={item} sessionId={session.id} profileId={scope.profileId} locale={locale} disabled={disabled} onChoice={choice=>review.choose(item,choice)} onRefresh={()=>void review.refresh()} onReady={setReadySource} onOpen={onOpen}/>
            <p className="jar-review-context">{say('worldReviewHint')}</p>
          </>:<>{session.completedAt?<h3>{say('worldReviewDone')}</h3>:null}{items.some(row=>row.choice==='keep')?<details><summary>{say('worldReviewSelected')} ({items.filter(row=>row.choice==='keep').length})</summary><ul>{items.filter(row=>row.choice==='keep').map(row=><ReviewChosenItem key={row.inspirationId} id={row.inspirationId} profileId={scope.profileId} locale={locale} onOpen={onOpen} onMissing={()=>void review.refresh()}/>)}</ul></details>:<p>{say('worldReviewNone')}</p>}</>}
          {!item||session.completedAt?<ReviewDialogue key={`${scope.accountId}:${scope.profileId}:${session.id}`} scope={scope} id={session.id} completed={Boolean(session.completedAt)} locale={locale} onOpen={onOpen} onRevision={review.observeRevision} onDraftChange={setHasDialogueDraft}/>:null}
        </>:null}
      </div>
      {session&&!session.completedAt?<footer>
        {item?<div className="jar-review-choices"><button type="button" disabled={disabled||readySource!==`${item.inspirationId}:${item.currentRevision}`} onClick={()=>review.choose(item,'skip')}>{say('worldReviewSkip')}</button><button type="button" disabled={disabled||readySource!==`${item.inspirationId}:${item.currentRevision}`} onClick={()=>review.choose(item,'keep')}>{say('worldReviewKeep')}</button></div>:null}
        <div className="jar-review-footer-actions">{last?<button type="button" disabled={disabled||hasDialogueDraft} onClick={()=>review.choose(last,null)}>{say('worldReviewUndo')}</button>:null}<button type="button" disabled={disabled||hasDialogueDraft} onClick={review.finish}>{say('worldReviewFinish')}</button></div>
        {review.busy?<span role="status">{say('worldKeeping')}</span>:null}</footer>:null}
    </DialogSurface>
    {picker?<InspirationSearch profileId={scope.profileId} locale={locale} query={query} onQuery={setQuery} onClose={()=>setPicker(false)} onPick={row=>{setSelected(current=>current.some(item=>item.id===row.id)?current:current.length<5?[...current,row]:current);setPicker(false);setQuery('');}}/>:null}
  </>;
}
