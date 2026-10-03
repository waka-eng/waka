import {ApiError,apiPath,getJson,postJson} from './http';

export interface ApiReviewItem {
  inspirationId:string;position:number;sourceRevision:string;currentRevision:string;sourceChanged:boolean;
  reason:'unreviewed'|'revisit'|'chosen';choice:'keep'|'skip'|null;decidedAt:string|null;inspirationCreatedAt:string;
}
export interface ApiReviewSession {
  id:string;profileId:string;revision:number;cursor:number;currentInspirationId:string|null;
  createdAt:string;completedAt:string|null;items:ApiReviewItem[];
}
export interface ReviewChoiceInput {revision:number;inspirationId:string;sourceRevision:string;choice:'keep'|'skip'|null}
const uuid=(value:unknown)=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
function checked(body:{session:ApiReviewSession|null},profileId:string,id?:string){
  const row=body?.session;
  if(row===null&&!id) return null;
  if(!row || !uuid(row.id) || (id && row.id!==id) || row.profileId!==profileId || !Number.isSafeInteger(row.revision) || row.revision<0 ||
    !Number.isInteger(row.cursor) || row.cursor<0 || row.cursor>5 || !Array.isArray(row.items) || row.items.length>5 ||
    !Number.isFinite(Date.parse(row.createdAt)) || !(row.completedAt===null||Number.isFinite(Date.parse(row.completedAt))) ||
    row.items.some(item=>!uuid(item.inspirationId)||!Number.isInteger(item.position)||item.position<0||item.position>4||
      !/^[1-9]\d{0,18}$/.test(item.sourceRevision)||!/^[1-9]\d{0,18}$/.test(item.currentRevision)||typeof item.sourceChanged!=='boolean'||
      !['unreviewed','revisit','chosen'].includes(item.reason)||![null,'keep','skip'].includes(item.choice)||!Number.isFinite(Date.parse(item.inspirationCreatedAt))) ||
    new Set(row.items.map(item=>item.inspirationId)).size!==row.items.length || new Set(row.items.map(item=>item.position)).size!==row.items.length ||
    (row.currentInspirationId!==null&&!row.items.some(item=>item.inspirationId===row.currentInspirationId))) {
    throw new ApiError({status:200,code:'invalid_review',message:'Could not verify this review'});
  }
  return row;
}
const path=(suffix:string,profileId:string)=>apiPath(`/review-sessions${suffix}?profile=${encodeURIComponent(profileId)}`);
export async function fetchActiveReview(profileId:string,signal?:AbortSignal){return checked(await getJson<{session:ApiReviewSession|null}>(path('/active',profileId),'Could not load the review',signal),profileId);}
export async function fetchReviewSession(id:string,profileId:string,signal?:AbortSignal){return checked(await getJson<{session:ApiReviewSession|null}>(path(`/${encodeURIComponent(id)}`,profileId),'Could not load the review',signal),profileId,id);}
export async function startReviewSession(input:{id:string;inspirationIds?:string[]},profileId:string,signal?:AbortSignal){return checked(await postJson<{session:ApiReviewSession|null}>(path('',profileId),input,'Could not start the review',signal),profileId);}
export async function chooseReviewInspiration(id:string,input:ReviewChoiceInput,profileId:string,signal?:AbortSignal){return checked(await postJson<{session:ApiReviewSession|null}>(path(`/${encodeURIComponent(id)}/choices`,profileId),input,'Could not keep the review choice',signal),profileId,id);}
export async function finishReviewSession(id:string,revision:number,profileId:string,signal?:AbortSignal){return checked(await postJson<{session:ApiReviewSession|null}>(path(`/${encodeURIComponent(id)}/complete`,profileId),{revision},'Could not finish the review',signal),profileId,id);}
