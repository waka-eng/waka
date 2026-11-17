import {emitOperationalMetric} from './operational-metrics.js';
import {recordOperationalFault} from './operational-fault.js';
const operations:Record<string,string>={
  'conversation reply':'conversation','signal extraction':'signal_extraction','signal match judgement':'signal_match',
  'signal support assessment':'signal_support','top-of-mind synthesis':'top_of_mind','top-of-mind review':'top_of_mind_review','principle distillation':'principles',
  'principle relation judgement':'principle_relation','principle grounding':'principle_grounding','declaration routing':'declaration',
  'reflection follow-up':'reflection','review question':'review_question','review derivation':'review_derivation',
  'embedding':'embedding',
  'top-of-mind comparison':'top_of_mind_comparison',
  'image description':'image_description','audio transcription':'audio_transcription',
};
const numeric=(n:unknown)=>typeof n==='number'&&Number.isFinite(n)&&n>=0?n:null;
/** Numeric usage only. Unknown billing is never silently counted as free.
 * Stage/provider dimensions remain low-cardinality; no IDs, model output,
 * prompt, arbitrary label, error body or credential is accepted into logs. */
export function recordModelUsage(provider:'openrouter'|'gemini'|'openai',label:string,body:unknown,durationMs:number,outcome:'received'|'http_error'|'unknown',details?:{model:string;reasoning:'low'|'medium';result:string}){
  if (outcome !== 'received') recordOperationalFault('provider_failure');
  const stage=['development','dev','production','local','test'].includes(process.env.WAKA_STAGE??'')?process.env.WAKA_STAGE!:'other';
  const data=body&&typeof body==='object'?body as Record<string,unknown>:{};
  const raw=provider==='gemini'?data.usageMetadata:data.usage;
  const usage=raw&&typeof raw==='object'?raw as Record<string,unknown>:{};
  const cost=provider==='openrouter'?numeric(usage.cost):null;
  const input=numeric(provider==='gemini'?usage.promptTokenCount:(usage.prompt_tokens??usage.input_tokens));
  const output=numeric(provider==='gemini'?usage.candidatesTokenCount:(usage.completion_tokens??usage.output_tokens));
  if(provider==='openai'){
    const cached=usage.input_tokens_details&&typeof usage.input_tokens_details==='object'?usage.input_tokens_details as Record<string,unknown>:{};
    const reasoning=usage.output_tokens_details&&typeof usage.output_tokens_details==='object'?usage.output_tokens_details as Record<string,unknown>:{};
    const results=['http_error','invalid_envelope','model_mismatch','incomplete','refused','invalid_json','json_decoded','transport_or_envelope_failure'];
    // Log only: a third Provider value in EMF would create new paid series.
    emitOperationalMetric({event:'model_usage',Stage:stage,Provider:'openai',operation:operations[label]??'other',outcome,
      model:details&&['gpt-6.1-terra','gpt-6.1-sol'].includes(details.model)?details.model:'other',reasoning:details&&['low','medium'].includes(details.reasoning)?details.reasoning:'unknown',
      result:details&&results.includes(details.result)?details.result:'unknown',ModelRequests:1,UnpricedRequests:1,costStatus:'unknown',
      inputTokens:input,outputTokens:output,cachedInputTokens:numeric(cached.cached_tokens),reasoningTokens:numeric(reasoning.reasoning_tokens),durationMs:numeric(durationMs)});
    return;
  }
  emitOperationalMetric({
    _aws:{Timestamp:Date.now(),CloudWatchMetrics:[{Namespace:'WAKA/ModelUsage',Dimensions:[['Stage','Provider']],Metrics:[
      {Name:'ModelRequests',Unit:'Count'},{Name:'UnpricedRequests',Unit:'Count'},...(cost!==null?[{Name:'CostUsd',Unit:'None'}]:[])]}]},
    event:'model_usage',Stage:stage,Provider:provider,operation:operations[label]??'other',outcome,
    ModelRequests:1,UnpricedRequests:cost===null?1:0,...(cost!==null?{CostUsd:cost}:{}),
    inputTokens:input,outputTokens:output,durationMs:numeric(durationMs),
  });
}
