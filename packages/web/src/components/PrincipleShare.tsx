import {useEffect,useMemo,useRef,useState} from 'react';
import {fetchPrinciples,fetchPrincipleStatements,type ApiPrinciple,type ApiPrincipleStatements} from '../lib/api';
import type {ProfileStorageScope} from '../lib/profile-storage';
import {ArtifactLayoutError,renderShareCard,type PrincipleArtifactContent} from '../lib/principle-artifact';
import {readPrincipleArtifactDrafts,storePrincipleArtifactDraft,clearPrincipleArtifactDraft,recoverPrincipleArtifactDrafts,type PrincipleArtifactDraft,type StoredPrincipleArtifactDraft} from '../lib/principle-artifact-drafts';
import {formatMessage,t,type SupportedLocale} from '../lib/locales';
import {dateStamp} from '../lib/words';
import {DialogSurface} from './DialogSurface';
import {ShareLooks} from './ShareLooks';
import {SHARE_NOTICE_KEY,useShareImage} from '../lib/use-share-image';

/**
 * THE PROOF, COMPUTED FROM WHAT IS ACTUALLY ON THE CARD.
 *
 * The postable fact is not the sentiment, it is that the sentiment was
 * EARNED — so this counts the real saves behind the chosen principles and
 * the span they were kept across. Distinct saves, never the sum of the
 * per-principle counts: two principles standing on the same evidence must
 * not let it be counted twice, because the one number a stranger cannot
 * check is the one the card must not inflate.
 *
 * AND THE SPAN IS THE SAVES' OWN, TOLD HONESTLY (audit f2afcbe2). It was
 * `max(1, round(months))` from the principle's `heldSince`, so six things
 * all saved that morning printed "6 things I kept over 1 month". It now runs
 * from the earliest save behind the card to now, in weeks under two months
 * and months after; under a week there is no span to speak of, and the line
 * says the count alone rather than inventing one.
 */
export function principleShareProof(locale:SupportedLocale,chosen:ApiPrinciple[],now:number):string|undefined{
  const saves=new Set<string>();
  let earliest=Number.POSITIVE_INFINITY;
  for(const row of chosen)for(const signal of row.citedSignals)for(const example of signal.examples??[]){
    saves.add(example.createdAt+example.text);
    const at=Date.parse(example.createdAt);
    if(Number.isFinite(at))earliest=Math.min(earliest,at);
  }
  if(!saves.size)return undefined;
  const values={count:saves.size,principles:chosen.length};
  const days=(now-earliest)/86_400_000;
  if(!Number.isFinite(days)||days<7)return formatMessage(locale,'worldShareProofRecent',values);
  const span=days<60?formatMessage(locale,'worldShareSpanWeeks',{n:Math.floor(days/7)}):formatMessage(locale,'worldShareSpanMonths',{n:Math.floor(days/30)});
  return formatMessage(locale,'worldShareProof',{...values,span});
}

export function PrincipleShare({scope,id,name,locale,onClose,onChoose}:{scope:ProfileStorageScope;id:string;name:string;locale:SupportedLocale;onClose:()=>void;onChoose:(id:string)=>void}){
  const [rows,setRows]=useState<ApiPrinciple[]|null>(null),[loadFailed,setLoadFailed]=useState(false),[attempt,setAttempt]=useState(0);
  const [draft,setDraft]=useState<StoredPrincipleArtifactDraft|null>(null),[drafts,setDrafts]=useState<StoredPrincipleArtifactDraft[]>([]),[storageFailed,setStorageFailed]=useState(false);
  const current=useRef<StoredPrincipleArtifactDraft|null>(null),writer=useRef(crypto.randomUUID());
  const [preview,setPreview]=useState<{key:string;url:string;blob:Blob;fallbackFont:boolean;words:string}|null>(null),[renderError,setRenderError]=useState<string|null>(null);
  const [renderAttempt,setRenderAttempt]=useState(0);
  const [editingWords,setEditingWords]=useState(false),[customizing,setCustomizing]=useState(false);
  const [statements,setStatements]=useState<ApiPrincipleStatements|null>(null),[historyFailed,setHistoryFailed]=useState(false),[historyAttempt,setHistoryAttempt]=useState(0);
  const say=(key:Parameters<typeof t>[1])=>t(locale,key);
  const source=rows?.find(row=>row.id===id);
  const useDraft=(value:StoredPrincipleArtifactDraft)=>{current.current=value;setDraft(value);setNotice(null);};
  /**
   * IT OPENS WITH THE ONE YOU PRESSED (audit f2afcbe2, desk/77).
   *
   * It used to open with the set — the pressed principle and the next two by
   * rank — on the argument that "one principle is a quote; three are a
   * portrait". Pressed from a card that names one principle, "Make a share
   * card" then put every principle on the card: the press did more than it
   * said (Law 1). The set is still one choice away — "Add another" below
   * offers the rest, up to three — but it is the person's to add, not ours
   * to presume.
   */
  const fresh=(row:ApiPrinciple):PrincipleArtifactDraft=>({id:crypto.randomUUID(),writer:writer.current,updatedAt:Date.now(),appearance:'dark',format:'square',showName:false,mode:'card',beforeStatementId:null,
    entries:[{principleId:row.id,text:row.statement,originalStatement:row.statement}]});

  const proofFor=(chosen:ApiPrinciple[]):string|undefined=>principleShareProof(locale,chosen,Date.now());
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
  useEffect(()=>{if(change)setCustomizing(true);},[change]);
  useEffect(()=>{if(renderError==='empty'||renderError==='too_long')setEditingWords(true);},[renderError]);
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
  /* ═══ THE TWO DATES ON THE EXPORTED IMAGE ═════════════════════════════
     `dateStamp`, not `dateStyle:'medium'`. In English the two are the same
     string — `Oct 1, 2026` — which is why this went unnoticed; in Korean
     `Intl` gives `2026. 10. 11.` and this world says `2026년 10월 11일`.
     That difference ships: these strings are DRAWN INTO A PNG a person
     posts in public with their name on it, so a Korean card was carrying a
     date format from nowhere in the product, baked in, unfixable after the
     fact. The year stays — `dateStamp` always carries it — because the whole
     subject of a change card is that a statement meant one thing then and
     another thing now, and a before/after with no years is a before/after
     with no distance in it. */
  const content:PrincipleArtifactContent|null=draft&&source&&change?(before&&after?{
    items:[{text:before.statement,label:say('worldShareEarlier'),date:dateStamp(Date.parse(before.createdAt),locale)},
      {text:after.statement,label:say('worldShareCurrent'),date:dateStamp(Date.parse(after.createdAt),locale)}],
    name:draft.value.showName?name:'',appearance:draft.value.appearance,format:draft.value.format,
  }:null):draft&&source&&draft.value.entries.every(entry=>rows?.some(row=>row.id===entry.principleId))?{
    items:draft.value.entries.map(entry=>({text:entry.text})),name:draft.value.showName?name:'',appearance:draft.value.appearance,format:draft.value.format,
    proof:proofFor(draft.value.entries.map(entry=>rows?.find(row=>row.id===entry.principleId)).filter((row):row is ApiPrinciple=>Boolean(row))),
  }:null;
  const contentKey=content?JSON.stringify(content):null;
  useEffect(()=>{
    let alive=true;setRenderError(null);setNotice(null);
    if(!contentKey)return;
    const timer=window.setTimeout(()=>{
      void renderShareCard(JSON.parse(contentKey) as PrincipleArtifactContent).then(result=>{
        if(!alive)return;setPreview({key:contentKey,url:URL.createObjectURL(result.blob),blob:result.blob,fallbackFont:result.fallbackFont,
          words:[...(JSON.parse(contentKey) as PrincipleArtifactContent).items.flatMap(item=>[item.label,item.date,item.text].filter(Boolean)),(JSON.parse(contentKey) as PrincipleArtifactContent).name].filter(Boolean).join('\n')});
      }).catch(error=>{if(alive)setRenderError(error instanceof ArtifactLayoutError?error.code:'unavailable');});
    },150);
    return()=>{alive=false;window.clearTimeout(timer);};
  },[contentKey,renderAttempt]);
  useEffect(()=>()=>{if(preview)URL.revokeObjectURL(preview.url);},[preview?.url]);
  const ready=Boolean(contentKey&&preview?.key===contentKey&&!renderError);
  const filenames=useMemo(()=>({download:`waka-principles-${draft?.value.format??'square'}.png`,share:'waka-principles.png'}),[draft?.value.format]);
  const {busy,notice,setNotice,canShare,download,share}=useShareImage(ready?preview?.blob??null:null,filenames);
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
        !rows?<p role="status">{say('worldShareLoading')}</p>:!source?<p role="status">{say('worldShareMissing')}</p>:null}
      {rows?.length&&!source?<label>{say('worldShareChoose')}<select value="" onChange={event=>onChoose(event.target.value)}><option value=""/>{rows.map(row=><option key={row.id} value={row.id}>{row.statement}</option>)}</select></label>:null}
      {source&&draft&&rows?<>
        <div className="jar-share-columns"><div className="jar-share-controls">
          {/* THE LOOK AND THE NAME ARE THE FIRST THINGS, NOT THE LAST. They
              were two dropdowns and a checkbox at the bottom of "Customize",
              which made the two choices everyone makes about a picture the
              hardest to find. Founder, 2026-10-15: sharing should be
              "extremely streamlined", like "Strava and other products". The
              looks are shown as small cards now (`ShareLooks`), and the
              set, the change card and the drafts stay under Customize. */}
          <ShareLooks appearance={draft.value.appearance} format={draft.value.format} disabled={busy} locale={locale}
            onChange={look=>update({...draft.value,...look})}/>
          <label className="jar-share-name"><input type="checkbox" checked={draft.value.showName} disabled={busy||!name} onChange={event=>update({...draft.value,showName:event.target.checked})}/>{say('worldShareName')}{name?` · ${name}`:''}</label>
          <p className="jar-review-context">{say('worldShareSeparate')}</p>
          {!change?<details className="jar-share-word-editor" open={editingWords} onToggle={event=>setEditingWords(event.currentTarget.open)}>
            <summary>{say('worldPrincipleEdit')}</summary>
            {draft.value.entries.map((entry,index)=><div className="jar-share-wording" key={entry.principleId}>
              <label>{say('worldShareWords')}{draft.value.entries.length>1?` ${index+1}`:''}<textarea rows={4} maxLength={2000} value={entry.text} disabled={busy} onChange={event=>update({...draft.value,entries:draft.value.entries.map((item,i)=>i===index?{...item,text:event.target.value}:item)})}/></label>
              {entry.originalStatement!==rows.find(row=>row.id===entry.principleId)?.statement?<p role="status">{say('worldShareSourceChanged')}</p>:null}
              <button type="button" disabled={busy} onClick={()=>{const original=rows.find(row=>row.id===entry.principleId);if(original)update({...draft.value,entries:draft.value.entries.map((item,i)=>i===index?{...item,text:original.statement,originalStatement:original.statement}:item)});}}>{say('worldShareOriginal')}</button>
              {index>0?<button type="button" disabled={busy} onClick={()=>update({...draft.value,entries:draft.value.entries.filter((_,i)=>i!==index)})}>{say('worldShareRemove')}</button>:null}
            </div>)}
          </details>:null}
          <details className="jar-share-customize" open={customizing} onToggle={event=>setCustomizing(event.currentTarget.open)}><summary>{say('worldShareCustomize')}</summary>
          {rows.length>1?<label>{say('worldShareChoose')}<select value={source.id} disabled={busy||storageFailed} onChange={event=>onChoose(event.target.value)}>{rows.map(row=><option key={row.id} value={row.id}>{row.statement}</option>)}</select></label>:null}
          <label>{say('worldShareType')}<select value={draft.value.mode??'card'} disabled={busy} onChange={event=>update({...draft.value,mode:event.target.value as 'card'|'change'})}><option value="card">{say('worldShareCard')}</option><option value="change">{say('worldShareChange')}</option></select></label>
          {drafts.length>1?<label>{say('worldShareDrafts')}<select value={draft.key} disabled={busy||storageFailed} onChange={event=>{const row=drafts.find(item=>item.key===event.target.value);if(row)useDraft(row);}}>{drafts.map((row,index)=><option key={row.key} value={row.key}>{index+1}. {row.value.entries[0].text.slice(0,45)}</option>)}</select></label>:null}
          {change?<>
            {historyFailed?<p role="alert">{say('worldShareHistoryFailed')} <button type="button" onClick={()=>setHistoryAttempt(value=>value+1)}>{say('worldRoomHistoryRetry')}</button></p>:
              !statements?<p role="status">{say('worldReviewChecking')}</p>:!after||!earlier.length?<p>{say('worldShareNoHistory')}</p>:<>
                <label>{say('worldShareEarlier')}<select value={before?.id??''} disabled={busy} onChange={event=>update({...draft.value,beforeStatementId:event.target.value})}>{!before?<option value="">{say('worldShareChooseEarlier')}</option>:null}{/* THE PICKER WORE THE BARE `toLocaleDateString(locale)` — `10/11/2026`
                    in English, `2026. 10. 11.` in Korean — which is the one form
                    this product never shows anywhere else, and it sat in the menu
                    you choose the date on the card FROM. Same stamp as the card
                    it is choosing for, so the option and the artifact read
                    alike. */}
                  {earlier.map(row=><option key={row.id} value={row.id}>{dateStamp(Date.parse(row.createdAt),locale)} · {row.statement}</option>)}</select></label>
                <p className="jar-review-context">{say('worldShareRecordedWords')}</p>
                {before?<blockquote>{before.statement}</blockquote>:null}<blockquote>{after.statement}</blockquote>
              </>}
          </>:null}
          {!change&&draft.value.entries.length<3&&rows.some(row=>!draft.value.entries.some(entry=>entry.principleId===row.id))?<label>{say('worldShareAdd')}<select value="" disabled={busy} onChange={event=>{const row=rows.find(item=>item.id===event.target.value);if(row)update({...draft.value,entries:[...draft.value.entries,{principleId:row.id,text:row.statement,originalStatement:row.statement}]});}}><option value="">{say('worldShareChoose')}</option>{rows.filter(row=>!draft.value.entries.some(entry=>entry.principleId===row.id)).map(row=><option key={row.id} value={row.id}>{row.statement}</option>)}</select></label>:null}
          <button type="button" disabled={busy} onClick={discard}>{say('worldReviewDiscardDraft')}</button>
          </details>
          {storageFailed?<p role="alert">{say('worldShareStorageFailed')} <button type="button" onClick={()=>{try{recoverPrincipleArtifactDrafts(scope,id);update(draft.value);}catch{setStorageFailed(true);}}}>{say('worldShareKeepDraft')}</button></p>:null}
        </div><div className="jar-share-preview" aria-busy={!ready&&!renderError}>
          {preview&&!renderError&&content?<img src={preview.url} alt={preview.words}/>:null}
          {!content?(change?null:<p role="status">{say('worldShareMissing')}</p>):renderError?<p role="alert">{say(renderError==='too_long'?(change?'worldShareChangeTooLong':'worldShareTooLong'):renderError==='empty'?'worldShareEmpty':'worldShareRenderFailed')}{renderError==='unavailable'?<button type="button" onClick={()=>setRenderAttempt(value=>value+1)}>{say('worldRoomHistoryRetry')}</button>:null}</p>:!ready?<p role="status">{say('worldShareRendering')}</p>:preview?.fallbackFont?<p className="jar-review-context">{say('worldShareFallbackFont')}</p>:null}
        </div></div>
      </>:null}
      </div>
      {source&&draft&&rows?<footer><button type="button" className={canShare?undefined:'jar-share-primary'} disabled={!ready||busy} onClick={download}>{say('worldShareDownload')}</button>{canShare?<button type="button" className="jar-share-primary" disabled={!ready||busy} onClick={()=>void share()}>{say('worldShareSheet')}</button>:null}
        {notice?<p role="status">{say(SHARE_NOTICE_KEY[notice])}</p>:null}</footer>:null}
    </DialogSurface>
  </>;
}
