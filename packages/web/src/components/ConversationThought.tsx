import {useEffect,useRef,useState,type ReactNode} from 'react';
import type {ApiConversationMessage} from '../lib/api/conversations';
import type {ApiInspiration} from '../lib/api';
import {useAuthoredSave} from '../lib/use-authored-save';
import {readConversationDrafts,storeConversationDraft,clearConversationDraft,type ConversationDraft,type StoredConversationDraft} from '../lib/conversation-drafts';
import type {ProfileStorageScope} from '../lib/profile-storage';
import {t,type SupportedLocale} from '../lib/locales';
import {ActionDisclosure} from './ActionDisclosure';

/** AI wording prompts the person's takeaway; it is never prefilled as theirs. */
export function ConversationThought({scope,message,locale,onSaved,onOpen,actions}:{scope:ProfileStorageScope;message:ApiConversationMessage;locale:SupportedLocale;onSaved:(row:ApiInspiration)=>void;onOpen?:(id:string)=>void;actions?:ReactNode}){
  const journal=`thought:${message.conversationId}:${message.id}`,say=(key:Parameters<typeof t>[1])=>t(locale,key);
  const writer=useRef(crypto.randomUUID()),receipt=useRef<StoredConversationDraft>();
  const [draft,setDraft]=useState<ConversationDraft|null>(null),[drafts,setDrafts]=useState<StoredConversationDraft[]>([]),[open,setOpen]=useState(false),[storageFailed,setStorageFailed]=useState(false),[adopted,setAdopted]=useState(false),[savedId,setSavedId]=useState<string|null>(null);
  const assistant=message.role==='assistant';
  const scan=()=>{const rows=readConversationDrafts(scope,journal);setDrafts(rows);return rows;};
  useEffect(()=>{try{const rows=scan();if(rows[0]){receipt.current=rows[0];setDraft(rows[0].value);setOpen(true);}}catch{setStorageFailed(true);}},[scope.accountId,scope.profileId,journal]);
  const keep=(content:string)=>{
    const next:ConversationDraft={id:draft?.writer===writer.current?draft.id:crypto.randomUUID(),writer:writer.current,updatedAt:Date.now(),content,revision:(draft?.revision??0)+1,pending:false};
    setDraft(next);try{receipt.current=storeConversationDraft(scope,journal,next,receipt.current);scan();setStorageFailed(false);return true;}catch{setStorageFailed(true);return false;}
  };
  const save=useAuthoredSave({scope,operation:'inspiration',journal,enabled:open,
    onResolved:(intent,result)=>{
      if(intent.operation!=='inspiration'||intent.input.fromConversation?.messageId!==message.id||intent.input.fromConversation.conversationId!==message.conversationId)throw new Error('Wrong conversation thought');
      for(const row of readConversationDrafts(scope,journal))if(row.value.id===intent.draft?.id&&row.value.revision===intent.draft.revision)clearConversationDraft(row);
      return ()=>{setDraft(null);receipt.current=undefined;scan();setSavedId(result.inspiration.id);setOpen(false);onSaved(result.inspiration);};
    },onRemoved:()=>{setOpen(true);},onEditRejected:()=>{setAdopted(false);},
  });
  const pending=save.pending?.operation==='inspiration'?save.pending:null;
  const submit=()=>{if(!draft||storageFailed||!draft.content.trim()||assistant&&(!adopted||draft.content.trim()===message.content.trim()))return;
    save.start({operation:'inspiration',input:{text:draft.content,kind:'note',visibility:'private',fromConversation:{conversationId:message.conversationId,messageId:message.id,selectedText:message.content,adopted:assistant}},reflect:false,draft:{id:draft.id,revision:draft.revision}});
  };
  const cancel=()=>{if(pending||save.busy)return;try{if(receipt.current)clearConversationDraft(receipt.current);receipt.current=undefined;setDraft(null);scan();setOpen(false);setAdopted(false);setStorageFailed(false);}catch{setStorageFailed(true);}};
  const saved=[...new Set([...(message.savedInspirationIds??[]),...(savedId?[savedId]:[])])];
  return <div className="jar-conversation-thought">
    <div className="jar-conversation-actions">
    {!open||actions?<ActionDisclosure locale={locale} label={say('worldChatMessageActions')}>
      {!open?<button type="button" onClick={()=>{setOpen(true);if(!draft)keep(assistant?'':message.content);}}>{say(assistant?'worldChatTakeaway':'worldChatKeepThought')}</button>:null}
      {actions}
    </ActionDisclosure>:null}
    {saved.map((id,index)=><button key={id} type="button" onClick={()=>onOpen?.(id)} disabled={!onOpen}>{say('worldChatOpenSaved')}{saved.length>1?` ${index+1}`:''}</button>)}
    </div>
    {open?<section aria-label={say('worldChatKeepThought')}>
      <p className="jar-review-context">{say(assistant?'worldChatTakeawayNote':'worldChatOwnNote')}</p>
      {drafts.length>1&&!pending?<label>{say('worldShareDrafts')}<select value={draft?.id??''} onChange={event=>{const row=drafts.find(item=>item.value.id===event.target.value);if(row){receipt.current=row;setDraft(row.value);setAdopted(false);}}}>{drafts.map(row=><option key={row.key} value={row.value.id}>{row.value.content.slice(0,50)||say('worldChatTakeaway')}</option>)}</select></label>:null}
      <label>{say('worldChatThoughtWords')}<textarea autoFocus rows={3} maxLength={4000} value={pending?.input.text??draft?.content??''} disabled={Boolean(pending)||save.busy} onChange={event=>keep(event.target.value)}/></label>
      {assistant&&!pending?<label className="jar-conversation-adopt"><input type="checkbox" checked={adopted} onChange={event=>setAdopted(event.target.checked)}/>{say('worldChatAdopt')}</label>:null}
      {storageFailed||save.phase==='storage_error'?<p role="alert">{say('worldConversationDraftFailed')}</p>:null}
      {save.phase==='uncertain'||save.phase==='unsupported'?<p role="status">{say('worldChatSaveUncertain')}</p>:null}
      {save.phase==='removed'?<p role="status">{say('worldChatSavedRemoved')}</p>:null}
      {save.phase==='rejected'?<p role="alert">{say('worldChatSaveRejected')}<button type="button" onClick={save.editRejected}>{say('worldChatEditThought')}</button></p>:null}
      {save.phase==='invalid'?<p role="alert">{say('worldConversationDraftFailed')}<button type="button" onClick={save.resetInvalid}>{say('worldChatRecoverSave')}</button></p>:null}
      {pending?<><button type="button" disabled={save.busy} onClick={save.check}>{say('worldChatCheckSaved')}</button>{save.phase==='uncertain'?<button type="button" disabled={save.busy} onClick={()=>void save.retry()}>{say('worldChatRetrySave')}</button>:null}</>:<>
        <button type="button" disabled={save.busy||storageFailed||save.phase!=='idle'&&save.phase!=='removed'||!draft?.content.trim()||assistant&&(!adopted||draft.content.trim()===message.content.trim())} onClick={submit}>{say(assistant?'worldChatSaveTakeaway':'worldChatSaveThought')}</button>
        <button type="button" disabled={save.busy} onClick={cancel}>{say('worldChatCancelThought')}</button>
      </>}
    </section>:null}
  </div>;
}
