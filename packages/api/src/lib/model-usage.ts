import {emitOperationalMetric} from './operational-metrics.js';
const operations:Record<string,string>={
  'conversation reply':'conversation','signal extraction':'signal_extraction','signal match judgement':'signal_match',
  'signal support assessment':'signal_support','top-of-mind synthesis':'top_of_mind','principle distillation':'principles',
  'principle relation judgement':'principle_relation','principle grounding':'principle_grounding','declaration routing':'declaration',
  'reflection follow-up':'reflection','review question':'review_question','review derivation':'review_derivation',
  'embedding':'embedding',
};
const numeric=(n:unknown)=>typeof n==='number'&&Number.isFinite(n)&&n>=0?n:null;
/** Numeric usage only. Unknown billing is never silently counted as free.
 * Stage/provider dimensions remain low-cardinality; no IDs, model output,
 * prompt, arbitrary label, error body or credential is accepted into logs. */
export function recordModelUsage(provider:'openrouter'|'gemini',label:string,body:unknown,durationMs:number,outcome:'received'|'http_error'|'unknown'){
  const stage=['development','dev','production','local','test'].includes(process.env.WAKA_STAGE??'')?process.env.WAKA_STAGE!:'other';
  const data=body&&typeof body==='object'?body as Record<string,unknown>:{};
  const raw=provider==='openrouter'?data.usage:data.usageMetadata;
  const usage=raw&&typeof raw==='object'?raw as Record<string,unknown>:{};
  const cost=provider==='openrouter'?numeric(usage.cost):null;
  const input=numeric(provider==='openrouter'?usage.prompt_tokens:usage.promptTokenCount);
  const output=numeric(provider==='openrouter'?usage.completion_tokens:usage.candidatesTokenCount);
  emitOperationalMetric({
    _aws:{Timestamp:Date.now(),CloudWatchMetrics:[{Namespace:'WAKA/ModelUsage',Dimensions:[['Stage','Provider']],Metrics:[
      {Name:'ModelRequests',Unit:'Count'},{Name:'UnpricedRequests',Unit:'Count'},...(cost!==null?[{Name:'CostUsd',Unit:'None'}]:[])]}]},
    event:'model_usage',Stage:stage,Provider:provider,operation:operations[label]??'other',outcome,
    ModelRequests:1,UnpricedRequests:cost===null?1:0,...(cost!==null?{CostUsd:cost}:{}),
    inputTokens:input,outputTokens:output,durationMs:numeric(durationMs),
  });
}
