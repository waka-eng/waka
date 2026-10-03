import {useCallback,useEffect,useRef,useState} from 'react';
import {ApiError,fetchReviewDialogue,requestReviewQuestion,saveReviewAnswer,editReviewAnswer,removeReviewAnswer,type ApiReviewAnswer,type ApiReviewDialogue} from './api';
import type {ProfileStorageScope} from './profile-storage';
import {clearReviewDraft,editReviewDraft,newReviewDraft,readReviewDrafts,recoverReviewDraftStorage,reviewDraftObserved,storeReviewDraft,type StoredReviewDraft} from './review-dialogue-drafts';

type Failure='load'|'save'|'question'|'conflict'|'storage'|'limit'|null;
export function useReviewDialogue(scope:ProfileStorageScope,id:string,onRevision:(revision:number)=>void){
  const [state,setState]=useState<ApiReviewDialogue|null>(null),[draft,setDraft]=useState<StoredReviewDraft|null>(null),[drafts,setDrafts]=useState<StoredReviewDraft[]>([]);
  const [error,setError]=useState<Failure>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[waiting,setWaiting]=useState(false);
  const current=useRef<StoredReviewDraft|null>(null),writer=useRef(crypto.randomUUID()),epoch=useRef(0),request=useRef<AbortController|null>(null),working=useRef(false);
  const callbacks=useRef({onRevision});callbacks.current={onRevision};
  const useDraft=useCallback((row:StoredReviewDraft|null)=>{current.current=row;setDraft(row);},[]);
  const refreshDrafts=useCallback((preferred?:StoredReviewDraft|null)=>{
    const rows=readReviewDrafts(scope,id);setDrafts(rows);
    useDraft(preferred===null?null:rows.find(row=>row.key===(preferred??current.current)?.key)??rows[0]??null);
  },[scope.accountId,scope.profileId,id,useDraft]);
  const accept=useCallback((next:ApiReviewDialogue)=>{
    for(const row of readReviewDrafts(scope,id))if(reviewDraftObserved(row.value,next))clearReviewDraft(row);
    setState(next);callbacks.current.onRevision(next.revision);refreshDrafts();
  },[scope.accountId,scope.profileId,id,refreshDrafts]);
  const perform=useCallback(async(work:(signal:AbortSignal)=>Promise<ApiReviewDialogue>,mutating=false,questionOnly=false)=>{
    if(working.current)return null;
    working.current=true;setBusy(mutating);setError(null);request.current?.abort();const controller=new AbortController();request.current=controller;
    const serial=++epoch.current;let timer:number|undefined;
    try{
      const timeout=new Promise<never>((_,reject)=>{timer=window.setTimeout(()=>{controller.abort();reject(new Error('Review timed out'));},15000);});
      const next=await Promise.race([work(controller.signal),timeout]);
      if(serial!==epoch.current||controller.signal.aborted)return null;
      accept(next);return next;
    }catch(reason){if(serial===epoch.current)setError(reason instanceof ApiError&&[404,409,410].includes(reason.status)?'conflict':reason instanceof ApiError&&reason.status===429?'limit':questionOnly?'question':mutating?'save':'load');return null;}
    finally{window.clearTimeout(timer);if(serial===epoch.current){working.current=false;setBusy(false);setLoading(false);}}
  },[accept]);
  const refresh=useCallback(()=>perform(signal=>fetchReviewDialogue(id,scope.profileId,signal)),[perform,id,scope.profileId]);
  useEffect(()=>{
    working.current=false;writer.current=crypto.randomUUID();useDraft(null);setDrafts([]);setState(null);setLoading(true);setError(null);setBusy(false);setWaiting(false);
    try{refreshDrafts();void refresh();}catch{setError('storage');setLoading(false);}
    return()=>{epoch.current+=1;request.current?.abort();};
  },[refresh,refreshDrafts,useDraft]);
  // Opening and polling only read. An explicit Continue can request a follow-up.
  const processing=state?.question.phase==='processing';
  useEffect(()=>{
    if(!processing)return;let alive=true,count=0,timer:number;
    setWaiting(false);
    const check=async()=>{if(!alive)return;await refresh();if(!alive)return;
      if(++count>=20){setWaiting(true);return;}timer=window.setTimeout(()=>void check(),2000);};
    timer=window.setTimeout(()=>void check(),2000);
    return()=>{alive=false;window.clearTimeout(timer);};
  },[processing,refresh]);
  const ask=async(retry=false)=>{
    if(!state||current.current||working.current)return;
    setWaiting(false);await perform(signal=>requestReviewQuestion(id,scope.profileId,state.latestAnswerId??null,retry,signal),true,true);
  };
  const update=(answer:string)=>{
    if(working.current||current.current?.value.submitted||answer.length>16000)return;
    const old=current.current;
    let value=old?.value;
    if(!value){if(state?.question.phase!=='ready')return;value=newReviewDraft(writer.current,state.question);}
    if(value.writer!==writer.current){const draftId=crypto.randomUUID();value={...value,id:draftId,writer:writer.current,...(value.kind==='create'?{answerId:draftId}:{})};}
    value={...value,answer,updatedAt:Date.now()};
    // Keep current words visible even when durable storage is unavailable.
    const unsaved={key:old?.key??'',raw:old?.raw??'',value};
    try{const saved=storeReviewDraft(scope,id,value,old??undefined);if(old&&old.key!==saved.key)clearReviewDraft(old);useDraft(saved);refreshDrafts(saved);setError(null);}
    catch{useDraft(unsaved);setError('storage');}
  };
  const submit=async(continueThinking=true)=>{
    let row=current.current;if(!row||working.current)return;
    try{row=storeReviewDraft(scope,id,{...row.value,submitted:true},row);useDraft(row);refreshDrafts(row);}
    catch{setError('storage');return;}
    const value=row.value;
    const next=await perform(signal=>value.kind==='create'?saveReviewAnswer(id,scope.profileId,{id:value.answerId,questionJobId:value.questionJobId!,contextHash:value.contextHash!,answer:value.answer.trim()},signal)
      :value.kind==='edit'?editReviewAnswer(id,scope.profileId,value.answerId,{revision:value.revision,answer:value.answer.trim()},signal)
      :removeReviewAnswer(id,scope.profileId,value.answerId,value.revision,signal),true);
    if(!next)return;
    // Explicit submit intent, not a GET effect; saved words survive a failed question.
    if(continueThinking&&value.kind==='create'&&next.question.phase==='idle'&&!current.current)
      await perform(signal=>requestReviewQuestion(id,scope.profileId,next.latestAnswerId??null,false,signal),true,true);
  };
  const edit=(answer:ApiReviewAnswer,kind:'edit'|'remove')=>{
    if(current.current||working.current)return;
    try{const saved=storeReviewDraft(scope,id,editReviewDraft(writer.current,answer,kind));useDraft(saved);refreshDrafts(saved);}catch{setError('storage');}
  };
  const discard=()=>{
    if(working.current||!current.current)return;
    try{clearReviewDraft(current.current);useDraft(null);refreshDrafts();setError(null);void refresh();}catch{setError('storage');}
  };
  return {state,draft:draft?.value??null,drafts,busy,loading,error,waiting,refresh,ask,update,submit,edit,discard,
    recoverStorage:()=>{
      if(working.current)return;
      try{
        if(current.current)useDraft(storeReviewDraft(scope,id,current.current.value,current.current));
        recoverReviewDraftStorage(scope,id);refreshDrafts();void refresh();
      }catch{setError('storage');}
    },
    selectDraft:(row:StoredReviewDraft)=>{if(!working.current)useDraft(row);}};
}
