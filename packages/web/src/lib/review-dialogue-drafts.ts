import {profileStorageKey,type ProfileStorageScope} from './profile-storage';
import type {ApiReviewAnswer,ApiReviewDialogue,ApiReviewQuestion} from './api';

export interface ReviewDialogueDraft {
  id:string;writer:string;updatedAt:number;submitted:boolean;kind:'create'|'edit'|'remove';
  answerId:string;revision:number;questionJobId:string|null;contextHash:string|null;
  answer:string;
}
export interface StoredReviewDraft {key:string;raw:string;value:ReviewDialogueDraft}
const uuid=(value:unknown)=>typeof value==='string'&&/^[0-9a-f-]{36}$/i.test(value);
const prefix=(scope:ProfileStorageScope,id:string)=>profileStorageKey(scope,`reviewDialogue:${id}:`)!;
function valid(row:ReviewDialogueDraft){return row&&uuid(row.id)&&uuid(row.writer)&&uuid(row.answerId)&&Number.isFinite(row.updatedAt)&&typeof row.submitted==='boolean'&&
  ['create','edit','remove'].includes(row.kind)&&Number.isInteger(row.revision)&&row.revision>=0&&typeof row.answer==='string'&&row.answer.length<=16000&&
  (row.kind!=='create'||(uuid(row.questionJobId)&&typeof row.contextHash==='string'&&/^[a-f0-9]{64}$/.test(row.contextHash)));}
export function readReviewDrafts(scope:ProfileStorageScope,id:string):StoredReviewDraft[]{
  const start=prefix(scope,id),rows:StoredReviewDraft[]=[];
  for(const key of Object.keys(localStorage).filter(key=>key.startsWith(start))){
    const raw=localStorage.getItem(key)!;const value=JSON.parse(raw) as ReviewDialogueDraft;
    if(!valid(value)||key!==start+value.id)throw new Error('Unreadable review draft');
    rows.push({key,raw,value});
  }
  return rows.sort((a,b)=>Number(b.value.submitted)-Number(a.value.submitted)||a.value.updatedAt-b.value.updatedAt||a.key.localeCompare(b.key));
}
export function storeReviewDraft(scope:ProfileStorageScope,id:string,value:ReviewDialogueDraft,previous?:StoredReviewDraft):StoredReviewDraft{
  if(!valid(value))throw new Error('Invalid review draft');
  const key=prefix(scope,id)+value.id,raw=JSON.stringify(value);
  const existing=localStorage.getItem(key);
  if(existing!==null&&(previous?.key!==key||existing!==previous.raw))throw new Error('Review draft changed elsewhere');
  localStorage.setItem(key,raw);if(localStorage.getItem(key)!==raw)throw new Error('Review draft was not kept');
  return {key,raw,value};
}
/** Never clear another tab's newer draft. Each mounted writer forks restored
 * drafts before editing, so typing in two tabs has distinct storage keys. */
export function clearReviewDraft(row:StoredReviewDraft){if(localStorage.getItem(row.key)===row.raw)localStorage.removeItem(row.key);}
export function recoverReviewDraftStorage(scope:ProfileStorageScope,id:string){
  const start=prefix(scope,id);
  for(const key of Object.keys(localStorage).filter(key=>key.startsWith(start))){
    const raw=localStorage.getItem(key);if(raw===null)continue;
    try{const value=JSON.parse(raw) as ReviewDialogueDraft;if(valid(value)&&key===start+value.id)continue;}catch{/* preserve the unreadable bytes below */}
    const backup=profileStorageKey(scope,`reviewDialogueRecovery:${id}:${crypto.randomUUID()}`)!;
    localStorage.setItem(backup,raw);if(localStorage.getItem(backup)!==raw)throw new Error('Recovery failed');
    if(localStorage.getItem(key)===raw)localStorage.removeItem(key);
  }
}
export function newReviewDraft(writer:string,question:Extract<ApiReviewQuestion,{phase:'ready'}>):ReviewDialogueDraft{
  const id=crypto.randomUUID();return {id,writer,answerId:id,revision:0,updatedAt:Date.now(),submitted:false,kind:'create',
    questionJobId:question.jobId,contextHash:question.contextHash,answer:''};
}
export function editReviewDraft(writer:string,answer:ApiReviewAnswer,kind:'edit'|'remove'):ReviewDialogueDraft{return {id:crypto.randomUUID(),writer,answerId:answer.id,revision:answer.revision,
  updatedAt:Date.now(),submitted:false,kind,questionJobId:null,contextHash:null,answer:answer.answer};}
export function reviewDraftObserved(draft:ReviewDialogueDraft,state:ApiReviewDialogue){
  if(!draft.submitted)return false;
  const answer=state.answers.find(row=>row.id===draft.answerId);
  if(draft.kind==='remove')return !answer;
  if(draft.kind==='create')return Boolean(answer);
  return Boolean(answer&&answer.revision===draft.revision+1&&answer.answer===draft.answer.trim());
}
