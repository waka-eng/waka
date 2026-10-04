import {ApiError,apiPath,getJson,postJson,deleteJson} from './http';
export interface ApiConversationMessage{id:string;profileId:string;conversationId:string;position:number;role:'user'|'assistant';content:string;createdAt:string}
export interface ApiConversation{id:string;profileId:string;revision:number;createdAt:string;updatedAt:string;messages:ApiConversationMessage[]}
export interface ConversationSummary{id:string;profileId:string;revision:number;updatedAt:string;preview:string}
export interface ConversationContext{profileId:string;generationEnabled:false;principles:Array<{id:string;text:string;state:string;supportCurrent:boolean;truncated:boolean}>;reading:Array<{id:string;text:string;supportCurrent:boolean;truncated:boolean}>;inspirations:Array<{id:string;text:string;truncated:boolean}>}
const path=(profile:string,suffix='')=>apiPath(`/conversations${suffix}?profile=${encodeURIComponent(profile)}`);
const invalid=()=>new ApiError({status:200,code:'invalid_conversation',message:'Could not verify this conversation.'});
function checked(body:{conversation:ApiConversation;generationEnabled:boolean},profile:string,id:string){
  const row=body?.conversation;
  if(!row||row.id!==id||row.profileId!==profile||body.generationEnabled!==false||!Number.isSafeInteger(row.revision)||row.revision<0||row.revision>200||!Array.isArray(row.messages)||row.messages.length>200||
    row.messages.length!==row.revision||!Number.isFinite(Date.parse(row.createdAt))||!Number.isFinite(Date.parse(row.updatedAt))||row.messages.some((message,index)=>message.profileId!==profile||message.conversationId!==id||typeof message.id!=='string'||typeof message.content!=='string'||message.content.length>8000||message.position!==index+1||!['user','assistant'].includes(message.role)||!Number.isFinite(Date.parse(message.createdAt)))||new Set(row.messages.map(message=>message.id)).size!==row.messages.length)throw invalid();
  return row;
}
export async function listConversations(profile:string,signal?:AbortSignal){const body=await getJson<{profileId:string;conversations:ConversationSummary[]}>(path(profile),'Could not load conversations.',signal);if(body?.profileId!==profile||!Array.isArray(body.conversations)||body.conversations.length>100||body.conversations.some(row=>row.profileId!==profile||typeof row.id!=='string'||typeof row.preview!=='string'))throw invalid();return body.conversations;}
export async function fetchConversation(profile:string,id:string,signal?:AbortSignal){return checked(await getJson(path(profile,`/${encodeURIComponent(id)}`),'Could not open the conversation.',signal),profile,id);}
export async function createConversation(profile:string,id:string,signal?:AbortSignal){return checked(await postJson(path(profile),{id},'Could not start the conversation.',signal),profile,id);}
export async function saveConversationMessage(profile:string,id:string,input:{id:string;content:string;revision:number},signal?:AbortSignal){return checked(await postJson(path(profile,`/${encodeURIComponent(id)}/messages`),input,'Could not confirm this message. Check your saved messages before retrying.',signal),profile,id);}
export async function deleteConversation(profile:string,id:string,signal?:AbortSignal){const result=await deleteJson<{deleted:boolean}>(path(profile,`/${encodeURIComponent(id)}`),{},'Could not confirm deletion.',signal);if(result?.deleted!==true)throw invalid();}
export async function fetchConversationContext(profile:string,id:string,signal?:AbortSignal){
  const row=await getJson<ConversationContext>(path(profile,`/${encodeURIComponent(id)}/context`),'Could not read current memory.',signal);
  if(row?.profileId!==profile||row.generationEnabled!==false||![row.principles,row.reading,row.inspirations].every(Array.isArray)||row.principles.length>10||row.reading.length>5||row.inspirations.length>6)throw invalid();
  const memories=[...row.principles,...row.reading,...row.inspirations];
  if(memories.some(item=>typeof item.id!=='string'||typeof item.text!=='string'||item.text.length>1600||typeof item.truncated!=='boolean')||memories.reduce((sum,item)=>sum+item.text.length,0)>16000||[...row.principles,...row.reading].some(item=>typeof item.supportCurrent!=='boolean'))throw invalid();return row;
}
