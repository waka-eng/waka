import {ApiError,apiPath,getJson,postJson,patchJson,deleteJson} from './http';

export interface ApiReviewAnswer {
  id:string;revision:number;question:string|null;connection:string|null;answer:string;contextValid:boolean;
  createdAt:string;updatedAt:string;
  sources:Array<{inspirationId:string;sourceRevision:string;currentRevision:string;referenced:boolean}>;
}
export type ApiReviewQuestion={phase:'empty'|'closed'}|{phase:'idle'|'processing'|'failed';retryAfter:string|null;runAfter?:string|null}|
  {phase:'ready';jobId:string;question:string;connection:string|null;sourceIds:string[];contextHash:string;retryAfter:string|null};
export interface ApiReviewDialogue {profileId:string;sessionId:string;revision:number;answers:ApiReviewAnswer[];latestAnswerId?:string|null;historyChanged?:boolean;question:ApiReviewQuestion}
export interface ReviewAnswerInput {id:string;questionJobId:string;contextHash:string;answer:string}
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const date=(value:unknown)=>typeof value==='string'&&Number.isFinite(Date.parse(value));
const nullableText=(value:unknown)=>value===null||typeof value==='string';
function checked(row:ApiReviewDialogue,id:string,profileId:string){
  const q=row?.question;
  if(!row||row.sessionId!==id||row.profileId!==profileId||!Number.isSafeInteger(row.revision)||row.revision<0||!Array.isArray(row.answers)||
    row.answers.some(a=>!a||!uuid(a.id)||!Number.isSafeInteger(a.revision)||a.revision<1||typeof a.answer!=='string'||!a.answer.trim()||a.answer.length>16000||
      !nullableText(a.question)||!nullableText(a.connection)||typeof a.contextValid!=='boolean'||(!a.contextValid&&(a.question!==null||a.connection!==null))||!date(a.createdAt)||!date(a.updatedAt)||
      !Array.isArray(a.sources)||a.sources.length>5||a.sources.some(s=>!s||!uuid(s.inspirationId)||typeof s.referenced!=='boolean'||!(/^[1-9]\d{0,18}$/.test(s.sourceRevision))||!(/^[1-9]\d{0,18}$/.test(s.currentRevision))))||
    new Set(row.answers.map(a=>a.id)).size!==row.answers.length||!q||!['empty','closed','idle','processing','failed','ready'].includes(q.phase)||
    (row.latestAnswerId!==undefined&&row.latestAnswerId!==null&&!row.answers.some(a=>a.id===row.latestAnswerId))||
    ('retryAfter' in q&&q.retryAfter!==null&&!date(q.retryAfter))||('runAfter' in q&&q.runAfter!==null&&!date(q.runAfter))||
    (q.phase==='ready'&&(!uuid(q.jobId)||typeof q.question!=='string'||!q.question.trim()||!nullableText(q.connection)||!/^[a-f0-9]{64}$/.test(q.contextHash)||
      !Array.isArray(q.sourceIds)||!q.sourceIds.length||q.sourceIds.length>5||q.sourceIds.some(id=>!uuid(id))||new Set(q.sourceIds).size!==q.sourceIds.length)))
    throw new ApiError({status:200,code:'invalid_review_dialogue',message:'Could not verify this review conversation'});
  return row;
}
const path=(id:string,profileId:string,suffix:string)=>apiPath(`/review-sessions/${encodeURIComponent(id)}${suffix}?profile=${encodeURIComponent(profileId)}`);
export async function fetchReviewDialogue(id:string,profileId:string,signal?:AbortSignal){return checked(await getJson<ApiReviewDialogue>(path(id,profileId,'/dialogue'),'Could not open your thoughts',signal),id,profileId);}
export async function requestReviewQuestion(id:string,profileId:string,afterAnswerId:string|null,retry=false,signal?:AbortSignal){return checked(await postJson<ApiReviewDialogue>(path(id,profileId,'/question'),{afterAnswerId,retry},'Could not find the next question',signal),id,profileId);}
export async function saveReviewAnswer(id:string,profileId:string,input:ReviewAnswerInput,signal?:AbortSignal){return checked(await postJson<ApiReviewDialogue>(path(id,profileId,'/answers'),input,'Could not keep your thought',signal),id,profileId);}
export async function editReviewAnswer(id:string,profileId:string,answerId:string,input:{revision:number;answer:string},signal?:AbortSignal){return checked(await patchJson<ApiReviewDialogue>(path(id,profileId,`/answers/${encodeURIComponent(answerId)}`),input,'Could not update your thought',signal),id,profileId);}
export async function removeReviewAnswer(id:string,profileId:string,answerId:string,revision:number,signal?:AbortSignal){return checked(await deleteJson<ApiReviewDialogue>(path(id,profileId,`/answers/${encodeURIComponent(answerId)}`),{revision},'Could not remove your thought',signal),id,profileId);}
