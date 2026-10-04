import {profileStorageKey,type ProfileStorageScope} from './profile-storage';
export interface ConversationDraft{id:string;writer:string;updatedAt:number;content:string;revision:number;pending:boolean}
export interface StoredConversationDraft{key:string;raw:string;value:ConversationDraft}
const prefix=(scope:ProfileStorageScope,id:string)=>profileStorageKey(scope,`conversation:${id}:draft:`)!;
const uuid=(value:unknown)=>typeof value==='string'&&/^[0-9a-f-]{36}$/i.test(value);
function valid(row:ConversationDraft){return row&&uuid(row.id)&&uuid(row.writer)&&Number.isFinite(row.updatedAt)&&typeof row.content==='string'&&row.content.length<=4000&&Number.isInteger(row.revision)&&row.revision>=0&&row.revision<=200&&typeof row.pending==='boolean';}
export function readConversationDrafts(scope:ProfileStorageScope,id:string){
  const start=prefix(scope,id);return Object.keys(localStorage).filter(key=>key.startsWith(start)).map(key=>{const raw=localStorage.getItem(key)!,value=JSON.parse(raw) as ConversationDraft;if(!valid(value)||key!==start+value.id)throw new Error('Unreadable conversation draft');return {key,raw,value};}).sort((a,b)=>b.value.updatedAt-a.value.updatedAt||a.key.localeCompare(b.key));
}
export function storeConversationDraft(scope:ProfileStorageScope,id:string,value:ConversationDraft,previous?:StoredConversationDraft){
  if(!valid(value))throw new Error('Invalid conversation draft');const key=prefix(scope,id)+value.id,raw=JSON.stringify(value),existing=localStorage.getItem(key);
  if(existing!==null&&existing!==raw&&(previous?.key!==key||previous.raw!==existing))throw new Error('Draft changed in another tab');
  localStorage.setItem(key,raw);if(localStorage.getItem(key)!==raw)throw new Error('Draft was not saved');return {key,raw,value};
}
export function clearConversationDraft(row:StoredConversationDraft){if(localStorage.getItem(row.key)===row.raw)localStorage.removeItem(row.key);}
export function clearConversationDrafts(scope:ProfileStorageScope,id:string){const start=prefix(scope,id);for(const key of Object.keys(localStorage).filter(key=>key.startsWith(start)))localStorage.removeItem(key);}
