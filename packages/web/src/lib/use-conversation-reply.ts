import {useEffect,useRef,useState} from 'react';
import {ApiError} from './api/http';
import {fetchConversation,fetchConversationReply,stopConversationReply,type ApiConversation,type ConversationReplyState} from './api/conversations';

/** Another 4xx this many times in a row stops the watch. */
const MAX_CLIENT_ERRORS=2;
/** How long older-than-shown answers may go on before the watch stops: dev's
    ~one-minute poll window, counted in time. */
const MAX_OLDER_MS=60_000;
/** Failed reads (network, timeout, 5xx) in a row before the watch stops, as on dev. */
const MAX_FAILED_READS=2;

/** Reads resume work; only an explicit stop mutates it. */
export function useConversationReply(profileId:string,id:string|null,enabled:boolean,revision:number,onConversation:(row:ApiConversation)=>void,messageWindowStart?:number){
  const [stored,setStored]=useState<ConversationReplyState|null>(null),[serial,setSerial]=useState(0),[waiting,setWaiting]=useState(false),[error,setError]=useState(false),[busy,setBusy]=useState(false);
  /* ONLY A 404 OR 410 ENDS THE WATCH ('gone': the conversation or its reply no
     longer exists), so the panel says so, offers a reload and frees Send. */
  const [terminal,setTerminal]=useState<'gone'|null>(null);
  /* A server answering with a state OLDER than the one on screen (a lagging
     replica, a cache) is not an answer either way: the reply is still
     unconfirmed, Send stays off, and the watch keeps asking with backoff
     while the panel says it is still waiting. */
  const [behind,setBehind]=useState(false);
  /* A 401 stops the watch without ending it: "could not check", not
     "trying again", until Check again (or the session-expired door). */
  const [stopped,setStopped]=useState(false);
  const deliver=useRef(onConversation);deliver.current=onConversation;
  const alive=useRef(true),mutation=useRef<AbortController|null>(null);
  const delivered=useRef('');
  const state=stored?.profileId===profileId&&stored.conversationId===id&&stored.revision>=revision?stored:null;
  /* When answers began coming back older than the screen. Counted in TIME
     (about dev's one-minute window) and kept across focus/visibility
     re-reads, so returning to the tab cannot extend the wait for ever; only
     a current answer, a person's own Check again, or another conversation
     resets it. */
  const olderSince=useRef<number|null>(null);
  /* A person's Check again: a fresh start, including the older-state clock. */
  const check=()=>{olderSince.current=null;setSerial(value=>value+1);};
  /* A focus/visibility re-read: asks again without resetting the clock. */
  const resumeRead=()=>setSerial(value=>value+1);
  useEffect(()=>{alive.current=true;olderSince.current=null;return()=>{alive.current=false;mutation.current?.abort();};},[profileId,id]);
  useEffect(()=>{
    if(!id||!enabled)return;const controller=new AbortController();let timer:number|undefined,polls=0,failures=0,older=0,clientErrors=0;
    setWaiting(false);setError(false);setTerminal(null);setBehind(false);setStopped(false);
    const read=async()=>{
      if(controller.signal.aborted||document.hidden)return;
      const request=new AbortController(),abort=()=>request.abort();controller.signal.addEventListener('abort',abort,{once:true});const deadline=window.setTimeout(abort,15000);
      try{
        const next=await fetchConversationReply(profileId,id,request.signal);if(controller.signal.aborted)return;
        if(next.revision<revision)throw new Error('Older reply state');
        const refreshKey=`${profileId}:${id}:${serial}:${next.revision}`;
        if(next.revision>revision||(next.phase==='stale'||serial>0&&next.phase==='ready')&&delivered.current!==refreshKey){
          const conversation=messageWindowStart!==undefined?await fetchConversation(profileId,id,request.signal,messageWindowStart):await fetchConversation(profileId,id,request.signal);if(controller.signal.aborted)return;
          if(conversation.revision<next.revision)throw new Error('Older conversation');delivered.current=refreshKey;deliver.current(conversation);
        }
        /* THE REPLY STATE LANDS ONLY WITH ITS CONVERSATION. Stored before the
           conversation read confirmed the same revision, an 'Older
           conversation' left a "ready" state on screen over messages that
           did not have the reply yet — and Send came back too early. */
        setStored(next);setError(false);failures=0;clientErrors=0;
        older=0;olderSince.current=null;setBehind(false);
        if(['pending','running'].includes(next.phase)){
          // A short early cadence avoids adding two seconds to a quick reply.
          // Keep a bounded ~one-minute window, then require an explicit check.
          if(++polls<35)timer=window.setTimeout(()=>void read(),polls<=10?1000:2000);else setWaiting(true);
        }
      }catch(reason){
        if(controller.signal.aborted)return;
        /* 404 and 410 mean the reply is gone: terminal. A 401 belongs to the
           session-expired flow (the transport has already raised it): stop
           asking, show nothing of our own, and Send stays off with the reply
           unconfirmed. Any other 4xx is an error, not an answer: it says so
           at once (with Check again) and keeps to the retry path below. */
        if(reason instanceof ApiError&&(reason.status===404||reason.status===410)){setError(false);setTerminal('gone');return;}
        /* 401: the session-expired flow takes over when the session really
           ended; this stops asking but still says it could not check (with
           Check again), so a 401 that brings no door is never silence. */
        if(reason instanceof ApiError&&reason.status===401){setError(true);setStopped(true);return;}
        /* BOUNDED, LIKE THE OLD WINDOW. Another 4xx twice in a row, or an
           older-than-shown answer for as many reads as the ~one-minute poll
           window allows, stops the watch: "could not check", Check again,
           Send still off. Neither repeats forever. */
        if(reason instanceof ApiError&&reason.status>=400&&reason.status<500&&reason.status!==408&&reason.status!==429){
          clientErrors+=1;setError(true);
          if(clientErrors>=MAX_CLIENT_ERRORS){setBehind(false);setStopped(true);return;}
          timer=window.setTimeout(()=>void read(),1000);return;
        }
        if(reason instanceof Error&&(reason.message==='Older reply state'||reason.message==='Older conversation')){
          older+=1;
          olderSince.current??=Date.now();
          if(Date.now()-olderSince.current>=MAX_OLDER_MS){setBehind(false);setError(true);setStopped(true);return;}
          if(older>=2)setBehind(true);
          timer=window.setTimeout(()=>void read(),Math.min(15000,1000*2**(older-1)));return;
        }
        /* A FAILED READ IS NOT AN ANSWER — and, as on dev, two in a row (a
           dead connection, a timeout, a 5xx) stop the watch: it says it could
           not check, with Check again, and the reply stays unconfirmed (Send
           off). The first failure is retried once, quietly. */
        if(!controller.signal.aborted){
          failures+=1;
          if(failures>=MAX_FAILED_READS){setBehind(false);setError(true);setStopped(true);return;}
          timer=window.setTimeout(()=>void read(),1000);
        }
      }
      finally{window.clearTimeout(deadline);controller.signal.removeEventListener('abort',abort);}
    };void read();return()=>{controller.abort();window.clearTimeout(timer);};
  },[profileId,id,enabled,revision,serial,messageWindowStart]);
  useEffect(()=>{const resume=()=>{if(!document.hidden)resumeRead();};window.addEventListener('focus',resume);document.addEventListener('visibilitychange',resume);return()=>{window.removeEventListener('focus',resume);document.removeEventListener('visibilitychange',resume);};},[]);
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
  return {state,waiting,error,terminal,behind,stopped,busy,check,stop};
}
