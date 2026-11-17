export type OpeningSourceKind='principle'|'top_of_mind_entry'|'inspiration';
export interface OpeningReference{kind:OpeningSourceKind;id:string;hash:string}
export type ConversationOpening={version:1;locale:'en-US'|'ko-KR';hash:string}&(
  {kind:'source';source:OpeningReference;why:boolean;supports:OpeningReference[];question?:'worldInspirationReviewQuestion';imageId?:string}|
  {kind:'prompt';key:string}|{kind:'activity';asOf:string;day:number;backing:'inspirations'|'suppressions'|'top_of_minds'|'consultations'});
export interface OpeningSelection{locale:'en-US'|'ko-KR';text:string;source?:{kind:OpeningSourceKind;id:string;why?:boolean;question?:'worldInspirationReviewQuestion';imageId?:string;supportIds?:string[]}}
export interface ConversationOpeningView{binding?:ConversationOpening;available:boolean;provenance:'application';ask?:string;quote?:string;photoId?:string;wordless?:boolean;sources?:Array<{id:string;preview:string;photoId?:string|null;wordless?:boolean}>}
const uuid=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const plain=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
const keys=(value:Record<string,unknown>,allowed:string[])=>Object.keys(value).every(key=>allowed.includes(key));
const reference=(value:unknown)=>plain(value)&&keys(value,['kind','id','hash'])&&['principle','top_of_mind_entry','inspiration'].includes(value.kind as string)&&uuid(value.id)&&typeof value.hash==='string'&&value.hash.length>0&&value.hash.length<=100;
/** Drafts carry identities/proofs only, never a second copy of source words. */
export function isConversationOpening(value:unknown):value is ConversationOpening{
  if(!plain(value)||value.version!==1||!['en-US','ko-KR'].includes(value.locale as string)||typeof value.hash!=='string'||!/^[a-f0-9]{64}$/.test(value.hash))return false;
  const base=['version','locale','hash','kind'];
  if(value.kind==='source')return keys(value,[...base,'source','why','supports','question','imageId'])&&reference(value.source)&&typeof value.why==='boolean'&&Array.isArray(value.supports)&&value.supports.length<=3&&value.supports.every(reference)&&(value.question===undefined||value.question==='worldInspirationReviewQuestion')&&(value.imageId===undefined||uuid(value.imageId));
  if(value.kind==='prompt')return keys(value,[...base,'key'])&&typeof value.key==='string'&&/^[A-Za-z]{1,80}$/.test(value.key);
  return value.kind==='activity'&&keys(value,[...base,'asOf','day','backing'])&&typeof value.asOf==='string'&&Number.isFinite(Date.parse(value.asOf))&&Number.isInteger(value.day)&&Number(value.day)>=0&&Number(value.day)<=13&&['inspirations','suppressions','top_of_minds','consultations'].includes(value.backing as string);
}
export function isOpeningView(value:unknown):value is ConversationOpeningView{
  return plain(value)&&value.provenance==='application'&&typeof value.available==='boolean'&&(value.binding===undefined?!value.available:isConversationOpening(value.binding))&&(value.photoId===undefined||value.available&&uuid(value.photoId))&&(value.wordless===undefined||value.available&&typeof value.wordless==='boolean')&&['ask','quote'].every(key=>value[key]===undefined||value.available&&typeof value[key]==='string'&&(value[key] as string).length<=16000)&&(value.sources===undefined||value.available&&Array.isArray(value.sources)&&value.sources.length<=3&&value.sources.every(row=>plain(row)&&uuid(row.id)&&typeof row.preview==='string'&&row.preview.length<=16000&&(row.photoId===undefined||uuid(row.photoId))&&(row.wordless===undefined||typeof row.wordless==='boolean')));
}

/** Only a digest of companion copy is a persistent journal key. Source keys
 * intentionally survive source edits, so the existing draft can be recovered. */
export async function openingJournal(selection:OpeningSelection){
  if(selection.source)return `new:opening:${selection.locale}:${selection.source.kind}:${selection.source.id}:${selection.source.why===true}:${selection.source.question??''}:${selection.source.imageId??''}`;
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([selection.locale,selection.text])));
  return 'new:opening:'+Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
}
