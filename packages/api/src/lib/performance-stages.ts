import type {ModelProvider} from './model-provider.js';
import {backgroundJobTypeValues} from '../db/schema-background-jobs.js';
export type PerformanceStage='queue_wait'|'material_read'|'context_read'|'embedding'|'model'|'publication_validation';
/** Timing only. No inputs, outputs, identifiers, exceptions or credentials.
 * A broken log sink must never change a memory operation's outcome. */
export function recordPerformanceStage(stage:PerformanceStage,operation:string,durationMs:number,outcome:'ok'|'error'='ok'){
  if(!Number.isFinite(durationMs)||!timingOperations.has(operation))return;
  try{console.info('[performance-stage]',JSON.stringify({stage,operation,durationMs:Math.max(0,Math.round(durationMs)),outcome}));}catch{/* diagnostics are not the operation */}
}
export async function measurePerformanceStage<T>(stage:PerformanceStage,operation:string,work:()=>Promise<T>):Promise<T>{
  const started=performance.now();let outcome:'ok'|'error'='error';
  try{const result=await work();outcome='ok';return result;}
  finally{recordPerformanceStage(stage,operation,performance.now()-started,outcome);}
}
const modelMethods=new Set(['answerConversation','askReflectionQuestion','askReviewQuestion','deriveReviewAnswer','extractSignalCandidates',
  'assessSignalSupport','judgeSignalMatch','distillPrinciples','assessPrincipleGrounding','judgePrincipleRelation','routeDeclaration','synthesizeTopOfMind','reviewTopOfMind']);
const timingOperations=new Set([...modelMethods,...backgroundJobTypeValues,'conversation','inspiration','gemini']);
/** Forward precisely one call and its original result/error. Transport, model,
 * token limits, budgets and retry behavior remain the provider's responsibility. */
export function timeModelProvider(provider:ModelProvider):ModelProvider{
  return new Proxy(provider,{get(target,key,receiver){
    const value=Reflect.get(target,key,receiver);
    if(typeof key!=='string'||!modelMethods.has(key)||typeof value!=='function')return value;
    return (...args:unknown[])=>measurePerformanceStage('model',key,()=>value.apply(target,args));
  }});
}
