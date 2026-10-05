import {useEffect,useRef,useState,type KeyboardEvent} from 'react';
import {fetchInspiration,type ApiReviewAnswer} from '../lib/api';
import {toInspirationDetail} from '../lib/data';
import type {ProfileStorageScope} from '../lib/profile-storage';
import {useReviewDialogue} from '../lib/use-review-dialogue';
import {t,type SupportedLocale} from '../lib/locales';

function ReviewReference({id,profileId,locale,onOpen}:{id:string;profileId:string;locale:SupportedLocale;onOpen:(id:string)=>void}){
  const [label,setLabel]=useState<string|null>(null);
  useEffect(()=>{const controller=new AbortController(),timer=window.setTimeout(()=>controller.abort(),15000);
    void fetchInspiration(id,{profile:profileId},controller.signal).then(row=>{if(!controller.signal.aborted&&row.id===id&&row.profileId===profileId){const text=toInspirationDetail(row).preview;setLabel(text.length>100?`${text.slice(0,97)}…`:text);}}).catch(()=>{});
    return()=>{controller.abort();window.clearTimeout(timer);};},[id,profileId]);
  return <button type="button" className="jar-review-reference" onClick={()=>onOpen(id)} disabled={!label}>{label??t(locale,'worldReviewSourceUnavailable')} ↗</button>;
}
export function ReviewDialogue({scope,id,thoughtId=null,completed,historical=false,locale,onOpen,onRevision,onDraftChange}:{scope:ProfileStorageScope;id:string;thoughtId?:string|null;completed:boolean;historical?:boolean;locale:SupportedLocale;
  onOpen:(id:string)=>void;onRevision:(revision:number)=>void;onDraftChange:(hasDraft:boolean)=>void}){
  const review=useReviewDialogue(scope,id,onRevision),{state,draft}=review;
  const history=useRef<HTMLDetailsElement>(null),focused=useRef<string|null>(null);
  useEffect(()=>{
    if(!thoughtId||focused.current===thoughtId||!state?.answers.some(row=>row.id===thoughtId))return;
    const target=document.getElementById(`thought-${thoughtId}`);
    if(history.current&&target){history.current.open=true;target.scrollIntoView?.({block:'center'});target.focus({preventScroll:true});focused.current=thoughtId;}
  },[thoughtId,state?.answers]);
  useEffect(()=>{if(completed)void review.refresh();},[completed,review.refresh]);
  const editor=useRef<HTMLTextAreaElement>(null);
  const [copyState,setCopyState]=useState<'copied'|'manual'|null>(null);
  useEffect(()=>setCopyState(null),[draft?.id,draft?.answer]);
  useEffect(()=>{if(draft?.kind==='edit')editor.current?.focus();},[draft?.kind,draft?.id]);
  const say=(key:Parameters<typeof t>[1])=>t(locale,key);
  const q=completed||historical?{phase:'closed' as const}:state?.question,answer=draft?.kind!=='create'?state?.answers.find(row=>row.id===draft?.answerId):null;
  const questionLimited=Boolean(q&&(q.phase==='idle'||q.phase==='failed')&&q.retryAfter&&Date.parse(q.retryAfter)>Date.now());
  const currentDraft=!draft||(draft.kind==='create'?q?.phase==='ready'&&q.jobId===draft.questionJobId&&q.contextHash===draft.contextHash:answer?.revision===draft.revision);
  const canSubmit=Boolean(draft&&(draft.kind==='remove'||draft.answer.trim())&&!review.busy&&!review.loading&&review.error!=='storage');
  const onReplyKey=(event:KeyboardEvent<HTMLTextAreaElement>)=>{
    if(event.key!=='Enter'||(!event.ctrlKey&&!event.metaKey)||event.altKey||event.shiftKey)return;
    event.stopPropagation();if(event.nativeEvent.isComposing||event.repeat)return;event.preventDefault();
    if(currentDraft&&canSubmit&&!draft?.submitted)void review.submit(draft?.kind==='create');
  };
  useEffect(()=>{onDraftChange(Boolean(draft)||review.busy);return()=>onDraftChange(false);},[Boolean(draft),review.busy,onDraftChange]);
  const references=(ids:string[])=> <div className="jar-review-references">{ids.map(sourceId=><ReviewReference key={sourceId} id={sourceId} profileId={scope.profileId} locale={locale} onOpen={onOpen}/>)}</div>;
  const saved=(row:ApiReviewAnswer)=><article key={row.id} id={`thought-${row.id}`} tabIndex={-1} className="jar-review-thought">
    {row.contextValid&&row.question?<p>{row.question}</p>:<p className="jar-review-context">{say('worldReviewContextChanged')}</p>}
    <p className="jar-review-answer">{row.answer}</p>
    {row.contextValid?references(row.sources.filter(source=>source.referenced).map(source=>source.inspirationId)):null}
    <div className="jar-review-thought-actions"><button type="button" disabled={Boolean(draft)||review.busy} aria-label={say('worldReviewEditThought')} onClick={()=>review.edit(row,'edit')}>✎</button>
      <button type="button" disabled={Boolean(draft)||review.busy} onClick={()=>review.edit(row,'remove')}>{say('worldRemoveLower')}</button></div>
  </article>;
  const latestThought=completed&&!thoughtId&&!review.loading?state?.answers.at(-1):null;
  return <section className="jar-review-dialogue" aria-label={say('worldReviewThink')}>
    {review.loading?<p role="status">{say('worldReviewLoadingThoughts')}</p>:null}
    {latestThought?<blockquote className="jar-review-latest-thought" aria-label={say('worldReviewYourThought')}>
      {latestThought.answer.length>180?`${latestThought.answer.slice(0,177)}…`:latestThought.answer}
    </blockquote>:null}
    {thoughtId&&state&&!review.loading&&!state.answers.some(row=>row.id===thoughtId)?<p role="status">{say('worldReviewThoughtUnavailable')}</p>:null}
    {state?.answers.length?<details ref={history} className="jar-review-history"><summary>{say('worldReviewSavedThoughts')} ({state.answers.length})</summary>{state.answers.map(saved)}</details>:null}
    {review.error?<div role="alert"><p>{say(review.error==='storage'?'worldReviewDraftStorage':review.error==='conflict'?'worldReviewDraftChanged':review.error==='limit'?'worldReviewQuestionLimit':review.error==='load'?'worldReviewThoughtsFailed':review.error==='question'?'worldReviewQuestionFailed':'worldReviewThoughtUnconfirmed')}</p>
      {review.error==='storage'?<button type="button" onClick={review.recoverStorage}>{say('worldReviewReset')}</button>:<button type="button" disabled={review.busy} onClick={()=>void review.refresh()}>{say('worldReviewCheckThoughts')}</button>}</div>:null}
    {review.drafts.length>1?<label>{say('worldReviewDrafts')}<select value={review.drafts.find(row=>row.value.id===draft?.id)?.key??''} disabled={review.busy} onChange={event=>{const row=review.drafts.find(row=>row.key===event.target.value);if(row)review.selectDraft(row);}}>{review.drafts.map((row,index)=><option key={row.key} value={row.key}>{index+1}. {row.value.answer.slice(0,60)}</option>)}</select></label>:null}
    {draft?.kind==='remove'?<div><p>{say('worldReviewRemoveThought')}</p><p className="jar-review-answer">{draft.answer}</p>
      <button type="button" disabled={!canSubmit} onClick={()=>void review.submit(false)}>{say('worldRemoveLower')}</button><button type="button" disabled={review.busy} onClick={review.discard}>{say('worldReviewCancelRemoval')}</button></div>:<>
      {q?.phase==='ready'&&!draft||q?.phase==='ready'&&draft?.kind==='create'&&currentDraft?<>
        {q.connection?<p className="jar-review-connection">{q.connection}</p>:null}<h3 className="jar-review-question">{q.question}</h3>{references(q.sourceIds)}
      </>:draft?.kind==='edit'&&answer?.contextValid?<h3>{answer.question}</h3>:null}
      {draft&&!currentDraft?<p role="status">{say(q?.phase==='closed'?(historical?'worldReviewLegacyDraft':'worldReviewClosedDraft'):'worldReviewDraftChanged')}</p>:null}
      {(q?.phase==='ready'&&!draft)||draft?<div className="jar-review-reply">
        <label htmlFor={`review-answer-${id}`}>{say('worldReviewYourThought')}</label>
        <textarea ref={editor} id={`review-answer-${id}`} value={draft?.answer??''} rows={4} maxLength={16000} disabled={review.busy} readOnly={Boolean(draft?.submitted)} placeholder={say('worldReviewAnswerPlaceholder')} onChange={event=>review.update(event.target.value)} onKeyDown={onReplyKey}/>
        {draft?<p className="jar-review-context">{say(draft.submitted&&currentDraft?'worldReviewPending':'worldReviewDraftOnDevice')}</p>:null}
        <div className="jar-review-reply-actions">
          {currentDraft?<button type="button" disabled={!canSubmit} onClick={()=>void review.submit(draft?.kind==='create')}>{say(draft?.submitted?'worldReviewRetryThought':draft?.kind==='edit'?'worldReviewUpdateThought':'worldReviewContinue')}</button>:<button type="button" onClick={()=>{const text=draft?.answer??'';void (async()=>{try{await navigator.clipboard.writeText(text);if(editor.current?.value===text)setCopyState('copied');}catch{editor.current?.focus();editor.current?.select();setCopyState('manual');}})();}}>{say('worldReviewCopyDraft')}</button>}
          {draft?.kind==='create'&&!draft.submitted&&currentDraft?<button type="button" disabled={!canSubmit} onClick={()=>void review.submit(false)}>{say('worldReviewKeepThought')}</button>:null}
          {draft?<button type="button" disabled={review.busy} onClick={()=>{if(window.confirm(say('worldReviewDiscardConfirm')))review.discard();}}>{say('worldReviewDiscardDraft')}</button>:null}
        </div>
        {copyState?<p role="status">{say(copyState==='copied'?'worldReviewDraftCopied':'worldReviewCopyDraftManual')}</p>:null}
      </div>:null}
    </>}
    {questionLimited&&!draft?<div role="status"><p>{say('worldReviewQuestionLimit')}</p><button type="button" disabled={review.busy} onClick={()=>void review.refresh()}>{say('worldReviewCheckThoughts')}</button></div>:null}
    {!draft&&q?.phase==='idle'?<><p>{say(state?.answers.length?'worldReviewThoughtKept':'worldReviewThinkIntro')}</p><button type="button" disabled={review.busy||questionLimited} onClick={()=>void review.ask()}>{say(state?.answers.length?'worldReviewNextQuestion':'worldReviewThink')}</button></>:null}
    {!draft&&q?.phase==='failed'?<div role="status"><p>{say('worldReviewQuestionFailed')}</p><button type="button" disabled={review.busy||questionLimited} onClick={()=>void review.ask(true)}>{say('worldRoomHistoryRetry')}</button></div>:null}
    {!draft&&q?.phase==='processing'?<div role="status"><p>{say(review.waiting?'worldReviewQuestionWaiting':'worldReviewQuestionThinking')}</p>{review.waiting?<button type="button" onClick={()=>void review.refresh()}>{say('worldReviewCheckThoughts')}</button>:null}</div>:null}
    {review.busy?<p role="status">{say('worldKeeping')}</p>:null}
  </section>;
}
