import {profileStorageKey,type ProfileStorageScope} from './profile-storage';
import type {ArtifactAppearance,ArtifactFormat} from './principle-artifact';
export interface PrincipleArtifactDraft {
  id:string;writer:string;updatedAt:number;appearance:ArtifactAppearance;format:ArtifactFormat;showName:boolean;
  entries:Array<{principleId:string;text:string;originalStatement:string}>;
  mode?:'card'|'change';beforeStatementId?:string|null;
}
export interface StoredPrincipleArtifactDraft {key:string;raw:string;value:PrincipleArtifactDraft}
const uuid=(value:unknown)=>typeof value==='string'&&/^[0-9a-f-]{36}$/i.test(value);
const prefix=(scope:ProfileStorageScope,principleId:string)=>profileStorageKey(scope,`principleArtifact:${principleId}:`)!;
function valid(row:PrincipleArtifactDraft){return row&&uuid(row.id)&&uuid(row.writer)&&Number.isFinite(row.updatedAt)&&
  ['dark','light'].includes(row.appearance)&&['square','portrait'].includes(row.format)&&typeof row.showName==='boolean'&&
  (row.mode===undefined||row.mode==='card'||row.mode==='change')&&(row.beforeStatementId==null||uuid(row.beforeStatementId))&&
  Array.isArray(row.entries)&&row.entries.length>0&&row.entries.length<=3&&new Set(row.entries.map(item=>item.principleId)).size===row.entries.length&&
  row.entries.every(item=>uuid(item.principleId)&&typeof item.text==='string'&&item.text.length<=2000&&typeof item.originalStatement==='string'&&item.originalStatement.length<=2000);}
export function readPrincipleArtifactDrafts(scope:ProfileStorageScope,principleId:string):StoredPrincipleArtifactDraft[]{
  const start=prefix(scope,principleId),rows:StoredPrincipleArtifactDraft[]=[];
  for(const key of Object.keys(localStorage).filter(key=>key.startsWith(start))){
    const raw=localStorage.getItem(key)!;const value=JSON.parse(raw) as PrincipleArtifactDraft;
    if(!valid(value)||key!==start+value.id)throw new Error('Unreadable share draft');rows.push({key,raw,value});
  }
  return rows.sort((a,b)=>b.value.updatedAt-a.value.updatedAt||a.key.localeCompare(b.key));
}
/** Another tab wrote this key since this one last read it. A tab that hits it
    is sharing a writer id with another (a duplicated tab) and forks to its own. */
export class ShareDraftConflict extends Error{}
export function storePrincipleArtifactDraft(scope:ProfileStorageScope,principleId:string,value:PrincipleArtifactDraft,previous?:StoredPrincipleArtifactDraft):StoredPrincipleArtifactDraft{
  if(!valid(value))throw new Error('Invalid share draft');
  const key=prefix(scope,principleId)+value.id,raw=JSON.stringify(value),existing=localStorage.getItem(key);
  if(existing===raw)return {key,raw,value};
  if(existing!==null&&(previous?.key!==key||previous.raw!==existing))throw new ShareDraftConflict('Share draft changed elsewhere');
  localStorage.setItem(key,raw);if(localStorage.getItem(key)!==raw)throw new Error('Share draft was not kept');return {key,raw,value};
}
export function clearPrincipleArtifactDraft(row:StoredPrincipleArtifactDraft){if(localStorage.getItem(row.key)===row.raw)localStorage.removeItem(row.key);}
export function recoverPrincipleArtifactDrafts(scope:ProfileStorageScope,principleId:string){
  const start=prefix(scope,principleId);
  for(const key of Object.keys(localStorage).filter(key=>key.startsWith(start))){
    const raw=localStorage.getItem(key);if(raw===null)continue;
    try{const value=JSON.parse(raw) as PrincipleArtifactDraft;if(valid(value)&&key===start+value.id)continue;}catch{/* preserve unverified bytes */}
    const backup=profileStorageKey(scope,`principleArtifactRecovery:${crypto.randomUUID()}`)!;
    localStorage.setItem(backup,raw);if(localStorage.getItem(backup)!==raw)throw new Error('Share draft recovery failed');
    if(localStorage.getItem(key)===raw)localStorage.removeItem(key);
  }
}
