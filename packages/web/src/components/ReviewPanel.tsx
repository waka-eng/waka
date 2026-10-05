import {useEffect,useRef,useState} from 'react';
import {ApiError,deleteInspiration,fetchInspiration,fetchInspirationPage,fetchReviewSession,type ApiInspiration,type ApiReflection,type ApiReviewItem} from '../lib/api';
import {useReviewSession} from '../lib/use-review-session';
import type {ProfileStorageScope} from '../lib/profile-storage';
import {profileStorageKey} from '../lib/profile-storage';
import {readReflectionDraft} from '../lib/authored-save-drafts';
import {t,type SupportedLocale} from '../lib/locales';
import {toInspirationDetail} from '../lib/data';
import {DialogSurface} from './DialogSurface';
import {InspirationAttachments} from './InspirationAttachments';
import {ReflectionFlow} from './ReflectionFlow';
import {ReviewDialogue} from './ReviewDialogue';
import {ReviewResult} from './ReviewResult';

function ReviewCard({item,sessionId,initialSource,scope,locale,disabled,onNext,onRefresh,onDeleted,onSaved,onSynchronized,onReflectionRemoved,onOpen}:{
  item:ApiReviewItem;sessionId:string;scope:ProfileStorageScope;locale:SupportedLocale;disabled:boolean;
  initialSource?:ApiInspiration|null;
  onNext:(reflected:boolean)=>void;onRefresh:()=>void;onDeleted:(id:string)=>void;onOpen:(id:string)=>void;
  onSaved?:(row:ApiReflection)=>void;onSynchronized?:(id:string,row:ApiInspiration|null)=>void;onReflectionRemoved?:(id:string,owner:string)=>void;
}){
  const validInitial=initialSource?.id===item.inspirationId&&initialSource.profileId===scope.profileId&&initialSource.materialRevision===item.currentRevision?initialSource:null;
  const [source,setSource]=useState<ApiInspiration|null>(validInitial),[failed,setFailed]=useState(false),[attempt,setAttempt]=useState(0);
  const [reflecting,setReflecting]=useState(()=>Boolean(readReflectionDraft(profileStorageKey(scope,`reflectionDraft:${item.inspirationId}`))?.answer));
  const [confirm,setConfirm]=useState(false),[removing,setRemoving]=useState(false),[removeError,setRemoveError]=useState(false);
  const alive=useRef(true),working=useRef(false),deletion=useRef<AbortController|null>(null),root=useRef<HTMLDivElement>(null),keep=useRef<HTMLButtonElement>(null);
  const say=(key:Parameters<typeof t>[1])=>t(locale,key);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;deletion.current?.abort();};},[]);
  useEffect(()=>{
    if(attempt===0&&validInitial){setSource(validInitial);setFailed(false);return;}
    const controller=new AbortController();setSource(null);setFailed(false);
    const timer=window.setTimeout(()=>{setFailed(true);controller.abort();},15000);
    void (async()=>{
      try{
        const original=await fetchInspiration(item.inspirationId,{profile:scope.profileId},controller.signal);
        const latest=await fetchReviewSession(sessionId,scope.profileId,controller.signal);
        if(controller.signal.aborted)return;
        const current=latest?.items.find(row=>row.inspirationId===item.inspirationId);
        if(original.id!==item.inspirationId||original.profileId!==scope.profileId||!current||current.currentRevision!==item.currentRevision){setFailed(true);onRefresh();return;}
        setSource(original);
      }catch(reason){if(!controller.signal.aborted){setFailed(true);if(reason instanceof ApiError&&reason.status===404)onRefresh();}}
      finally{window.clearTimeout(timer);}
    })();
    return()=>{controller.abort();window.clearTimeout(timer);};
  },[item.inspirationId,item.currentRevision,sessionId,scope.profileId,attempt]);
  useEffect(()=>{if(source&&!reflecting)root.current?.focus({preventScroll:true});},[Boolean(source),reflecting]);
  useEffect(()=>{if(confirm)keep.current?.focus({preventScroll:true});},[confirm]);
  const refreshed=()=>{setSource(null);setAttempt(value=>value+1);onRefresh();};
  const removed=()=>{if(!alive.current)return;setSource(null);onDeleted(item.inspirationId);};
  const remove=async()=>{
    if(!confirm||disabled||!source||working.current)return;
    working.current=true;setRemoving(true);setRemoveError(false);
    const controller=new AbortController();deletion.current=controller;
    const timer=window.setTimeout(()=>controller.abort(),15000);
    try{
      await deleteInspiration(item.inspirationId,{profile:scope.profileId,sourceRevision:item.currentRevision,signal:controller.signal});
      removed();
    }catch(reason){
      if(!alive.current)return;
      if(reason instanceof ApiError&&reason.status===404){removed();return;}
      if(reason instanceof ApiError&&reason.status===409){setConfirm(false);refreshed();return;}
      // A lost DELETE response is checked with an owned GET, never silently
      // retried. A second click still carries the original revision fence.
      const check=new AbortController();deletion.current=check;
      const checkTimer=window.setTimeout(()=>check.abort(),15000);
      try{await fetchInspiration(item.inspirationId,{profile:scope.profileId},check.signal);if(alive.current)setRemoveError(true);}
      catch(error){if(alive.current){if(error instanceof ApiError&&error.status===404)removed();else setRemoveError(true);}}
      finally{window.clearTimeout(checkTimer);}
    }finally{window.clearTimeout(timer);working.current=false;if(alive.current)setRemoving(false);}
  };
  const detail=source?toInspirationDetail(source):null;
  const turns=source?.reflections.filter(row=>!row.skipped&&row.answer).map(row=>({id:row.id,question:row.question,answer:row.answer!}))??[];
  return <div className="jar-review-card" ref={root} tabIndex={-1}>
    <div className="jar-review-card-heading"><p className="jar-review-context">{say(turns.length?'worldReflected':item.reason==='unreviewed'?'worldReviewUnreviewed':'worldReviewRevisit')} · {new Intl.DateTimeFormat(locale,{dateStyle:'medium'}).format(new Date(item.inspirationCreatedAt))}</p>
      <button type="button" disabled={disabled||!source||removing} aria-label={say('worldReviewOpen')} title={say('worldReviewOpen')} onClick={()=>onOpen(item.inspirationId)}>↗</button></div>
    {item.sourceChanged?<p role="status">{say('worldReviewChanged')}</p>:null}
    {failed?<p role="alert">{say('worldReviewSourceUnavailable')} <button type="button" onClick={refreshed}>{say('worldRoomHistoryRetry')}</button></p>
      :!source?<p role="status">{say('worldReviewChecking')}</p>:<>
        <p className="jar-review-text">{detail!.preview}</p>
        {source.attachments.length?<InspirationAttachments items={detail!.attachments} locale={locale} readOnly/>:null}
        {reflecting?<ReflectionFlow inspirationId={source.id} scope={scope} initialTurns={turns} locale={locale}
          doneLabel={say('worldReviewBackToInspiration')} saveAndDoneLabel={say('worldReviewKeepAndReturn')}
          onSaved={row=>onSaved?.(row)} onRemoved={id=>onReflectionRemoved?.(id,source.id)}
          onSynchronized={row=>{if(row?.id===source.id&&row.profileId===scope.profileId)setSource(row);onSynchronized?.(source.id,row);}}
          onDone={()=>{setReflecting(false);refreshed();}}/>:<>
          {turns.length?<details className="jar-review-item-thoughts"><summary>{say('worldReflectionHistory')} ({turns.length})</summary>{turns.map(row=><div key={row.id}><p className="jar-review-context">{row.question}</p><p className="jar-review-answer">{row.answer}</p></div>)}</details>:null}
          {confirm?<div className="jar-review-delete" role="group" aria-label={say('worldReviewRemoveConfirmTitle')}>
            <h3>{say('worldReviewRemoveConfirmTitle')}</h3><p>{say('worldReviewRemoveConfirm')}</p>
            {removeError?<p role="alert">{say('worldReviewRemoveUnconfirmed')}</p>:null}
            <div className="jar-review-delete-actions"><button ref={keep} type="button" disabled={removing} onClick={()=>{setConfirm(false);setRemoveError(false);}}>{say('worldReviewKeepInspiration')}</button>
              <button type="button" className="jar-review-destructive" disabled={disabled||removing} onClick={()=>void remove()}>{say(removing?'worldReviewRemoving':'worldReviewDeleteInspiration')}</button></div>
          </div>:<div className="jar-review-item-actions">
            <button type="button" className="jar-review-primary" disabled={disabled} onClick={()=>setReflecting(true)}>{say('worldReflect')}</button>
            <button type="button" disabled={disabled} onClick={()=>onNext(turns.length>0)}>{say('worldReviewNextInspiration')} →</button>
            <button type="button" className="jar-review-remove" disabled={disabled} onClick={()=>setConfirm(true)}>{say('worldReviewRemoveInspiration')}</button>
          </div>}
        </>}
      </>}
  </div>;
}

export function ReviewPanel({scope,id,thoughtId=null,locale,onId,onClose,onNewInspiration,onOpen,onOpenPrinciple,onSaved,onSynchronized,onReflectionRemoved,onInspirationRemoved}:{scope:ProfileStorageScope;id:string;thoughtId?:string|null;locale:SupportedLocale;
  onId:(id:string)=>void;onClose:()=>void;onNewInspiration:()=>void;onOpen:(id:string)=>void;onOpenPrinciple?:(id:string|null)=>void;
  onSaved?:(row:ApiReflection)=>void;onSynchronized?:(id:string,row:ApiInspiration|null)=>void;onReflectionRemoved?:(id:string,owner:string)=>void;onInspirationRemoved?:(id:string)=>void;
}){
  const review=useReviewSession(scope,id,onId,true),[count,setCount]=useState<number|null>(null),[advance,setAdvance]=useState(false);
  const started=useRef(false),forwarded=useRef(false);
  const session=review.session,item=session?.items.find(row=>row.inspirationId===session.currentInspirationId);
  const disabled=review.busy||Boolean(review.pending)||review.loading;
  const say=(key:Parameters<typeof t>[1])=>t(locale,key);
  useEffect(()=>{if(id==='new'){started.current=false;forwarded.current=false;setAdvance(false);}},[id]);
  useEffect(()=>{if(!review.empty||review.hasInspirations!==null||count!==null)return;const controller=new AbortController();void fetchInspirationPage({profile:scope.profileId,limit:1},controller.signal).then(page=>{if(!controller.signal.aborted)setCount(page.total??page.inspirations.length);}).catch(()=>{});return()=>controller.abort();},[scope.profileId,review.empty,review.hasInspirations,count]);
  // Clicking Review is the start action. Home's entry read still creates no
  // session/model work. The durable start journal handles uncertain outcomes.
  useEffect(()=>{
    if(id==='new'&&!started.current&&!session&&!disabled&&!review.error&&!review.empty){started.current=true;review.start();}
  },[id,session,disabled,review.error,review.empty]);
  useEffect(()=>{
    if(id==='new'||!advance||!session||item||disabled||review.error)return;
    if(!session.completedAt)review.finish();
    else if(!forwarded.current){forwarded.current=true;onId('new');}
  },[id,advance,session,item,disabled,review.error]);
  return <>
    <button className="jar-review-backdrop" type="button" tabIndex={-1} aria-hidden="true" onClick={onClose}/>
    <DialogSurface className="jar-seek jar-review jar-review-single" aria-label={say('worldReviewOneTitle')} onClose={onClose} data-jar-chrome="1">
      <header><h2>{say('worldReviewOneTitle')}</h2><button type="button" onClick={onClose}>{say('worldReflectionDone')}</button></header>
      <div className="jar-review-body">
        {review.loading||review.busy?<p role="status">{say('worldReviewChecking')}</p>:null}
        {review.error?<div role="alert"><p>{say(review.error==='storage'?'worldReviewStorage':review.error==='conflict'?'worldReviewConflict':review.error==='load'?'worldReviewLoadFailed':'worldReviewSaveFailed')}</p>
          {review.error==='storage'?<button type="button" onClick={review.recoverStorage}>{say('worldReviewReset')}</button>:!review.pending?<button type="button" disabled={review.busy} onClick={review.retry}>{say('worldRoomHistoryRetry')}</button>:null}
        </div>:null}
        {review.pending&&!review.busy?<div role="status">{!review.error?<p>{say('worldReviewPending')}</p>:null}{review.error!=='conflict'?<button type="button" onClick={review.retry}>{say('worldRoomHistoryRetry')}</button>:null}<button type="button" onClick={()=>void review.useLatest()}>{say('worldReviewUseLatest')}</button></div>:null}
        {review.empty&&!disabled&&!review.error?<><p>{say(review.hasInspirations===false||count===0?'worldReviewEmpty':'worldReviewCaughtUp')}</p>{review.hasInspirations===false||count===0?<button type="button" onClick={onNewInspiration}>{say('worldCaptureInspiration')}</button>:null}</>:null}
        {session&&item&&!review.loading&&!thoughtId?<ReviewCard key={`${item.inspirationId}:${item.currentRevision}`} item={item} sessionId={session.id} initialSource={session.currentInspiration} scope={scope} locale={locale} disabled={disabled}
          onNext={reflected=>{setAdvance(true);review.choose(item,reflected?'keep':'skip');}} onRefresh={()=>void review.refresh()}
          onDeleted={removedId=>{onInspirationRemoved?.(removedId);setAdvance(true);void review.refresh();}}
          onSaved={onSaved} onSynchronized={onSynchronized} onReflectionRemoved={onReflectionRemoved} onOpen={onOpen}/>:null}
        {session&&!item&&!advance&&!thoughtId&&!disabled&&!review.error&&!review.pending?<><p>{say('worldReviewDone')}</p><button type="button" className="jar-review-primary" onClick={()=>setAdvance(true)}>{say('worldReviewAnotherInspiration')} →</button></>:null}
        {/* Preserve historical multi-source answers and deep links without
            reintroducing a collective reflection path in new reviews. */}
        {session&&(thoughtId||!item&&!advance)?<>
          <ReviewDialogue key={`${scope.accountId}:${scope.profileId}:${session.id}`} scope={scope} id={session.id} thoughtId={thoughtId} completed={Boolean(session.completedAt)} historical locale={locale} onOpen={onOpen} onRevision={review.observeRevision} onDraftChange={()=>{}}/>
          {session.completedAt?<ReviewResult profileId={scope.profileId} id={session.id} revision={session.revision} locale={locale} onOpenPrinciple={onOpenPrinciple}/>:null}
        </>:null}
      </div>
    </DialogSurface>
  </>;
}
