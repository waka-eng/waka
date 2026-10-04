import {useEffect,useRef,useState} from 'react';
import {ApiError,fetchPrinciples,updatePrinciple,type ApiPrinciple} from '../lib/api';
import {profileStorageKey,type ProfileStorageScope} from '../lib/profile-storage';
import {t,type SupportedLocale} from '../lib/locales';

interface Draft{id:string;writer:string;principleId:string;revision:string;original:string;text:string;pending:boolean;at:number}
/** Only confirmation writes. Reopening reconciles an uncertain write by GET;
 * each tab forks a draft before editing and clears only its exact receipt. */
export function ConversationPrincipleEdit({scope,contextId,locale,onUpdated}:{scope:ProfileStorageScope;contextId:string;locale:SupportedLocale;onUpdated:(row:ApiPrinciple)=>void}){
  const prefix=profileStorageKey(scope,`principleEdit:${contextId}:`)!;
  const [open,setOpen]=useState(false),[rows,setRows]=useState<ApiPrinciple[]>([]),[draft,setDraft]=useState<Draft|null>(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState<'read'|'conflict'|'uncertain'|'storage'|'saved'|null>(null),[confirmed,setConfirmed]=useState(false);
  const writer=useRef(crypto.randomUUID()),receipt=useRef<{key:string;raw:string}>(),live=useRef(true),controller=useRef<AbortController|null>(null),working=useRef(false);
  const say=(key:Parameters<typeof t>[1])=>t(locale,key);
  const persist=(next:Draft)=>{setDraft(next);try{const key=prefix+next.id,raw=JSON.stringify(next),previous=localStorage.getItem(key);if(previous!==null&&previous!==raw&&(receipt.current?.key!==key||receipt.current.raw!==previous))throw new Error('Draft changed');localStorage.setItem(key,raw);if(localStorage.getItem(key)!==raw)throw new Error('Storage failed');receipt.current={key,raw};return true;}catch{setNotice('storage');return false;}};
  const clear=()=>{const held=receipt.current;if(held&&localStorage.getItem(held.key)===held.raw)localStorage.removeItem(held.key);receipt.current=undefined;};
  const settled=(row:ApiPrinciple)=>{clear();setDraft(null);setConfirmed(false);setNotice('saved');setRows(current=>current.map(item=>item.id===row.id?row:item));onUpdated(row);};
  const run=async(write:boolean,rebase=false,held=draft)=>{
    if(working.current)return;working.current=true;setBusy(true);setNotice(null);const request=new AbortController();controller.current=request;const timer=window.setTimeout(()=>request.abort(),15000);
    try{
      if(write){if(!held||!confirmed&&!held.pending)return;const next={...held,pending:true};if(!persist(next))return;
        const updated=await updatePrinciple(next.principleId,next.text.trim(),{profile:scope.profileId,expectedStatementRevision:next.revision,signal:request.signal});if(!live.current||request.signal.aborted)return;settled(updated);
      }else{
        const next=await fetchPrinciples({profile:scope.profileId},request.signal);if(!live.current||request.signal.aborted)return;setRows(next);
        if(held){const current=next.find(row=>row.id===held.principleId);if(!current?.statementRevision){setNotice('read');return;}
          if(held.pending&&current.locked&&current.statement===held.text.trim()&&[held.revision,(BigInt(held.revision)+1n).toString()].includes(current.statementRevision)){settled(current);return;}
          if(rebase){const changed={...held,id:held.writer===writer.current?held.id:crypto.randomUUID(),writer:writer.current,original:current.statement,revision:current.statementRevision,pending:false,at:Date.now()};persist(changed);setConfirmed(false);}
          else if(current.statementRevision!==held.revision)setNotice('conflict');else if(held.pending)setNotice('uncertain');
        }
      }
    }catch(error){if(live.current&&!request.signal.aborted){
      if(write&&held&&error instanceof ApiError&&[400,404,409].includes(error.status)){persist({...held,pending:false});setConfirmed(false);setNotice(error.status===409?'conflict':'read');}
      else setNotice(write?'uncertain':'read');
    }else if(live.current)setNotice(write?'uncertain':'read');}
    finally{window.clearTimeout(timer);working.current=false;if(live.current)setBusy(false);}
  };
  useEffect(()=>{live.current=true;try{const saved=Object.keys(localStorage).filter(key=>key.startsWith(prefix)).map(key=>{const raw=localStorage.getItem(key)!,value=JSON.parse(raw) as Draft;
      if(key!==prefix+value.id||!value.writer||!value.principleId||!/^\d{1,19}$/.test(value.revision)||typeof value.text!=='string'||value.text.length>200||typeof value.original!=='string'||typeof value.pending!=='boolean'||!Number.isFinite(value.at))throw new Error('Unreadable draft');return {key,raw,value};}).sort((a,b)=>b.value.at-a.value.at);
      if(saved[0]){receipt.current=saved[0];setDraft(saved[0].value);setOpen(true);void run(false,false,saved[0].value);}
    }catch{setNotice('storage');}return()=>{live.current=false;controller.current?.abort();};},[prefix]);
  const choose=(id:string)=>{const row=rows.find(item=>item.id===id);if(!row?.statementRevision)return;if(receipt.current)clear();setConfirmed(false);persist({id:crypto.randomUUID(),writer:writer.current,principleId:id,revision:row.statementRevision,original:row.statement,text:row.statement,pending:false,at:Date.now()});};
  const cancel=()=>{if(busy||draft?.pending)return;try{clear();setDraft(null);setOpen(false);setConfirmed(false);setNotice(null);}catch{setNotice('storage');}};
  return <div className="jar-conversation-thought">
    {!open?<button type="button" onClick={()=>{setOpen(true);void run(false);}}>{say('worldChatEditPrinciple')}</button>:<section aria-label={say('worldChatEditPrinciple')}>
      <p className="jar-review-context">{say('worldChatEditPrincipleNote')}</p>
      {notice==='saved'?<p role="status">{say('worldChatPrincipleSaved')}</p>:null}
      {!draft?<><label>{say('worldChatChoosePrinciple')}<select value="" disabled={busy} onChange={event=>choose(event.target.value)}><option value="">{say('worldChatChoosePrinciple')}</option>{rows.map(row=><option key={row.id} value={row.id}>{row.statement}</option>)}</select></label>{!busy&&!rows.length?<p>{say('worldChatNoPrinciples')}</p>:null}</>:<>
        <p className="jar-review-context">{say('worldChatCurrentWording')}</p><blockquote>{draft.original}</blockquote>
        <label>{say('worldChatNewWording')}<textarea rows={3} maxLength={200} disabled={busy||draft.pending} value={draft.text} onChange={event=>{setConfirmed(false);persist({...draft,id:draft.writer===writer.current?draft.id:crypto.randomUUID(),writer:writer.current,text:event.target.value,at:Date.now()});}}/></label>
        {!draft.pending?<label className="jar-conversation-adopt"><input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/>{say('worldChatConfirmPrinciple')}</label>:null}
        <button type="button" disabled={busy||notice==='storage'||notice==='conflict'||notice==='read'||!draft.text.trim()||(!draft.pending&&!confirmed)} onClick={()=>void run(true)}>{say(draft.pending?'worldChatRetryPrinciple':'worldChatSavePrinciple')}</button>
      </>}
      {notice&&notice!=='saved'?<p role="alert">{say(notice==='conflict'?'worldChatPrincipleConflict':notice==='uncertain'?'worldChatPrincipleUncertain':notice==='storage'?'worldConversationDraftFailed':'worldChatPrincipleReadFailed')}</p>:null}
      {notice==='conflict'?<button type="button" disabled={busy} onClick={()=>void run(false,true)}>{say('worldChatReviewLatest')}</button>:null}
      {notice==='read'||notice==='uncertain'?<button type="button" disabled={busy} onClick={()=>void run(false)}>{say('worldChatCheckPrinciple')}</button>:null}
      <button type="button" disabled={busy||draft?.pending} onClick={cancel}>{say('worldChatCancelThought')}</button>
    </section>}
  </div>;
}
