import {useEffect,useRef,useState} from 'react';
import {fetchConversation,fetchConversationReply,requestConversationReply,stopConversationReply,type ApiConversation,type ConversationReplyState} from './api/conversations';

/** Reads resume work; only explicit request/stop handlers mutate it. */
export function useConversationReply(profileId:string,id:string|null,enabled:boolean,revision:number,onConversation:(row:ApiConversation)=>void,messageWindowStart?:number){
  const [stored,setStored]=useState<ConversationReplyState|null>(null),[serial,setSerial]=useState(0),[checking,setChecking]=useState(false),[waiting,setWaiting]=useState(false),[error,setError]=useState(false),[busy,setBusy]=useState(false);
  const deliver=useRef(onConversation);deliver.current=onConversation;
  const alive=useRef(true),mutation=useRef<AbortController|null>(null);
  const delivered=useRef('');
  const state=stored?.profileId===profileId&&stored.conversationId===id&&stored.revision>=revision?stored:null;
  const check=()=>setSerial(value=>value+1);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;mutation.current?.abort();};},[profileId,id]);
  useEffect(()=>{
    if(!id||!enabled)return;const controller=new AbortController();let timer:number|undefined,polls=0,failures=0;
    setChecking(true);setWaiting(false);setError(false);
    const read=async()=>{
      if(controller.signal.aborted||document.hidden)return;
      const request=new AbortController(),abort=()=>request.abort();controller.signal.addEventListener('abort',abort,{once:true});const deadline=window.setTimeout(abort,15000);
      try{
        const next=await fetchConversationReply(profileId,id,request.signal);if(controller.signal.aborted)return;
        if(next.revision<revision)throw new Error('Older reply state');
        setStored(next);setChecking(false);setError(false);failures=0;
        const refreshKey=`${profileId}:${id}:${serial}:${next.revision}`;
        if(next.revision>revision||(next.phase==='stale'||serial>0&&next.phase==='ready')&&delivered.current!==refreshKey){
          const conversation=messageWindowStart!==undefined?await fetchConversation(profileId,id,request.signal,messageWindowStart):await fetchConversation(profileId,id,request.signal);if(controller.signal.aborted)return;
          if(conversation.revision<next.revision)throw new Error('Older conversation');delivered.current=refreshKey;deliver.current(conversation);
        }
        if(['pending','running'].includes(next.phase)){
          // A short early cadence avoids adding two seconds to a quick reply.
          // Keep a bounded ~one-minute window, then require an explicit check.
          if(++polls<35)timer=window.setTimeout(()=>void read(),polls<=10?1000:2000);else setWaiting(true);
        }
      }catch{if(!controller.signal.aborted){if(++failures<2)timer=window.setTimeout(()=>void read(),1000);else{setError(true);setChecking(false);}}}
      finally{window.clearTimeout(deadline);controller.signal.removeEventListener('abort',abort);}
    };void read();return()=>{controller.abort();window.clearTimeout(timer);};
  },[profileId,id,enabled,revision,serial,messageWindowStart]);
  useEffect(()=>{const resume=()=>{if(!document.hidden)check();};window.addEventListener('focus',resume);document.addEventListener('visibilitychange',resume);return()=>{window.removeEventListener('focus',resume);document.removeEventListener('visibilitychange',resume);};},[]);
  const act=async(kind:'request'|'stop')=>{
    if(!id||!state||busy||!enabled||kind==='request'&&(!state.canRetry||!state.messageId)||kind==='stop'&&!state.requestId)return;
    const controller=new AbortController();mutation.current=controller;const deadline=window.setTimeout(()=>controller.abort(),15000);setBusy(true);setError(false);
    try{
      const next=kind==='stop'?await stopConversationReply(profileId,id,state.requestId!,controller.signal):await requestConversationReply(profileId,id,{messageId:state.messageId!,afterRequestId:state.requestId},controller.signal);
      if(alive.current&&!controller.signal.aborted)setStored(next);
    }catch{if(alive.current)setError(true);}
    finally{window.clearTimeout(deadline);if(alive.current){setBusy(false);check();}}
  };
  return {state,checking,waiting,error,busy,check,request:()=>act('request'),stop:()=>act('stop')};
}
