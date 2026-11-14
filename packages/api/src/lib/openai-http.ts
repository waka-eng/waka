import { fetchModelWithTimeout } from './gemini-http.js';
import { MODEL_DECLINED } from './model-provider.js';
import { recordModelUsage } from './model-usage.js';
import { ModelConfigurationError,nativeGptTask, type GptTask } from './model-routing.js';
import { toJsonSchema, type GeminiShapedRequest } from './generation-schema.js';

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
export type OpenAiInput = Array<{role:'system'|'user';content:Array<
  {type:'input_text';text:string}|{type:'input_image';image_url:string;detail:'auto'}>}>
export interface OpenAiRequest {
  model:string; store:false; stream:false; input:OpenAiInput;
  reasoning:{effort:'low'|'medium'}; max_output_tokens:number;
  text:{format:{type:'json_object'}|{type:'json_schema';name:string;strict:true;schema:Record<string,unknown>}};
}
export function openAiRequest(task:GptTask, input:OpenAiInput, schemaName:string,
  schema:Parameters<typeof toJsonSchema>[0]|undefined, maxOutputTokens=8192, jsonObject=false):OpenAiRequest {
  const config=nativeGptTask(task);
  // Root anyOf is outside the strict root-object contract. The unchanged task
  // parser still enforces the conditional Review question shape in JSON mode.
  const format=jsonObject||!schema||schema.anyOf
    ?{type:'json_object' as const}
    :{type:'json_schema' as const,name:schemaName,strict:true as const,schema:toJsonSchema(schema,true)};
  // JSON mode requires an explicit JSON instruction. This encodes the existing
  // responseMimeType contract without changing the source/user prompt words.
  const formattedInput=format.type==='json_object'
    ?[{role:'system' as const,content:[{type:'input_text' as const,text:'Return only valid JSON.'}]},...input]:input;
  return {model:config.model,store:false,stream:false,input:formattedInput,reasoning:{effort:config.effort},
    max_output_tokens:maxOutputTokens,text:{format}};
}
export function openAiTextRequest(task:GptTask, request:GeminiShapedRequest, schemaName:string):OpenAiRequest {
  const input:OpenAiInput=[];
  const system=(request.systemInstruction?.parts??[]).map(p=>p.text).join('\n').trim();
  if(system)input.push({role:'system',content:[{type:'input_text',text:system}]});
  input.push({role:'user',content:[{type:'input_text',text:request.contents.flatMap(c=>c.parts.map(p=>p.text)).join('\n').trim()}]});
  return openAiRequest(task,input,schemaName,request.generationConfig.responseSchema,
    request.generationConfig.maxOutputTokens??8192,task==='chat');
}
export class OpenAiHttpError extends Error {
  constructor(readonly status:number){super(`OpenAI request failed (HTTP ${status})`);this.name='OpenAiHttpError';}
}
const object=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
/** One stateless attempt. No stored response/history/tools, provider fallback or
 * internal retry. Only known numeric usage and closed outcomes reach logs. */
export async function callOpenAi(request:OpenAiRequest,label:string,options:{apiKey?:string;fetchFn?:typeof fetch}={}) {
  const allowed=new Set(['model','store','stream','input','reasoning','max_output_tokens','text']);
  if(!['gpt-6.1-terra','gpt-6.1-sol'].includes(request.model)||Object.keys(request).some(k=>!allowed.has(k))||
    request.store!==false||request.stream!==false||!['low','medium'].includes(request.reasoning?.effort)||
    !Number.isInteger(request.max_output_tokens)||request.max_output_tokens<1||request.max_output_tokens>8192){
    throw new ModelConfigurationError('Native OpenAI request configuration is unsafe');
  }
  const key=options.apiKey??process.env.OPENAI_API_KEY?.trim();
  if(!key)throw new ModelConfigurationError('Selected OpenAI provider requires OPENAI_API_KEY');
  const started=performance.now();let raw:unknown=null;let recorded=false;
  const usage=(outcome:'received'|'http_error'|'unknown',result:string)=>{
    recordModelUsage('openai',label,raw,performance.now()-started,outcome,
      {model:request.model,reasoning:request.reasoning.effort,result});recorded=true;
  };
  try{
    const response=await fetchModelWithTimeout(options.fetchFn??fetch,OPENAI_RESPONSES_URL,{
      method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${key}`},body:JSON.stringify(request),
    });
    if(!response.ok){usage('http_error','http_error');throw new OpenAiHttpError(response.status);}
    try{raw=await response.json();}catch{usage('unknown','invalid_envelope');throw new Error('OpenAI response JSON could not be decoded');}
    if(!object(raw)||!Array.isArray(raw.output)||raw.output.length>32||raw.error){usage('unknown','invalid_envelope');throw new Error('OpenAI response envelope was invalid');}
    const model=raw.model;
    if(typeof model!=='string'||!(model===request.model||new RegExp('^'+request.model.replaceAll('.','\\.')+'-\\d{4}-\\d{2}-\\d{2}$').test(model))){usage('unknown','model_mismatch');throw new Error('OpenAI response model did not match the selected model');}
    if(raw.status!=='completed'){usage('unknown','incomplete');throw new Error('OpenAI response did not complete');}
    let text='';let messages=0;
    for(const item of raw.output){
      if(!object(item))throw new Error('OpenAI output item was invalid');
      if(item.type==='reasoning')continue; // Never persist or replay reasoning items.
      if(item.type!=='message'||item.role!=='assistant'||item.status!==undefined&&item.status!=='completed'||!Array.isArray(item.content)||item.content.length>16)throw new Error('OpenAI output type was unexpected');
      messages++;
      for(const part of item.content){
        if(object(part)&&part.type==='refusal'){usage('received','refused');return MODEL_DECLINED;}
        if(!object(part)||part.type!=='output_text'||typeof part.text!=='string')throw new Error('OpenAI output content was invalid');
        text+=part.text;if(text.length>65536)throw new Error('OpenAI output exceeded the response bound');
      }
    }
    if(messages!==1||!text.trim())throw new Error('OpenAI response had no single answer');
    let payload:unknown;try{payload=JSON.parse(text);}catch{usage('unknown','invalid_json');throw new Error('OpenAI answer was not valid JSON');}
    usage('received','json_decoded');return payload;
  }catch(error){if(!recorded)usage('unknown','transport_or_envelope_failure');throw error;}
}
