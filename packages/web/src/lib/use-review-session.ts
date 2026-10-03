import {useCallback,useEffect,useRef,useState} from 'react';
import {ApiError,chooseReviewInspiration,fetchActiveReview,fetchReviewSession,finishReviewSession,startReviewSession,type ApiReviewItem,type ApiReviewSession,type ReviewChoiceInput} from './api';
import {profileStorageKey,type ProfileStorageScope} from './profile-storage';

type Action={kind:'start';id:string;inspirationIds?:string[]}|{kind:'choice';id:string;input:ReviewChoiceInput}|{kind:'finish';id:string;revision:number};
type Intent=Action&{requestId:string;createdAt:number};
function validIntent(value:unknown):value is Intent {
  if(!value||typeof value!=='object') return false;
  const row=value as Intent;
  if(typeof row.id!=='string'||!/^[0-9a-f-]{36}$/i.test(row.id)||typeof row.requestId!=='string'||!/^[0-9a-f-]{36}$/i.test(row.requestId)||!Number.isFinite(row.createdAt)) return false;
  if(row.kind==='start') return row.inspirationIds===undefined||(Array.isArray(row.inspirationIds)&&row.inspirationIds.length>0&&row.inspirationIds.length<=5&&row.inspirationIds.every(id=>typeof id==='string'&&/^[0-9a-f-]{36}$/i.test(id)));
  if(row.kind==='finish') return Number.isSafeInteger(row.revision)&&row.revision>=0;
  return row.kind==='choice'&&Boolean(row.input)&&Number.isSafeInteger(row.input.revision)&&row.input.revision>=0&&
    typeof row.input.inspirationId==='string'&&/^[0-9a-f-]{36}$/i.test(row.input.inspirationId)&&typeof row.input.sourceRevision==='string'&&/^[1-9]\d{0,18}$/.test(row.input.sourceRevision)&&[null,'keep','skip'].includes(row.input.choice);
}
function observed(intent:Intent,row:ApiReviewSession|null){
  if(!row) return false;
  if(intent.kind==='start') return row.id===intent.id||(!intent.inspirationIds&&!row.completedAt);
  if(row.id!==intent.id) return false;
  if(intent.kind==='finish') return Boolean(row.completedAt);
  const item=row.items.find(item=>item.inspirationId===intent.input.inspirationId);
  return Boolean(item&&row.revision===intent.input.revision+1&&item.choice===intent.input.choice&&item.sourceRevision===intent.input.sourceRevision&&row.cursor===item.position+(intent.input.choice===null?0:1));
}
async function limited<T>(work:Promise<T>,controller:AbortController):Promise<T>{
  let rejectAbort!:()=>void;
  const canceled=new Promise<never>((_,reject)=>{rejectAbort=()=>reject(new Error('Review request stopped'));});
  controller.signal.addEventListener('abort',rejectAbort,{once:true});
  const timer=window.setTimeout(()=>controller.abort(),15000);
  try{return await Promise.race([work,canceled]);}
  finally{window.clearTimeout(timer);controller.signal.removeEventListener('abort',rejectAbort);}
}

/** Reads may reconcile a committed intent but never resend one. Local storage
 * must retain the exact owner-scoped intent before a write reaches the API. */
export function useReviewSession(scope:ProfileStorageScope,id:string,onId:(id:string)=>void){
  const key=profileStorageKey(scope,'reviewIntent:')!;
  const [session,setSession]=useState<ApiReviewSession|null>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
  const [pending,setPending]=useState<Intent|null>(null),[error,setError]=useState<'load'|'save'|'conflict'|'storage'|null>(null),[empty,setEmpty]=useState(false);
  const [reload,setReload]=useState(0);
  const live=useRef({scope,id,onId});live.current={scope,id,onId};
  const intent=useRef<Intent|null>(null),working=useRef(false),epoch=useRef(0),request=useRef<AbortController|null>(null);
  const storageBlocked=useRef(false);
  const settle=useCallback((value:Intent)=>{
    const saved=localStorage.getItem(key+value.requestId);
    if(saved!==null&&saved!==JSON.stringify(value))throw new Error('Review intent changed');
    localStorage.removeItem(key+value.requestId);intent.current=null;setPending(null);
  },[key]);
  const read=useCallback(async(takeLatest=false)=>{
    if(working.current)return;
    if(storageBlocked.current){setError('storage');setLoading(false);return;}
    const serial=++epoch.current;request.current?.abort();const controller=new AbortController();request.current=controller;
    setLoading(true);setError(null);
    try {
      const active=live.current,waiting=intent.current;
      let row:ApiReviewSession|null;
      if(active.id==='new') row=await limited(fetchActiveReview(active.scope.profileId,controller.signal),controller);
      else row=await limited(fetchReviewSession(active.id,active.scope.profileId,controller.signal),controller);
      if(controller.signal.aborted||epoch.current!==serial) return;
      if(waiting&&(takeLatest||observed(waiting,row))) settle(waiting);
      if(waiting&&intent.current&&row){
        const changed=waiting.kind==='start'?Boolean(waiting.inspirationIds&&row.id!==waiting.id)
          :row.id!==waiting.id||row.revision> (waiting.kind==='choice'?waiting.input.revision:waiting.revision)
            ||(waiting.kind==='choice'&&row.items.find(item=>item.inspirationId===waiting.input.inspirationId)?.currentRevision!==waiting.input.sourceRevision);
        if(changed)setError('conflict');
      }
      setSession(row);setEmpty(false);
      if(row&&active.id!==row.id&&!intent.current) active.onId(row.id);
    } catch(reason){if(epoch.current===serial){if(reason instanceof ApiError&&[401,403,404].includes(reason.status))setSession(null);setError('load');}}
    finally {if(epoch.current===serial) setLoading(false);}
  },[key,settle]);
  useEffect(()=>{
    working.current=false;storageBlocked.current=false;intent.current=null;setBusy(false);setPending(null);setSession(null);setEmpty(false);
    try {
      const saved:Intent[]=[];
      for(let i=0;i<localStorage.length;i++){
        const name=localStorage.key(i);if(!name?.startsWith(key))continue;
        const value:unknown=JSON.parse(localStorage.getItem(name)!);
        if(!validIntent(value)||name!==key+value.requestId)throw new Error('Invalid review draft');
        if(id==='new'||value.id===id)saved.push(value);
      }
      saved.sort((a,b)=>a.createdAt-b.createdAt||a.requestId.localeCompare(b.requestId));
      if(saved[0]){intent.current=saved[0];setPending(saved[0]);}
    }
    catch {storageBlocked.current=true;setLoading(false);setError('storage');return;}
    void read();
    return ()=>{epoch.current+=1;request.current?.abort();};
  },[key,id,read,reload]);
  const run=async(value:Intent)=>{
    if(working.current) return;
    working.current=true;setBusy(true);setLoading(false);setError(null);request.current?.abort();const controller=new AbortController();request.current=controller;
    const serial=++epoch.current,profileId=scope.profileId;
    try {
      const work=value.kind==='start'?startReviewSession({id:value.id,...(value.inspirationIds?{inspirationIds:value.inspirationIds}:{})},profileId,controller.signal)
        :value.kind==='choice'?chooseReviewInspiration(value.id,value.input,profileId,controller.signal):finishReviewSession(value.id,value.revision,profileId,controller.signal);
      const row=await limited(work,controller);
      if(epoch.current!==serial) return;
      settle(value);setSession(row);setEmpty(!row);setLoading(false);
      if(row&&live.current.id!==row.id) live.current.onId(row.id);
    } catch(reason){if(epoch.current===serial)setError(reason instanceof ApiError&&[404,409].includes(reason.status)?'conflict':'save');}
    finally {if(epoch.current===serial){working.current=false;setBusy(false);}}
  };
  const write=(action:Action)=>{
    if(working.current||intent.current||loading||storageBlocked.current) return;
    let value:Intent;
    try {const raw=JSON.stringify({...action,requestId:crypto.randomUUID(),createdAt:Date.now()});value=JSON.parse(raw) as Intent;
      localStorage.setItem(key+value.requestId,raw);if(localStorage.getItem(key+value.requestId)!==raw)throw new Error('Review storage failed');}
    catch {setError('storage');return;}
    intent.current=value;setPending(value);void run(value);
  };
  return {session,loading,busy,pending,error,empty,
    start:(inspirationIds?:string[])=>write({kind:'start',id:crypto.randomUUID(),...(inspirationIds?{inspirationIds}:{})}),
    choose:(item:ApiReviewItem,choice:'keep'|'skip'|null)=>{if(session)write({kind:'choice',id:session.id,input:{revision:session.revision,inspirationId:item.inspirationId,sourceRevision:item.currentRevision,choice}});},
    finish:()=>{if(session)write({kind:'finish',id:session.id,revision:session.revision});},
    retry:()=>{if(intent.current)void run(intent.current);else void read();},
    refresh:()=>read(),useLatest:()=>read(true),recoverStorage:()=>{
      try {
        const names=Object.keys(localStorage).filter(name=>name.startsWith(key));
        for(const name of names){
          const raw=localStorage.getItem(name)!;let valid=false;
          try{const value:unknown=JSON.parse(raw);valid=validIntent(value)&&name===key+value.requestId;}catch{/* retain unverified bytes below */}
          if(!valid){const backup=profileStorageKey(scope,`reviewRecovery:${crypto.randomUUID()}`)!;localStorage.setItem(backup,raw);if(localStorage.getItem(backup)!==raw)throw new Error('Recovery storage failed');localStorage.removeItem(name);}
        }
        setReload(value=>value+1);
      }catch{setError('storage');}
    }};
}
