const phases=['prepare','lookup','revalidate','answer','publication'] as const;
type Phase=typeof phases[number];
/** One fixed-field log per worker attempt, no EMF or errors. Development alone
 * may carry the existing technical reply UUID for internal correlation.
 * These are application phase durations, not browser-visible latency. */
export function createConversationTiming(now=()=>performance.now(),emit=(row:unknown)=>console.info('[conversation-timing]',JSON.stringify(row))){
  const clock=()=>{try{const value=now();return Number.isFinite(value)?value:null;}catch{return null;}};
  const started=clock(),durations:Record<Phase,number|null>={prepare:null,lookup:null,revalidate:null,answer:null,publication:null};
  const errors:Record<Phase,boolean>={prepare:false,lookup:false,revalidate:false,answer:false,publication:false};
  let requestId:string|undefined,revisionBucket:ConversationRevisionBucket='unknown';
  const elapsed=(start:number|null)=>{const end=clock();if(start===null||end===null)return null;const value=end-start;return Number.isFinite(value)?Math.max(0,Math.round(value)):null;};
  return {
    correlate(id:string,revision:number){try{requestId=technicalRequestId(id);revisionBucket=conversationRevisionBucket(revision);}catch{/* diagnostic only */}},
    async measure<T>(phase:Phase,work:()=>Promise<T>):Promise<T>{
      if(!phases.includes(phase))return work();
      const start=clock();try{return await work();}catch(error){errors[phase]=true;throw error;}
      finally{durations[phase]=elapsed(start);}
    },
    finish(flags:{answerAttempted:boolean;published:boolean}){
      const stage=['development','dev','production','local','test'].includes(process.env.WAKA_STAGE??'')?process.env.WAKA_STAGE:'other';
      try{const row={event:'conversation_timing',Stage:stage,totalMs:elapsed(started),phaseMs:durations,phaseError:errors,
        answerAttempted:flags.answerAttempted===true,published:flags.published===true,
        ...(stage==='development'?{revisionBucket,...(requestId?{requestId}:{})}:{})};
        emitSafely(emit,row);
      }catch{/* Logging never changes the memory operation. */}
    },
  };
}


type ConversationRevisionBucket='first'|'ordinary'|'middle'|'long'|'unknown';
export type ConversationAdmissionObservation={requestId:string|null;revision:number;admission:'new'|'replay'};
export type ConversationAdmissionObserver=(value:ConversationAdmissionObservation)=>unknown;
function technicalRequestId(value:unknown){return typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)?value:undefined;}
function conversationRevisionBucket(value:unknown):ConversationRevisionBucket{
  return typeof value!=='number'||!Number.isInteger(value)||value<1||value>200?'unknown'
    :value===1?'first':value<=30?'ordinary':value<120?'middle':'long';
}
function emitSafely(emit:(row:unknown)=>unknown,row:unknown){
  const body=JSON.stringify(row);if(Buffer.byteLength(body,'utf8')>1024)return;
  const result=emit(row);if(result&&typeof (result as PromiseLike<unknown>).then==='function')void Promise.resolve(result).catch(()=>{});
}

/** Original awaits only; no diagnostic callback is awaited. The completion
 * boundary is before response construction, not HTTP headers or browser paint. */
export function createConversationApiTiming(operation:'create'|'message'|'retry',requested=true,
  now=()=>performance.now(),emit:(row:unknown)=>unknown=row=>console.info('[conversation-api-timing]',JSON.stringify(row))){
  const enabled=requested&&process.env.WAKA_STAGE==='development'&&['create','message','retry'].includes(operation);
  const clock=()=>{try{const value=now();return Number.isFinite(value)?value:null;}catch{return null;}};
  const started=enabled?clock():null;
  let phase:'transaction'|'sweep'|'wake'|null=null,since:number|null=null,bodyExit:number|null=null,finished=false;
  let transactionOutcome:'resolved'|'unconfirmed'='unconfirmed',admission:'new'|'replay'|'unlinked'='unlinked';
  let requestId:string|undefined,revisionBucket:ConversationRevisionBucket='unknown',tail:number|null=null;
  const duration={transaction:null as number|null,sweep:null as number|null,wake:null as number|null};
  const elapsed=(start:number|null,end:number|null)=>start===null||end===null?null:Math.max(0,Math.round(end-start));
  const end=(at:number|null)=>{if(phase)duration[phase]=elapsed(since,at);phase=null;};
  return {
    mark(next:'transaction'|'resolved'|'sweep'|'wake'){
      if(!enabled)return;try{const at=clock();end(at);
        if(next==='resolved'){transactionOutcome='resolved';tail=elapsed(bodyExit,at);}
        else{phase=next;since=at;}
      }catch{/* diagnostic only */}
    },
    bodyFinished(){if(enabled)try{bodyExit=clock();}catch{/* diagnostic only */}},
    observe(value:ConversationAdmissionObservation){
      if(!enabled)return;try{if(value.admission!=='new'&&value.admission!=='replay')return;
        admission=value.admission;requestId=technicalRequestId(value.requestId);revisionBucket=conversationRevisionBucket(value.revision);
      }catch{/* diagnostic only */}
    },
    finish(responseReady=false){
      if(!enabled||finished)return;finished=true;
      try{if(process.env.WAKA_STAGE!=='development')return;const at=clock();end(at);
        emitSafely(emit,{event:'conversation_api_timing',Stage:'development',operation,transactionOutcome,admission,
          revisionBucket,...(requestId?{requestId}:{}),responseReady:responseReady===true,totalMs:elapsed(started,at),
          transactionMs:duration.transaction,bodyExitToResolutionMs:transactionOutcome==='resolved'?tail:null,
          sweepMs:duration.sweep,wakeMs:duration.wake});
      }catch{/* Logging must not change commit/error/replay behavior. */}
    },
  };
}
