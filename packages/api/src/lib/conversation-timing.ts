const phases=['prepare','lookup','revalidate','answer','publication'] as const;
type Phase=typeof phases[number];
/** One content-free log per worker attempt, no EMF, identifiers or errors.
 * These are application phase durations, not browser-visible latency. */
export function createConversationTiming(now=()=>performance.now(),emit=(row:unknown)=>console.info('[conversation-timing]',JSON.stringify(row))){
  const started=now(),durations:Record<Phase,number|null>={prepare:null,lookup:null,revalidate:null,answer:null,publication:null};
  const errors:Record<Phase,boolean>={prepare:false,lookup:false,revalidate:false,answer:false,publication:false};
  const elapsed=(start:number)=>{const value=now()-start;return Number.isFinite(value)?Math.max(0,Math.round(value)):null;};
  return {
    async measure<T>(phase:Phase,work:()=>Promise<T>):Promise<T>{
      if(!phases.includes(phase))return work();
      const start=now();try{return await work();}catch(error){errors[phase]=true;throw error;}
      finally{durations[phase]=elapsed(start);}
    },
    finish(flags:{answerAttempted:boolean;published:boolean}){
      const stage=['development','dev','production','local','test'].includes(process.env.WAKA_STAGE??'')?process.env.WAKA_STAGE:'other';
      try{emit({event:'conversation_timing',Stage:stage,totalMs:elapsed(started),phaseMs:durations,phaseError:errors,
        answerAttempted:flags.answerAttempted===true,published:flags.published===true});}catch{/* Logging never changes the memory operation. */}
    },
  };
}
