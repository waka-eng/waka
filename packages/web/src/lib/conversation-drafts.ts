import {profileStorageKey,type ProfileStorageScope} from './profile-storage';
export interface ConversationDraft{id:string;writer:string;updatedAt:number;content:string;revision:number;pending:boolean;correctsMessageId?:string;conversationId?:string;
  /** Whose memory a NEW chat answers from, kept with the first message so a reload re-sends it the same way. */
  talkWith?:'agent'|'both';
  /** Which agent `talkWith` names — kept with it, so a retried create asks
      for the same memory even if the agent shown has changed since. */
  agentId?:string;
  attachments?:ConversationDraftAttachment[]}
/* THE PHOTOS AND FILES ALREADY UPLOADED FOR THIS MESSAGE (2026-10-16).
 * Founder: chat attachments are kept "in the draft (persist with the draft
 * like talkWith/agentId) so a reload keeps them". Only what the server has
 * staged is here — its id is what the send names in `attachmentIds` — so a
 * draft read back tomorrow can still be sent with its chips. An upload still
 * in flight is a `File` in memory and cannot outlive the tab; it is not
 * written down, because a chip restored without its bytes could never finish.
 * The message `id` these were staged under must not change while any are
 * here, which `ConversationPanel`'s `edit` keeps. */
export interface ConversationDraftAttachment{id:string;type:'image'|'file';name:string|null;contentType:string|null;size:number|null}
export interface StoredConversationDraft{key:string;raw:string;value:ConversationDraft}
const prefix=(scope:ProfileStorageScope,id:string)=>profileStorageKey(scope,`conversation:${id}:draft:`)!;
const uuid=(value:unknown)=>typeof value==='string'&&/^[0-9a-f-]{36}$/i.test(value);
function valid(row:ConversationDraft,maxRevision=200){return row&&uuid(row.id)&&uuid(row.writer)&&Number.isFinite(row.updatedAt)&&typeof row.content==='string'&&row.content.length<=4000&&Number.isSafeInteger(row.revision)&&row.revision>=0&&row.revision<=maxRevision&&typeof row.pending==='boolean'&&(row.correctsMessageId===undefined||uuid(row.correctsMessageId))&&(row.conversationId===undefined||uuid(row.conversationId))&&(row.talkWith===undefined||row.talkWith==='agent'||row.talkWith==='both')&&(row.agentId===undefined||uuid(row.agentId))&&(row.attachments===undefined||Array.isArray(row.attachments)&&row.attachments.length<=6&&row.attachments.every(attached));}
const attached=(item:ConversationDraftAttachment)=>Boolean(item)&&uuid(item.id)&&(item.type==='image'||item.type==='file')&&(item.name===null||typeof item.name==='string')&&(item.contentType===null||typeof item.contentType==='string')&&(item.size===null||Number.isSafeInteger(item.size));
export function readConversationDrafts(scope:ProfileStorageScope,id:string){
  const start=prefix(scope,id);return Object.keys(localStorage).filter(key=>key.startsWith(start)).map(key=>{const raw=localStorage.getItem(key)!,value=JSON.parse(raw) as ConversationDraft;if(!valid(value,id.startsWith('thought:')?Number.MAX_SAFE_INTEGER:200)||key!==start+value.id)throw new Error('Unreadable conversation draft');return {key,raw,value};}).sort((a,b)=>b.value.updatedAt-a.value.updatedAt||a.key.localeCompare(b.key));
}
/** Another tab wrote this key since this one last read it. A tab that hits it
    is sharing a writer id with another (a duplicated tab) and forks to its own. */
export class ConversationDraftConflict extends Error{}
export function storeConversationDraft(scope:ProfileStorageScope,id:string,value:ConversationDraft,previous?:StoredConversationDraft){
  if(!valid(value,id.startsWith('thought:')?Number.MAX_SAFE_INTEGER:200))throw new Error('Invalid conversation draft');const key=prefix(scope,id)+value.id,raw=JSON.stringify(value),existing=localStorage.getItem(key);
  if(existing!==null&&existing!==raw&&(previous?.key!==key||previous.raw!==existing))throw new ConversationDraftConflict('Draft changed in another tab');
  localStorage.setItem(key,raw);if(localStorage.getItem(key)!==raw)throw new Error('Draft was not saved');return {key,raw,value};
}
export function clearConversationDraft(row:StoredConversationDraft){if(localStorage.getItem(row.key)===row.raw)localStorage.removeItem(row.key);}
/** EVERY COMPOSER THIS PROFILE LEFT HALF-TYPED, IN ONE SWEEP.
 * A per-conversation sweep would need the conversation id, and logout does
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
