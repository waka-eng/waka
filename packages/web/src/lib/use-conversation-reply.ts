import {useEffect,useRef,useState} from 'react';
import {ApiError} from './api/http';
import {fetchConversation,fetchConversationReply,stopConversationReply,type ApiConversation,type ConversationReplyState} from './api/conversations';

/** Older-than-shown answers in a row before the watch calls itself stuck. */
const OLDER_STATE_LIMIT=5;

/** Reads resume work; only an explicit stop mutates it. */
export function useConversationReply(profileId:string,id:string|null,enabled:boolean,revision:number,onConversation:(row:ApiConversation)=>void,messageWindowStart?:number){
  const [stored,setStored]=useState<ConversationReplyState|null>(null),[serial,setSerial]=useState(0),[waiting,setWaiting]=useState(false),[error,setError]=useState(false),[busy,setBusy]=useState(false);
  /* A TERMINAL ANSWER ENDS THE WATCH: 'gone' is a 404 (the conversation or its
     reply no longer exists); 'stuck' is a server that keeps answering with a
     state older than the one on screen. Retrying either forever would hold
     Send off for nothing, so the panel says so and offers a reload. */
  const [terminal,setTerminal]=useState<'gone'|'stuck'|null>(null);
  const deliver=useRef(onConversation);deliver.current=onConversation;
  const alive=useRef(true),mutation=useRef<AbortController|null>(null);
  const delivered=useRef('');
  const state=stored?.profileId===profileId&&stored.conversationId===id&&stored.revision>=revision?stored:null;
  const check=()=>setSerial(value=>value+1);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;mutation.current?.abort();};},[profileId,id]);
  useEffect(()=>{
    if(!id||!enabled)return;const controller=new AbortController();let timer:number|undefined,polls=0,failures=0,older=0;
    setWaiting(false);setError(false);setTerminal(null);
    const read=async()=>{
      if(controller.signal.aborted||document.hidden)return;
      const request=new AbortController(),abort=()=>request.abort();controller.signal.addEventListener('abort',abort,{once:true});const deadline=window.setTimeout(abort,15000);
      try{
        const next=await fetchConversationReply(profileId,id,request.signal);if(controller.signal.aborted)return;
        if(next.revision<revision)throw new Error('Older reply state');
        setStored(next);setError(false);failures=0;
        const refreshKey=`${profileId}:${id}:${serial}:${next.revision}`;
        if(next.revision>revision||(next.phase==='stale'||serial>0&&next.phase==='ready')&&delivered.current!==refreshKey){
          const conversation=messageWindowStart!==undefined?await fetchConversation(profileId,id,request.signal,messageWindowStart):await fetchConversation(profileId,id,request.signal);if(controller.signal.aborted)return;
          if(conversation.revision<next.revision)throw new Error('Older conversation');delivered.current=refreshKey;deliver.current(conversation);
        }
        older=0;
        if(['pending','running'].includes(next.phase)){
          // A short early cadence avoids adding two seconds to a quick reply.
          // Keep a bounded ~one-minute window, then require an explicit check.
          if(++polls<35)timer=window.setTimeout(()=>void read(),polls<=10?1000:2000);else setWaiting(true);
        }
      }catch(reason){
        if(controller.signal.aborted)return;
        if(reason instanceof ApiError&&reason.status===404){setError(false);setTerminal('gone');return;}
        if(reason instanceof Error&&(reason.message==='Older reply state'||reason.message==='Older conversation')&&++older>=OLDER_STATE_LIMIT){setError(false);setTerminal('stuck');return;}
        /* A FAILED READ IS NOT AN ANSWER, SO IT NEVER ENDS THE WATCH. The
           reply may still be running; the panel keeps it counted in flight
           (Send stays off) and says it is retrying, and this keeps asking —
           backing off to fifteen seconds — until the server answers. */
        if(!controller.signal.aborted){failures+=1;if(failures>=2)setError(true);timer=window.setTimeout(()=>void read(),Math.min(15000,1000*2**(failures-1)));}
      }
      finally{window.clearTimeout(deadline);controller.signal.removeEventListener('abort',abort);}
    };void read();return()=>{controller.abort();window.clearTimeout(timer);};
  },[profileId,id,enabled,revision,serial,messageWindowStart]);
  useEffect(()=>{const resume=()=>{if(!document.hidden)check();};window.addEventListener('focus',resume);document.addEventListener('visibilitychange',resume);return()=>{window.removeEventListener('focus',resume);document.removeEventListener('visibilitychange',resume);};},[]);
  /* STOPPING IS THE ONLY THING A PERSON CAN STILL DO TO A REPLY IN FLIGHT.
     `act('request')` used to sit beside this and re-ran the generator for
     "Retry reply", "Get a reply" and "Check reply" — three buttons the founder
     could not tell apart, removed with the rest of the generation plumbing
     from the surface (see `components/ConversationPanel`'s header). Asking
     again is saying something again, which goes through the composer. */
  const stop=async()=>{
    if(!id||!state||busy||!enabled||!state.requestId)return;
    const controller=new AbortController();mutation.current=controller;const deadline=window.setTimeout(()=>controller.abort(),15000);setBusy(true);setError(false);
    try{
      const next=await stopConversationReply(profileId,id,state.requestId,controller.signal);
      if(alive.current&&!controller.signal.aborted)setStored(next);
    }catch{if(alive.current)setError(true);}
    finally{window.clearTimeout(deadline);if(alive.current){setBusy(false);check();}}
  };
  return {state,waiting,error,terminal,busy,check,stop};
}
