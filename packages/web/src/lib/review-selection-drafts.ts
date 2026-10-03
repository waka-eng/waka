import {profileStorageKey,type ProfileStorageScope} from './profile-storage';

export interface ReviewSelectionDraft {id:string;writer:string;ids:string[];query:string;updatedAt:number}
export interface ReviewSelectionReceipt {id:string;raw:string}
export interface StoredReviewSelection extends ReviewSelectionReceipt {value:ReviewSelectionDraft}
const uuid=(value:unknown)=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const prefix=(scope:ProfileStorageScope)=>profileStorageKey(scope,'reviewSelection:')!;
function valid(value:ReviewSelectionDraft){return value&&uuid(value.id)&&uuid(value.writer)&&Number.isFinite(value.updatedAt)&&typeof value.query==='string'&&value.query.length<=512&&
  Array.isArray(value.ids)&&value.ids.length<=5&&value.ids.every(uuid)&&new Set(value.ids).size===value.ids.length;}
export function readReviewSelections(scope:ProfileStorageScope):StoredReviewSelection[]{
  const start=prefix(scope),rows:StoredReviewSelection[]=[];
  for(const key of Object.keys(localStorage).filter(key=>key.startsWith(start))){
    const raw=localStorage.getItem(key)!;const value=JSON.parse(raw) as ReviewSelectionDraft;
    if(!valid(value)||key!==start+value.id)throw new Error('Unreadable review selection');
    rows.push({id:value.id,raw,value});
  }
  return rows.sort((a,b)=>b.value.updatedAt-a.value.updatedAt||a.id.localeCompare(b.id));
}
export function storeReviewSelection(scope:ProfileStorageScope,value:ReviewSelectionDraft,previous?:ReviewSelectionReceipt):StoredReviewSelection{
  if(!valid(value))throw new Error('Invalid review selection');
  const key=prefix(scope)+value.id,raw=JSON.stringify(value),existing=localStorage.getItem(key);
  if(existing!==null&&(previous?.id!==value.id||previous.raw!==existing))throw new Error('Review selection changed elsewhere');
  localStorage.setItem(key,raw);if(localStorage.getItem(key)!==raw)throw new Error('Review selection not kept');
  return {id:value.id,raw,value};
}
/** A consumed selection can only clear its exact snapshot under this owner. */
export function settleReviewSelection(scope:ProfileStorageScope,receipt:ReviewSelectionReceipt){
  if(!uuid(receipt.id))throw new Error('Invalid selection receipt');
  const key=prefix(scope)+receipt.id;if(localStorage.getItem(key)===receipt.raw)localStorage.removeItem(key);
}
export function recoverReviewSelections(scope:ProfileStorageScope){
  const start=prefix(scope);
  for(const key of Object.keys(localStorage).filter(key=>key.startsWith(start))){
    const raw=localStorage.getItem(key);if(raw===null)continue;
    try{const value=JSON.parse(raw) as ReviewSelectionDraft;if(valid(value)&&key===start+value.id)continue;}catch{/* retain unverified bytes */}
    const backup=profileStorageKey(scope,`reviewSelectionRecovery:${crypto.randomUUID()}`)!;
    localStorage.setItem(backup,raw);if(localStorage.getItem(backup)!==raw)throw new Error('Selection recovery failed');
    if(localStorage.getItem(key)===raw)localStorage.removeItem(key);
  }
}
