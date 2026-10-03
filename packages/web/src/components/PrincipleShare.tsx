import {useEffect,useRef,useState} from 'react';
import {fetchPrinciples,fetchPrincipleStatements,type ApiPrinciple,type ApiPrincipleStatements} from '../lib/api';
import type {ProfileStorageScope} from '../lib/profile-storage';
import {ArtifactLayoutError,renderPrincipleArtifact,type PrincipleArtifactContent} from '../lib/principle-artifact';
import {readPrincipleArtifactDrafts,storePrincipleArtifactDraft,clearPrincipleArtifactDraft,recoverPrincipleArtifactDrafts,type PrincipleArtifactDraft,type StoredPrincipleArtifactDraft} from '../lib/principle-artifact-drafts';
import {t,type SupportedLocale} from '../lib/locales';
import {DialogSurface} from './DialogSurface';

export function PrincipleShare({scope,id,name,locale,onClose,onChoose}:{scope:ProfileStorageScope;id:string;name:string;locale:SupportedLocale;onClose:()=>void;onChoose:(id:string)=>void}){
  const [rows,setRows]=useState<ApiPrinciple[]|null>(null),[loadFailed,setLoadFailed]=useState(false),[attempt,setAttempt]=useState(0);
  const [draft,setDraft]=useState<StoredPrincipleArtifactDraft|null>(null),[drafts,setDrafts]=useState<StoredPrincipleArtifactDraft[]>([]),[storageFailed,setStorageFailed]=useState(false);
  const current=useRef<StoredPrincipleArtifactDraft|null>(null),writer=useRef(crypto.randomUUID());
  const [preview,setPreview]=useState<{key:string;url:string;blob:Blob;fallbackFont:boolean;words:string}|null>(null),[renderError,setRenderError]=useState<string|null>(null);
  const [renderAttempt,setRenderAttempt]=useState(0);
  const [busy,setBusy]=useState(false),[notice,setNotice]=useState<'download'|'shared'|'unavailable'|null>(null);
  const [statements,setStatements]=useState<ApiPrincipleStatements|null>(null),[historyFailed,setHistoryFailed]=useState(false),[historyAttempt,setHistoryAttempt]=useState(0);
  const say=(key:Parameters<typeof t>[1])=>t(locale,key);
  const source=rows?.find(row=>row.id===id);
  const useDraft=(value:StoredPrincipleArtifactDraft)=>{current.current=value;setDraft(value);setNotice(null);};
  const fresh=(row:ApiPrinciple):PrincipleArtifactDraft=>({id:crypto.randomUUID(),writer:writer.current,updatedAt:Date.now(),appearance:'dark',format:'square',showName:false,mode:'card',beforeStatementId:null,
    entries:[{principleId:row.id,text:row.statement,originalStatement:row.statement}]});
  useEffect(()=>{
    const controller=new AbortController();setLoadFailed(false);
    const timer=window.setTimeout(()=>{controller.abort();setLoadFailed(true);},15000);
    void fetchPrinciples({profile:scope.profileId},controller.signal).then(values=>{if(!controller.signal.aborted)setRows(values);})
      .catch(()=>{if(!controller.signal.aborted)setLoadFailed(true);}).finally(()=>window.clearTimeout(timer));
    return()=>{controller.abort();window.clearTimeout(timer);};
  },[scope.profileId,attempt]);
  useEffect(()=>{
    if(!source||current.current)return;
    let stored:StoredPrincipleArtifactDraft|undefined;
    try{const saved=readPrincipleArtifactDrafts(scope,id);setDrafts(saved);stored=saved[0];}catch{setStorageFailed(true);}
    useDraft(stored??{key:'',raw:'',value:fresh(source)});
  },[source?.id,scope.accountId,scope.profileId,id]);
  const update=(value:PrincipleArtifactDraft)=>{
    if(busy)return;
    let next={...value,updatedAt:Date.now()},previous=current.current;
    if(next.writer!==writer.current){next={...next,id:crypto.randomUUID(),writer:writer.current};previous=null;}
    try{const saved=storePrincipleArtifactDraft(scope,id,next,previous??undefined);useDraft(saved);setDrafts(readPrincipleArtifactDrafts(scope,id));setStorageFailed(false);}
    catch{useDraft({...previous??{key:'',raw:''},value:next});setStorageFailed(true);}
  };
  const change=draft?.value.mode==='change';
  useEffect(()=>{
    if(!change)return;const controller=new AbortController();setStatements(null);setHistoryFailed(false);
    const timer=window.setTimeout(()=>{controller.abort();setHistoryFailed(true);},15000);
    void fetchPrincipleStatements(id,scope.profileId,controller.signal).then(value=>{if(!controller.signal.aborted)setStatements(value);})
      .catch(()=>{if(!controller.signal.aborted)setHistoryFailed(true);}).finally(()=>window.clearTimeout(timer));
    return()=>{controller.abort();window.clearTimeout(timer);};
  },[change,id,scope.profileId,historyAttempt]);
  const after=statements?.statements.find(row=>row.id===statements.currentStatementId);
  const earlier=statements?.statements.filter(row=>row.id!==statements.currentStatementId)??[];
  const before=earlier.find(row=>row.id===draft?.value.beforeStatementId);
  useEffect(()=>{
    if(change&&after&&draft&&draft.value.beforeStatementId==null&&earlier[0])update({...draft.value,beforeStatementId:statements?.previousStatementId??earlier[0].id});
  },[change,statements?.currentStatementId,draft?.value.beforeStatementId]);
  const content:PrincipleArtifactContent|null=draft&&source&&change?(before&&after?{
    items:[{text:before.statement,label:say('worldShareEarlier'),date:new Date(before.createdAt).toLocaleDateString(locale,{dateStyle:'medium'})},
      {text:after.statement,label:say('worldShareCurrent'),date:new Date(after.createdAt).toLocaleDateString(locale,{dateStyle:'medium'})}],
    name:draft.value.showName?name:'',appearance:draft.value.appearance,format:draft.value.format,
  }:null):draft&&source&&draft.value.entries.every(entry=>rows?.some(row=>row.id===entry.principleId))?{
    items:draft.value.entries.map(entry=>({text:entry.text})),name:draft.value.showName?name:'',appearance:draft.value.appearance,format:draft.value.format,
  }:null;
  const contentKey=content?JSON.stringify(content):null;
  useEffect(()=>{
    let alive=true;setRenderError(null);setNotice(null);
    if(!contentKey)return;
    const timer=window.setTimeout(()=>{
      void renderPrincipleArtifact(JSON.parse(contentKey) as PrincipleArtifactContent).then(result=>{
        if(!alive)return;setPreview({key:contentKey,url:URL.createObjectURL(result.blob),blob:result.blob,fallbackFont:result.fallbackFont,
          words:[...(JSON.parse(contentKey) as PrincipleArtifactContent).items.flatMap(item=>[item.label,item.date,item.text].filter(Boolean)),(JSON.parse(contentKey) as PrincipleArtifactContent).name].filter(Boolean).join('\n')});
      }).catch(error=>{if(alive)setRenderError(error instanceof ArtifactLayoutError?error.code:'unavailable');});
    },150);
    return()=>{alive=false;window.clearTimeout(timer);};
  },[contentKey,renderAttempt]);
  useEffect(()=>()=>{if(preview)URL.revokeObjectURL(preview.url);},[preview?.url]);
  const ready=Boolean(contentKey&&preview?.key===contentKey&&!renderError);
  const download=()=>{
    if(!ready||!preview||busy)return;
    const url=URL.createObjectURL(preview.blob),link=document.createElement('a');link.href=url;link.download=`waka-principles-${draft!.value.format}.png`;
    document.body.append(link);link.click();link.remove();window.setTimeout(()=>URL.revokeObjectURL(url),1000);setNotice('download');
  };
  const file=ready&&preview&&typeof File==='function'?new File([preview.blob],'waka-principles.png',{type:'image/png'}):null;
  let canShare=false;try{canShare=Boolean(file&&typeof navigator.share==='function'&&typeof navigator.canShare==='function'&&navigator.canShare({files:[file]}));}catch{/* Download stays available. */}
  const share=async()=>{
    if(!ready||!file||!canShare||busy)return;setBusy(true);setNotice(null);
    try{await navigator.share({files:[file]});setNotice('shared');}
    catch(error){if((error as {name?:string}).name!=='AbortError')setNotice('unavailable');}
    finally{setBusy(false);}
  };
  const discard=()=>{
    if(busy||!draft||!source||!window.confirm(say('worldShareDiscardConfirm')))return;
    try{clearPrincipleArtifactDraft(draft);useDraft({key:'',raw:'',value:fresh(source)});setDrafts(readPrincipleArtifactDrafts(scope,id));setStorageFailed(false);}
    catch{setStorageFailed(true);}
  };
  return <>
    <button className="jar-review-backdrop" type="button" tabIndex={-1} aria-hidden="true" onClick={onClose}/>
    <DialogSurface className="jar-seek jar-principle-share" aria-label={say('worldSharePrinciple')} onClose={onClose} data-jar-chrome="1">
      <header><h2>{say('worldSharePrinciple')}</h2><button type="button" onClick={onClose}>{say('worldClose')}</button></header>
      <div className="jar-share-body">
      {loadFailed?<p role="alert">{say('worldShareLoadFailed')} <button type="button" onClick={()=>setAttempt(value=>value+1)}>{say('worldRoomHistoryRetry')}</button></p>:
        !rows?<p role="status">{say('worldReviewChecking')}</p>:!source?<p role="status">{say('worldShareMissing')}</p>:null}
      {rows?.length?<label>{say('worldShareChoose')}<select value={source?.id??''} disabled={busy||storageFailed} onChange={event=>onChoose(event.target.value)}>{!source?<option value=""/>:null}{rows.map(row=><option key={row.id} value={row.id}>{row.statement}</option>)}</select></label>:null}
      {source&&draft&&rows?<>
        <div className="jar-share-columns"><div className="jar-share-controls">
          <p className="jar-review-context">{say('worldShareSeparate')}</p>
          <label>{say('worldShareType')}<select value={draft.value.mode??'card'} disabled={busy} onChange={event=>update({...draft.value,mode:event.target.value as 'card'|'change'})}><option value="card">{say('worldShareCard')}</option><option value="change">{say('worldShareChange')}</option></select></label>
          {drafts.length>1?<label>{say('worldShareDrafts')}<select value={draft.key} disabled={busy||storageFailed} onChange={event=>{const row=drafts.find(item=>item.key===event.target.value);if(row)useDraft(row);}}>{drafts.map((row,index)=><option key={row.key} value={row.key}>{index+1}. {row.value.entries[0].text.slice(0,45)}</option>)}</select></label>:null}
          {change?<>
            {historyFailed?<p role="alert">{say('worldShareHistoryFailed')} <button type="button" onClick={()=>setHistoryAttempt(value=>value+1)}>{say('worldRoomHistoryRetry')}</button></p>:
              !statements?<p role="status">{say('worldReviewChecking')}</p>:!after||!earlier.length?<p>{say('worldShareNoHistory')}</p>:<>
                <label>{say('worldShareEarlier')}<select value={before?.id??''} disabled={busy} onChange={event=>update({...draft.value,beforeStatementId:event.target.value})}>{!before?<option value="">{say('worldShareChooseEarlier')}</option>:null}{earlier.map(row=><option key={row.id} value={row.id}>{new Date(row.createdAt).toLocaleDateString(locale)} · {row.statement}</option>)}</select></label>
                <p className="jar-review-context">{say('worldShareRecordedWords')}</p>
                {before?<blockquote>{before.statement}</blockquote>:null}<blockquote>{after.statement}</blockquote>
              </>}
          </>:draft.value.entries.map((entry,index)=><div className="jar-share-wording" key={entry.principleId}>
            <label>{say('worldShareWords')}{draft.value.entries.length>1?` ${index+1}`:''}<textarea rows={4} maxLength={2000} value={entry.text} disabled={busy} onChange={event=>update({...draft.value,entries:draft.value.entries.map((item,i)=>i===index?{...item,text:event.target.value}:item)})}/></label>
            {entry.originalStatement!==rows.find(row=>row.id===entry.principleId)?.statement?<p role="status">{say('worldShareSourceChanged')}</p>:null}
            <button type="button" disabled={busy} onClick={()=>{const original=rows.find(row=>row.id===entry.principleId);if(original)update({...draft.value,entries:draft.value.entries.map((item,i)=>i===index?{...item,text:original.statement,originalStatement:original.statement}:item)});}}>{say('worldShareOriginal')}</button>
            {index>0?<button type="button" disabled={busy} onClick={()=>update({...draft.value,entries:draft.value.entries.filter((_,i)=>i!==index)})}>{say('worldShareRemove')}</button>:null}
          </div>)}
          {!change&&draft.value.entries.length<3&&rows.some(row=>!draft.value.entries.some(entry=>entry.principleId===row.id))?<label>{say('worldShareAdd')}<select value="" disabled={busy} onChange={event=>{const row=rows.find(item=>item.id===event.target.value);if(row)update({...draft.value,entries:[...draft.value.entries,{principleId:row.id,text:row.statement,originalStatement:row.statement}]});}}><option value="">{say('worldShareChoose')}</option>{rows.filter(row=>!draft.value.entries.some(entry=>entry.principleId===row.id)).map(row=><option key={row.id} value={row.id}>{row.statement}</option>)}</select></label>:null}
          <div className="jar-share-options"><label>{say('worldShareSize')}<select value={draft.value.format} disabled={busy} onChange={event=>update({...draft.value,format:event.target.value as 'square'|'portrait'})}><option value="square">{say('worldShareSquare')}</option><option value="portrait">{say('worldSharePortrait')}</option></select></label>
            <label>{say('worldShareStyle')}<select value={draft.value.appearance} disabled={busy} onChange={event=>update({...draft.value,appearance:event.target.value as 'dark'|'light'})}><option value="dark">{say('worldShareDark')}</option><option value="light">{say('worldShareLight')}</option></select></label></div>
          <label className="jar-share-name"><input type="checkbox" checked={draft.value.showName} disabled={busy||!name} onChange={event=>update({...draft.value,showName:event.target.checked})}/>{say('worldShareName')}{name?` · ${name}`:''}</label>
          {storageFailed?<p role="alert">{say('worldShareStorageFailed')} <button type="button" onClick={()=>{try{recoverPrincipleArtifactDrafts(scope,id);update(draft.value);}catch{setStorageFailed(true);}}}>{say('worldShareKeepDraft')}</button></p>:null}
          <button type="button" disabled={busy} onClick={discard}>{say('worldReviewDiscardDraft')}</button>
        </div><div className="jar-share-preview" aria-busy={!ready&&!renderError}>
          {preview&&(!change||content)?<img src={preview.url} alt={preview.words}/>:null}
          {!content?(change?null:<p role="status">{say('worldShareMissing')}</p>):renderError?<p role="alert">{say(renderError==='too_long'?'worldShareTooLong':renderError==='empty'?'worldShareEmpty':'worldShareRenderFailed')}{renderError==='unavailable'?<button type="button" onClick={()=>setRenderAttempt(value=>value+1)}>{say('worldRoomHistoryRetry')}</button>:null}</p>:!ready?<p role="status">{say('worldShareRendering')}</p>:preview?.fallbackFont?<p className="jar-review-context">{say('worldShareFallbackFont')}</p>:null}
        </div></div>
      </>:null}
      </div>
      {source&&draft&&rows?<footer><button type="button" disabled={!ready||busy} onClick={download}>{say('worldShareDownload')}</button>{canShare?<button type="button" disabled={!ready||busy} onClick={()=>void share()}>{say('worldShareSheet')}</button>:null}
        {notice?<p role="status">{say(notice==='download'?'worldShareDownloadStarted':notice==='shared'?'worldShareSheetClosed':'worldShareUnavailable')}</p>:null}</footer>:null}
    </DialogSurface>
  </>;
}
