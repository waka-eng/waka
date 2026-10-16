import {profileStorageKey,type ProfileStorageScope} from './profile-storage';
export interface ConversationDraft{id:string;writer:string;updatedAt:number;content:string;revision:number;pending:boolean;correctsMessageId?:string;conversationId?:string;
  /** Whose memory a NEW chat answers from, kept with the first message so a reload re-sends it the same way. */
  talkWith?:'agent'|'both';
  /** Which agent `talkWith` names — kept with it, so a retried create asks
      for the same memory even if the agent shown has changed since. */
  agentId?:string}
export interface StoredConversationDraft{key:string;raw:string;value:ConversationDraft}
const prefix=(scope:ProfileStorageScope,id:string)=>profileStorageKey(scope,`conversation:${id}:draft:`)!;
const uuid=(value:unknown)=>typeof value==='string'&&/^[0-9a-f-]{36}$/i.test(value);
function valid(row:ConversationDraft,maxRevision=200){return row&&uuid(row.id)&&uuid(row.writer)&&Number.isFinite(row.updatedAt)&&typeof row.content==='string'&&row.content.length<=4000&&Number.isSafeInteger(row.revision)&&row.revision>=0&&row.revision<=maxRevision&&typeof row.pending==='boolean'&&(row.correctsMessageId===undefined||uuid(row.correctsMessageId))&&(row.conversationId===undefined||uuid(row.conversationId))&&(row.talkWith===undefined||row.talkWith==='agent'||row.talkWith==='both')&&(row.agentId===undefined||uuid(row.agentId));}
export function readConversationDrafts(scope:ProfileStorageScope,id:string){
  const start=prefix(scope,id);return Object.keys(localStorage).filter(key=>key.startsWith(start)).map(key=>{const raw=localStorage.getItem(key)!,value=JSON.parse(raw) as ConversationDraft;if(!valid(value,id.startsWith('thought:')?Number.MAX_SAFE_INTEGER:200)||key!==start+value.id)throw new Error('Unreadable conversation draft');return {key,raw,value};}).sort((a,b)=>b.value.updatedAt-a.value.updatedAt||a.key.localeCompare(b.key));
}
export function storeConversationDraft(scope:ProfileStorageScope,id:string,value:ConversationDraft,previous?:StoredConversationDraft){
  if(!valid(value,id.startsWith('thought:')?Number.MAX_SAFE_INTEGER:200))throw new Error('Invalid conversation draft');const key=prefix(scope,id)+value.id,raw=JSON.stringify(value),existing=localStorage.getItem(key);
  if(existing!==null&&existing!==raw&&(previous?.key!==key||previous.raw!==existing))throw new Error('Draft changed in another tab');
  localStorage.setItem(key,raw);if(localStorage.getItem(key)!==raw)throw new Error('Draft was not saved');return {key,raw,value};
}
export function clearConversationDraft(row:StoredConversationDraft){if(localStorage.getItem(row.key)===row.raw)localStorage.removeItem(row.key);}
export function clearConversationDrafts(scope:ProfileStorageScope,id:string){const start=prefix(scope,id);for(const key of Object.keys(localStorage).filter(key=>key.startsWith(start)))localStorage.removeItem(key);}
/** EVERY COMPOSER THIS PROFILE LEFT HALF-TYPED, IN ONE SWEEP.
 * `clearConversationDrafts` above needs the conversation id, and logout does
 * not know which conversations the person had open — the ids live in the keys,
 * which is exactly what makes a prefix sweep the right instrument here rather
 * than a list we would have to keep somewhere. Scoped to `conversation:` under
 * this profile and then to keys that actually carry `:draft:`, so a neighbour
 * like `conversationScroll:` (where the person had got to in a thread, which a
 * returning owner expects to find) is not swept up with the unsent words. */
export function clearAllConversationDrafts(scope:ProfileStorageScope){
  const base=profileStorageKey(scope,'conversation:');if(!base)return;
  for(const key of Object.keys(localStorage))if(key.startsWith(base)&&key.slice(base.length).includes(':draft:'))localStorage.removeItem(key);
}
