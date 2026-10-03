import {ApiError,apiPath,getJson,postJson} from './http';
import type {ApiTopOfMindRefreshResult} from './top-of-mind';
export interface ApiReviewProcessing {
  profileId:string;sessionId:string;phase:'empty'|'pending'|'ready'|'needs_context'|'failed';
  answerCount:number;completedCount:number;canRetry:boolean;runAfter:string|null;result:ApiTopOfMindRefreshResult|null;
  relatedPrinciples:Array<{id:string;statement:string}>;
}
function checked(row:ApiReviewProcessing,profileId:string,sessionId:string){
  const result=row?.result;
  if(!row||row.profileId!==profileId||row.sessionId!==sessionId||!['empty','pending','ready','needs_context','failed'].includes(row.phase)||
    !Number.isSafeInteger(row.answerCount)||row.answerCount<0||!Number.isSafeInteger(row.completedCount)||row.completedCount<0||row.completedCount>row.answerCount||
    typeof row.canRetry!=='boolean'||!(row.runAfter===null||Number.isFinite(Date.parse(row.runAfter)))||
    !Array.isArray(row.relatedPrinciples)||row.relatedPrinciples.length>3||row.relatedPrinciples.some(p=>!p||typeof p.id!=='string'||typeof p.statement!=='string')||
    (row.phase==='ready'&&(!result||row.completedCount!==row.answerCount))||
    (row.phase!=='ready'&&result!==null)||
    (result&&(result.kind!=='top_of_mind'||!['changed','unchanged','empty'].includes(result.outcome)||!Number.isSafeInteger(result.version)||
      (result.topOfMindId===null?result.version!==0||result.outcome!=='empty':typeof result.topOfMindId!=='string'||! /^[0-9a-f-]{36}$/i.test(result.topOfMindId)||result.version<1)))){
    throw new ApiError({status:200,code:'invalid_review_processing',message:'Could not verify this review result'});
  }
  return row;
}
const path=(id:string,profileId:string,retry=false)=>apiPath(`/review-sessions/${encodeURIComponent(id)}/processing${retry?'/retry':''}?profile=${encodeURIComponent(profileId)}`);
export async function fetchReviewProcessing(id:string,profileId:string,signal?:AbortSignal){return checked(await getJson<ApiReviewProcessing>(path(id,profileId),'Could not check the review result',signal),profileId,id);}
export async function retryReviewProcessing(id:string,profileId:string,signal?:AbortSignal){return checked(await postJson<ApiReviewProcessing>(path(id,profileId,true),{},'Could not resume this reading',signal),profileId,id);}
