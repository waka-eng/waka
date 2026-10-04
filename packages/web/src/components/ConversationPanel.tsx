import {useEffect,useRef,useState} from 'react';
import {createConversation,deleteConversation,fetchConversation,fetchConversationContext,listConversations,saveConversationMessage,type ApiConversation,type ConversationContext,type ConversationSummary} from '../lib/api/conversations';
import {profileStorageKey,type ProfileStorageScope} from '../lib/profile-storage';
import {DialogSurface} from './DialogSurface';
import {t,type SupportedLocale} from '../lib/locales';
import {readConversationDrafts,storeConversationDraft,clearConversationDraft,clearConversationDrafts,type ConversationDraft as Draft,type StoredConversationDraft} from '../lib/conversation-drafts';

export function ConversationPanel({scope,id,locale,onChoose,onClose}:{scope:ProfileStorageScope;id:string|null;locale:SupportedLocale;onChoose:(id:string|null)=>void;onClose:()=>void}){
  const [rows,setRows]=useState<ConversationSummary[]>([]),[conversation,setConversation]=useState<ApiConversation|null>(null),[draft,setDraft]=useState<Draft|null>(null);
  const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState<string|null>(null),[storageFailed,setStorageFailed]=useState(false),[context,setContext]=useState<ConversationContext|null>(null);
  const lifecycle=useRef(new AbortController()),draftRef=useRef<Draft|null>(null);
  const writer=useRef(crypto.randomUUID()),receipt=useRef<StoredConversationDraft|undefined>(undefined);
  const [drafts,setDrafts]=useState<StoredConversationDraft[]>([]);
  const newKey=profileStorageKey(scope,'conversation:new')!;
  const say=(key:Parameters<typeof t>[1])=>t(locale,key);
  const run=async<T,>(work:(signal:AbortSignal)=>Promise<T>)=>{
    const request=new AbortController(),abort=()=>request.abort();lifecycle.current.signal.addEventListener('abort',abort,{once:true});
    const timer=window.setTimeout(abort,15000);
    try{return await work(request.signal);}finally{window.clearTimeout(timer);lifecycle.current.signal.removeEventListener('abort',abort);}
  };
  const keep=(next:Draft)=>{draftRef.current=next;setDraft(next);try{if(!id)throw new Error('Missing conversation');receipt.current=storeConversationDraft(scope,id,next,receipt.current);setDrafts(readConversationDrafts(scope,id));setStorageFailed(false);return true;}catch{setStorageFailed(true);return false;}};
  const observe=(next:ApiConversation)=>{
    setConversation(next);setContext(null);
    const pending=draftRef.current;
    if(pending?.pending&&next.messages.some(message=>message.id===pending.id&&message.content===pending.content)){
      try{if(receipt.current)clearConversationDraft(receipt.current);}catch{setStorageFailed(true);}
      receipt.current=undefined;
      draftRef.current=null;setDraft(null);
    }
    if(id)try{setDrafts(readConversationDrafts(scope,id));}catch{setStorageFailed(true);}
  };
  const refresh=async()=>{
    setLoading(true);setError(null);
    try{if(id){const next=await run(signal=>fetchConversation(scope.profileId,id,signal));if(!lifecycle.current.signal.aborted)observe(next);}
      else{const next=await run(signal=>listConversations(scope.profileId,signal));if(!lifecycle.current.signal.aborted)setRows(next);}}
    catch{if(!lifecycle.current.signal.aborted)setError(say('worldConversationReadFailed'));}
    finally{if(!lifecycle.current.signal.aborted)setLoading(false);}
  };
  useEffect(()=>{
    lifecycle.current=new AbortController();
    if(id)try{const saved=readConversationDrafts(scope,id);setDrafts(saved);if(saved[0]){receipt.current=saved[0];draftRef.current=saved[0].value;setDraft(saved[0].value);}}catch{setStorageFailed(true);}
    void refresh();return()=>lifecycle.current.abort();
  },[scope.accountId,scope.profileId,id]);
  const start=async()=>{
    if(busy)return;setBusy(true);setError(null);
    try{const nextId=localStorage.getItem(newKey)??crypto.randomUUID();localStorage.setItem(newKey,nextId);
      await run(signal=>createConversation(scope.profileId,nextId,signal));if(lifecycle.current.signal.aborted)return;
      if(localStorage.getItem(newKey)===nextId)localStorage.removeItem(newKey);onChoose(nextId);
    }catch{if(!lifecycle.current.signal.aborted)setError(say('worldConversationStartFailed'));}finally{if(!lifecycle.current.signal.aborted)setBusy(false);}
  };
  const save=async()=>{
    if(!id||!conversation||busy||!draft?.content.trim()||storageFailed)return;
    const intent={...draft,revision:conversation.revision,pending:true,updatedAt:Date.now()};if(!keep(intent))return;
    setBusy(true);setError(null);
    try{const next=await run(signal=>saveConversationMessage(scope.profileId,id,{id:intent.id,content:intent.content,revision:intent.revision},signal));if(!lifecycle.current.signal.aborted)observe(next);}
    catch{if(!lifecycle.current.signal.aborted)setError(say('worldConversationSaveFailed'));}finally{if(!lifecycle.current.signal.aborted)setBusy(false);}
  };
  const remove=async()=>{
    if(!id||busy||!window.confirm(say('worldConversationDeleteConfirm')))return;setBusy(true);setError(null);
    try{await run(signal=>deleteConversation(scope.profileId,id,signal));if(lifecycle.current.signal.aborted)return;clearConversationDrafts(scope,id);onChoose(null);}
    catch{if(!lifecycle.current.signal.aborted)setError(say('worldConversationDeleteFailed'));}finally{if(!lifecycle.current.signal.aborted)setBusy(false);}
  };
  const memory=async()=>{if(!id||busy)return;setBusy(true);setError(null);setContext(null);try{const next=await run(signal=>fetchConversationContext(scope.profileId,id,signal));if(!lifecycle.current.signal.aborted)setContext(next);}catch{if(!lifecycle.current.signal.aborted)setError(say('worldConversationMemoryFailed'));}finally{if(!lifecycle.current.signal.aborted)setBusy(false);}};
  return <><button className="jar-review-backdrop" type="button" tabIndex={-1} aria-hidden="true" onClick={onClose}/>
    <DialogSurface className="jar-seek jar-conversation" aria-label={say('worldConversationTitle')} onClose={onClose} data-jar-chrome="1">
      <header><h2>{say('worldConversationTitle')}</h2><button type="button" onClick={onClose}>{say('worldClose')}</button></header>
      <p className="jar-review-context">{say('worldConversationFoundation')}</p>
      {error?<p role="alert">{error} <button type="button" disabled={busy||loading} onClick={()=>void refresh()}>{say('worldConversationCheck')}</button></p>:null}
      {loading?<p role="status">{say('worldReviewChecking')}</p>:null}
      {id&&!conversation&&!loading?<button type="button" onClick={()=>onChoose(null)}>{say('worldConversationHistory')}</button>:null}
      <div className="jar-conversation-body">
      {!id?<><button type="button" disabled={busy} onClick={()=>void start()}>{say('worldConversationNew')}</button>
        {!loading&&!rows.length?<p>{say('worldConversationEmpty')}</p>:null}
        <ul>{rows.map(row=><li key={row.id}><button type="button" onClick={()=>onChoose(row.id)}>{row.preview||say('worldConversationNew')}<time>{new Date(row.updatedAt).toLocaleDateString(locale)}</time></button></li>)}</ul></>:conversation?<>
        <button type="button" onClick={()=>onChoose(null)}>{say('worldConversationHistory')}</button>
        <ol aria-label={say('worldConversationMessages')}>{conversation.messages.map(message=><li key={message.id}><span className="jar-review-context">{say(message.role==='user'?'worldConversationYou':'worldConversationWaka')}</span><p>{message.content}</p></li>)}</ol>
        {conversation.messages.length===0?<p>{say('worldConversationFirst')}</p>:null}
        <details><summary>{say('worldConversationMemory')}</summary><button type="button" disabled={busy} onClick={()=>void memory()}>{say('worldConversationMemoryCheck')}</button>
          {context?<><p>{say('worldConversationMemoryNote')}</p><ul>{[...context.principles,...context.reading,...context.inspirations].map(row=><li key={row.id}><p>{row.text}{row.truncated?'…':''}</p>{'state' in row&&row.state==='contested'?<span>{say('worldConversationContested')}</span>:null}{'supportCurrent' in row&&!row.supportCurrent?<span>{say('worldConversationUnconfirmed')}</span>:null}</li>)}</ul></>:null}</details>
        <button type="button" disabled={busy} onClick={()=>void remove()}>{say('worldConversationDelete')}</button>
      </>:null}
      </div>
      {id&&conversation?<footer>
        {drafts.length>1?<label>{say('worldShareDrafts')}<select value={draft?.id??''} disabled={busy||storageFailed} onChange={event=>{const selected=drafts.find(row=>row.value.id===event.target.value);if(selected){receipt.current=selected;draftRef.current=selected.value;setDraft(selected.value);}}}><option value="" disabled/>{drafts.map(row=><option key={row.key} value={row.value.id}>{row.value.content.slice(0,50)}</option>)}</select></label>:null}
        <label>{say('worldConversationMessage')}<textarea maxLength={4000} rows={3} value={draft?.content??''} disabled={busy||draft?.pending} onChange={event=>{const own=draft?.writer===writer.current;keep({id:own?draft.id:crypto.randomUUID(),writer:writer.current,updatedAt:Date.now(),content:event.target.value,revision:conversation.revision,pending:false});}}/></label>
        {draft?.content?<p className="jar-review-context" role="status">{say(draft.pending?(busy?'worldSaving':'worldReviewPending'):'worldReviewDraftOnDevice')}</p>:null}
        {storageFailed?<p role="alert">{say('worldConversationDraftFailed')}</p>:null}
        {draft?.pending?<button type="button" disabled={busy||loading} onClick={()=>void refresh()}>{say('worldConversationCheck')}</button>:null}
        <button type="button" disabled={busy||loading||storageFailed||!draft?.content.trim()||conversation.revision>=200} onClick={()=>void save()}>{say(draft?.pending?'worldConversationRetry':'worldConversationSave')}</button>
        {conversation.revision>=200?<p>{say('worldConversationFull')}</p>:null}
      </footer>:null}
    </DialogSurface></>;
}
