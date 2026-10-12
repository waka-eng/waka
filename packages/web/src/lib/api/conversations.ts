import {ApiError,apiPath,deleteJson,getJson,patchJson,postJson} from './http';
export type ConversationSourceKind='principle'|'top_of_mind_entry'|'inspiration';
export interface ApiConversationMessage{id:string;profileId:string;conversationId:string;position:number;role:'user'|'assistant';content:string;createdAt:string;correctsMessageId?:string|null;savedInspirationIds?:string[];followUpQuestion?:string|null;memoryChanged?:boolean;replyRequestId?:string|null;citations?:Array<{index:number;kind:ConversationSourceKind;id:string;available:boolean;preview?:string;historical?:boolean;recordedAt?:string}>}
export interface ApiConversation{id:string;profileId:string;revision:number;createdAt:string;updatedAt:string;messages:ApiConversationMessage[];messageWindowStart?:number;preview?:string;generationEnabled?:boolean;initialPrinciple?:{id:string;statement:string;state:string}|null;
  /* WHAT THIS CONVERSATION IS PINNED TO. Founder: "user can pick an
     inspiration on the right ... and then when the user specifically brings
     that up then the agent can read it." The server pins it into the reply's
     sources rather than leaving it to semantic retrieval; see
     `conversation-context.ts`. Null is the ordinary case — WAKA reading from
     everything, which is what this product promises on its door. */
  initialInspiration?:{id:string;text:string}|null}
export interface ConversationSummary{id:string;profileId:string;revision:number;updatedAt:string;preview:string}
export interface ConversationReplyState{profileId:string;conversationId:string;messageId:string|null;requestId:string|null;phase:'idle'|'pending'|'running'|'ready'|'failed'|'stopped'|'stale';revision:number;failureCode:string|null;retryAfter:string|null;runAfter:string|null;canRetry:boolean;generationEnabled:boolean}
const path=(profile:string,suffix='')=>apiPath(`/conversations${suffix}?profile=${encodeURIComponent(profile)}`);
const windowPath=(profile:string,suffix:string,from?:number)=>path(profile,suffix)+(from!==undefined?`&from=${from}`:'&limit=30');
const legacyWindowRefusal=(error:unknown)=>error instanceof ApiError&&error.status===400&&error.message==='Invalid profile';
async function readWindow(profile:string,suffix:string,signal?:AbortSignal,from?:number){
  try{return await getJson<{conversation:ApiConversation;generationEnabled:boolean}>(windowPath(profile,suffix,from),'Could not open the conversation.',signal);}
  catch(error){if(!legacyWindowRefusal(error))throw error;return getJson<{conversation:ApiConversation;generationEnabled:boolean}>(path(profile,suffix),'Could not open the conversation.',signal);}
}
async function writeWindow(profile:string,suffix:string,body:unknown,message:string,signal?:AbortSignal,from?:number){
  try{return await postJson<{conversation:ApiConversation;generationEnabled:boolean}>(windowPath(profile,suffix,from),body,message,signal);}
  catch(error){if(!legacyWindowRefusal(error))throw error;return postJson<{conversation:ApiConversation;generationEnabled:boolean}>(path(profile,suffix),body,message,signal);}
}
const invalid=()=>new ApiError({status:200,code:'invalid_conversation',message:'Could not verify this conversation.'});
const historicalMetadataValid=(row:{historical?:boolean;recordedAt?:string})=>(row.historical===undefined||typeof row.historical==='boolean')&&
  (row.recordedAt===undefined||typeof row.recordedAt==='string'&&Number.isFinite(Date.parse(row.recordedAt)))&&
  (row.historical!==true||typeof row.recordedAt==='string'&&Number.isFinite(Date.parse(row.recordedAt)));
function checked(body:{conversation:ApiConversation;generationEnabled:boolean},profile:string,id:string){
  const row=body?.conversation;
  const start=row?.messageWindowStart??1;
  if(row?.messageWindowStart!==undefined&&!Number.isSafeInteger(row.messageWindowStart)||!Number.isSafeInteger(start)||start<1||start>Math.max(1,row?.revision??0)||row?.preview!==undefined&&(typeof row.preview!=='string'||row.preview.length>120))throw invalid();
  if(!row||row.id!==id||row.profileId!==profile||typeof body.generationEnabled!=='boolean'||!Number.isSafeInteger(row.revision)||row.revision<0||row.revision>200||!Array.isArray(row.messages)||row.messages.length>200||
    row.messages.length!==(row.revision?row.revision-start+1:0)||!Number.isFinite(Date.parse(row.createdAt))||!Number.isFinite(Date.parse(row.updatedAt))||row.messages.some((message,index)=>message.profileId!==profile||message.conversationId!==id||typeof message.id!=='string'||typeof message.content!=='string'||message.content.length>8000||message.position!==start+index||!['user','assistant'].includes(message.role)||!Number.isFinite(Date.parse(message.createdAt)))||new Set(row.messages.map(message=>message.id)).size!==row.messages.length)throw invalid();
  if(row.messages.some(message=>message.followUpQuestion!=null&&typeof message.followUpQuestion!=='string'||message.memoryChanged!==undefined&&typeof message.memoryChanged!=='boolean'||message.citations!==undefined&&(!Array.isArray(message.citations)||message.citations.length>3||message.citations.some(citation=>!['principle','top_of_mind_entry','inspiration'].includes(citation.kind)||typeof citation.id!=='string'||!Number.isInteger(citation.index)||citation.index<0||citation.index>2||typeof citation.available!=='boolean'))))throw invalid();
  if(row.messages.some(message=>message.citations?.some(citation=>citation.preview!==undefined&&(typeof citation.preview!=='string'||citation.preview.length>96||!citation.available))))throw invalid();
  if(row.messages.some(message=>message.citations?.some(reference=>!historicalMetadataValid(reference))))throw invalid();
  return {...row,generationEnabled:body.generationEnabled};
}
export async function listConversations(profile:string,signal?:AbortSignal){const body=await getJson<{profileId:string;conversations:ConversationSummary[];generationEnabled:boolean}>(path(profile),'Could not load conversations.',signal);if(body?.profileId!==profile||typeof body.generationEnabled!=='boolean'||!Array.isArray(body.conversations)||body.conversations.length>100||body.conversations.some(row=>row.profileId!==profile||typeof row.id!=='string'||typeof row.preview!=='string'))throw invalid();return body;}
export async function fetchConversation(profile:string,id:string,signal?:AbortSignal,from?:number){return checked(await readWindow(profile,`/${encodeURIComponent(id)}`,signal,from),profile,id);}
export async function createConversation(profile:string,id:string,signal?:AbortSignal,principleId?:string,firstMessage?:{id:string;content:string;requestReply?:boolean}){return checked(await writeWindow(profile,'',{id,...(principleId?{principleId}:{}),...(firstMessage?{firstMessage}:{})},'Could not start the conversation.',signal),profile,id);}
/* ═══ CHANGING WHAT A CONVERSATION IS ABOUT ═════════════════════════════
   Founder: "let the user switch inspirations while chatting about it."
   `null` clears the pin and returns the reply to reading from everything.
   Owner-scoped like every other write here; the server's composite foreign
   key is what makes pinning another profile's keep structurally impossible
   rather than merely checked. */
export async function pinConversationInspiration(profile:string,id:string,inspirationId:string|null,signal?:AbortSignal){
  return checked(await patchJson(path(profile,`/${encodeURIComponent(id)}`),{inspirationId},'Could not change what this conversation is about.',signal),profile,id);
}
export async function saveConversationMessage(profile:string,id:string,input:{id:string;content:string;revision:number;requestReply?:boolean;correctsMessageId?:string},signal?:AbortSignal,from?:number){return checked(await writeWindow(profile,`/${encodeURIComponent(id)}/messages`,input,'Could not confirm this message. Check your saved messages before retrying.',signal,from),profile,id);}
/* DELETING A CONVERSATION LEFT WITH THE `···` MENU IT WAS HIDDEN IN.
 * Founder on the surface that held it: "so many different buttons that I have
 * no idea what its supposed to do."
 *
 * IT IS BACK, AND IT IS WHERE THAT NOTE SAID TO PUT IT. The removal was
 * right and so was the reason: the only thing calling it was a `···` menu
 * inside the conversation you were reading, where "delete" sits one slip away
 * from "send". What it was waiting for was a LIST of conversations to sit
 * beside, and that list now exists — `components/ConversationsOverlay`, one
 * of the three things the left corner opens over the world.
 *
 * So the verb has a row to belong to and `createConversation` has its partner
 * again (`test/verb-pairs.test.ts`). Soft delete on the server: the row keeps
 * its `deletedAt` and stops being listed, because fading never deletes. */
/* WHAT THE REPLY WAS ALLOWED TO READ (`fetchConversationContext`) AND THE
 * QUOTE BEHIND A FOOTNOTE (`fetchConversationCitation`) WENT WITH THEIR TWO
 * SURFACES: the "Your memory" sheet and the references list under each reply.
 * Both answered a question about generation rather than about the
 * conversation, and both are described at length in `ConversationPanel`'s
 * header. The routes remain on the server. `historicalMetadataValid` stays
 * because saved messages still carry citation metadata on the wire and it is
 * still checked before anything is believed. */
function checkedReply(row:ConversationReplyState,profile:string,id:string){if(!row||row.profileId!==profile||row.conversationId!==id||!['idle','pending','running','ready','failed','stopped','stale'].includes(row.phase)||!Number.isSafeInteger(row.revision)||typeof row.canRetry!=='boolean'||typeof row.generationEnabled!=='boolean'||![row.retryAfter,row.runAfter].every(value=>value===null||Number.isFinite(Date.parse(value)))||![row.messageId,row.requestId].every(value=>value===null||typeof value==='string'))throw invalid();return row;}
export async function fetchConversationReply(profile:string,id:string,signal?:AbortSignal){return checkedReply(await getJson(path(profile,`/${encodeURIComponent(id)}/reply`),'Could not check the reply.',signal),profile,id);}
/* ASKING FOR THE REPLY AGAIN (`requestConversationReply`) IS GONE. A reply
 * is requested once, by the act of sending the message; "Retry reply", "Get a
 * reply" and "Check reply" were three buttons for re-running the generator and
 * the founder could not tell what any of them did. A reply that fails still
 * says so in a sentence; saying something again is how you ask again. */
/* Erasing one, from the list it is listed in. The server soft-deletes, so
   this is the end of the conversation being OFFERED rather than the end of
   its existence — and it reports failure rather than swallowing it, because
   a row that silently stays is a person pressing delete twice. */
export async function deleteConversation(profile:string,id:string,signal?:AbortSignal){
  await deleteJson<{deleted:boolean}>(path(profile,`/${encodeURIComponent(id)}`),{},'Could not delete this conversation.',signal);
}
export async function stopConversationReply(profile:string,id:string,requestId:string,signal?:AbortSignal){return checkedReply(await postJson(path(profile,`/${encodeURIComponent(id)}/replies/${encodeURIComponent(requestId)}/stop`),{},'Could not confirm stopping.',signal),profile,id);}
