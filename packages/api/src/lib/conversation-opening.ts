import {and,asc,eq,inArray,sql} from 'drizzle-orm';
import {z} from 'zod';
import {attachments,inspirations,signals,topOfMindEntries,topOfMindEntrySignals} from '../db/index.js';
import type {getDb} from './db.js';
import {conversationHash,currentConversationReferences,readConversationContext,type ConversationSource} from './conversation-context.js';
import {readConversationReadings} from './conversation-readings.js';
import {personalSignalReadable} from './personal-output.js';
import {citationStatementCurrent,citationBodyCurrent} from './signal-support-state.js';
import {loadSignalEvidence} from './review-evidence.js';
import {buildTextPreview} from '../routes/inspirations-serialization.js';
import {imageWordsState} from './image-words.js';
import {assembleTheWeather} from './the-weather.js';
import en from '../../../web/src/lib/i18n/messages/en-US.json';
import ko from '../../../web/src/lib/i18n/messages/ko-KR.json';

const uuid=z.string().uuid().transform(value=>value.toLowerCase());
const locale=z.enum(['en-US','ko-KR']);
const reference=z.object({kind:z.enum(['principle','top_of_mind_entry','inspiration']),id:uuid,hash:z.string().min(1).max(100)}).strict();
// Public application copy only. Never accept a caller's assistant/system text.
const promptKeys=['worldCompanionChatPrompt','worldInspirationReviewQuestion','worldGroundNone','worldGroundSome','worldGroundReady','worldBubbleKept','worldHarvestKept','worldTalkFailed','worldHarvestKeepFailed','worldLinkCopied','worldLinkCopyFailed','worldNotSaved','worldDisputeNotRecorded','worldPrincipleStillHere','worldOrderNotSaved','profileSignOutError','worldSittingDone'] as const;
const base={version:z.literal(1),locale,hash:z.string().regex(/^[a-f0-9]{64}$/)};
export const conversationOpeningSchema=z.discriminatedUnion('kind',[
  z.object({...base,kind:z.literal('source'),source:reference,why:z.boolean(),supports:z.array(reference).max(3),question:z.literal('worldInspirationReviewQuestion').optional(),imageId:uuid.optional()}).strict(),
  z.object({...base,kind:z.literal('prompt'),key:z.enum(promptKeys)}).strict(),
  z.object({...base,kind:z.literal('activity'),asOf:z.string().datetime(),day:z.number().int().min(0).max(13),backing:z.enum(['inspirations','suppressions','top_of_minds','consultations'])}).strict(),
]);
export type ConversationOpening=z.infer<typeof conversationOpeningSchema>;
export const openingSelectionSchema=z.object({locale,text:z.string().max(16000),source:z.object({kind:reference.shape.kind,id:uuid,why:z.boolean().optional(),question:z.literal('worldInspirationReviewQuestion').optional(),imageId:uuid.optional(),supportIds:z.array(uuid).max(3).optional()}).strict().optional()}).strict();
type Reader=Pick<ReturnType<typeof getDb>,'select'|'execute'>;
const identity=(row:{kind:string;id:string;hash:string})=>[row.kind,row.id,row.hash];
/** JSONB key order is not an idempotency token. Compare a canonical tuple. */
export function openingIdentity(value:unknown):string{
  if(value==null)return 'none';const row=conversationOpeningSchema.parse(value);
  return conversationHash(row.kind==='source'?[1,row.locale,row.kind,row.hash,identity(row.source),row.why,row.supports.map(identity),row.question??null,row.imageId??null]:row.kind==='prompt'?[1,row.locale,row.kind,row.hash,row.key]:[1,row.locale,row.kind,row.hash,row.asOf,row.day,row.backing]);
}
const ref=(row:ConversationSource)=>({kind:row.kind,id:row.id,hash:row.hash});
const same=(a:unknown,b:unknown)=>conversationHash(a)===conversationHash(b);
const catalogue=(lang:'en-US'|'ko-KR')=>lang==='ko-KR'?ko:en;
async function sourceText(db:Reader,profileId:string,source:ConversationSource,imageId?:string,question?:string){
  if(source.kind==='top_of_mind_entry')return (await readConversationReadings(db,profileId,'',[source.id]))[0]?.text;
  if(source.kind==='inspiration'){
    const [row]=await db.select({text:inspirations.text}).from(inspirations).where(and(eq(inspirations.profileId,profileId),eq(inspirations.id,source.id)));
    if(!row)return undefined;
    if(imageId){
      const [image]=await db.select().from(attachments).where(and(eq(attachments.profileId,profileId),eq(attachments.inspirationId,source.id),eq(attachments.id,imageId),eq(attachments.type,'image')));
      const words=image?imageWordsState(image):null;if(words?.status!=='ready'||!words.text?.trim())return undefined;
      return [row.text.trim(),`“${words.text.trim()}”`].filter(Boolean).join('\n\n');
    }
    if(question&&!row.text){const [media]=await db.select({name:attachments.name,url:attachments.url,type:attachments.type}).from(attachments).where(and(eq(attachments.profileId,profileId),eq(attachments.inspirationId,source.id))).orderBy(asc(attachments.createdAt),asc(attachments.id)).limit(1);return media?.name??media?.url??media?.type??'';}
    return question?row.text:row.text.trim();
  }
  return source.text;
}
async function whyReferences(db:Reader,profileId:string,entryId:string,wanted?:string[]){
  const links=await db.select({id:signals.id}).from(topOfMindEntrySignals)
    .innerJoin(topOfMindEntries,eq(topOfMindEntries.id,topOfMindEntrySignals.entryId))
    .innerJoin(signals,and(eq(signals.id,topOfMindEntrySignals.signalId),eq(signals.profileId,profileId)))
    .where(and(eq(topOfMindEntrySignals.entryId,entryId),personalSignalReadable(profileId),citationStatementCurrent('top_of_mind_entry_signals'),citationBodyCurrent('top_of_mind_entry_signals','top_of_mind_entries','entry_body_revision','body_revision')))
    .orderBy(asc(topOfMindEntrySignals.createdAt),asc(topOfMindEntrySignals.id)).limit(100);
  const evidence=await loadSignalEvidence(db,profileId,links.map(row=>row.id));
  const available=[...new Set(links.flatMap(link=>(evidence.witnesses.get(link.id)??[]).flatMap(row=>row.lineage?.originIds??[])))];
  const ids=wanted??available.slice(0,3);
  if(ids.some(id=>!available.includes(id))||new Set(ids).size!==ids.length)return null;
  if(!ids.length)return [];
  const context=await readConversationContext(db,profileId,'',ids.map(id=>({kind:'inspiration' as const,id,hash:'prepare'})));
  return ids.map(id=>context.inspirations.find(row=>row.id===id)).every(Boolean)?ids.map(id=>context.inspirations.find(row=>row.id===id)!):null;
}
const sentence=(text:string,lang:'en-US'|'ko-KR')=>lang==='ko-KR'?text:text.charAt(0).toLocaleUpperCase('en-US')+text.slice(1);
async function activity(db:Reader,profileId:string,lang:'en-US'|'ko-KR',asOf:string){
  const weather=await assembleTheWeather(db as ReturnType<typeof getDb>,{profileId,now:new Date(asOf),includeAntechamber:false,locale:lang});
  return weather.days.flatMap(day=>day.sentences.filter(row=>row.text!=='the sky held'&&row.backing!=='signals'&&row.backing!=='signal_evidence').map(row=>({day:day.daysAgo,backing:row.backing,text:sentence(`${row.text} ${day.label}.`,lang)})));
}
export async function prepareConversationOpening(db:Reader,profileId:string,selection:z.infer<typeof openingSelectionSchema>,now=new Date()):Promise<ConversationOpening|null>{
  const lang=selection.locale;
  if(selection.source){
    const context=await readConversationContext(db,profileId,'',[{...selection.source,hash:'prepare'}]);
    const primary=[...context.principles,...context.reading,...context.inspirations].find(row=>row.kind===selection.source!.kind&&row.id===selection.source!.id);
    if(!primary||await sourceText(db,profileId,primary,selection.source.imageId,selection.source.question)!==selection.text)return null;
    const why=selection.source.why===true;
    if(why&&primary.kind!=='top_of_mind_entry'||(selection.source.question||selection.source.imageId)&&primary.kind!=='inspiration'||selection.source.supportIds&&!why)return null;
    const witnesses=why?await whyReferences(db,profileId,primary.id,selection.source.supportIds):[];if(!witnesses)return null;
    const supports=witnesses.map(ref);
    const question=selection.source.question,imageId=selection.source.imageId;
    return {version:1,locale:lang,kind:'source',source:ref(primary),why,supports,...(question?{question}:{}),...(imageId?{imageId}:{}),hash:conversationHash([ref(primary),why,supports,question??null,imageId??null])};
  }
  const key=promptKeys.find(key=>catalogue(lang)[key]===selection.text);
  if(key)return {version:1,locale:lang,kind:'prompt',key,hash:conversationHash(selection.text)};
  const asOf=now.toISOString(),found=(await activity(db,profileId,lang,asOf)).find(row=>row.text===selection.text);
  if(!found)return null;
  return conversationOpeningSchema.parse({version:1,locale:lang,kind:'activity',asOf,day:found.day,backing:found.backing,hash:conversationHash(found.text)});
}
export async function resolveConversationOpening(db:Reader,profileId:string,value:unknown,options:{display?:boolean}={}){
  if(value==null)return null;
  const parsed=conversationOpeningSchema.safeParse(value);
  if(!parsed.success)return {available:false as const,provenance:'application' as const};
  const binding=parsed.data,missing={binding,available:false as const,provenance:'application' as const};
  if(binding.kind==='source'){
    if(binding.why&&binding.source.kind!=='top_of_mind_entry'||!binding.why&&binding.supports.length||binding.supports.some(row=>row.kind!=='inspiration')||new Set(binding.supports.map(row=>row.id)).size!==binding.supports.length||(binding.question||binding.imageId)&&binding.source.kind!=='inspiration')return missing;
    const references=[binding.source,...binding.supports],sources=await currentConversationReferences(db,profileId,references);
    if(sources.some(row=>!row))return missing;
    if(binding.why){const witnesses=await whyReferences(db,profileId,binding.source.id,binding.supports.map(row=>row.id));if(!witnesses||!same(witnesses.map(ref),binding.supports))return missing;}
    if(!same([binding.source,binding.why,binding.supports],[ref(sources[0]!),binding.why,binding.supports])||binding.hash!==conversationHash([binding.source,binding.why,binding.supports,binding.question??null,binding.imageId??null]))return missing;
    if(options.display===false)return {binding,available:true as const,provenance:'application' as const,...(binding.source.kind==='inspiration'?{quote:sources[0]!.text,...(binding.question?{ask:catalogue(binding.locale)[binding.question]}:{})}:{ask:sources[0]!.text}),sources:[],context:sources as ConversationSource[]};
    const text=await sourceText(db,profileId,sources[0]!,binding.imageId,binding.question);if(text===undefined)return missing;
    const supportIds=binding.supports.map(row=>row.id);
    const supportRows=supportIds.length?await db.select({id:inspirations.id,text:inspirations.text,photoId:sql<string|null>`(SELECT a.id FROM attachments a WHERE a.profile_id=${profileId}::uuid AND a.inspiration_id=${sql.raw('"inspirations"."id"')} AND a.type='image' ORDER BY a.created_at,a.id LIMIT 1)`}).from(inspirations).where(and(eq(inspirations.profileId,profileId),inArray(inspirations.id,supportIds))):[];
    const supports=supportIds.flatMap(id=>{const row=supportRows.find(row=>row.id===id);return row?[{id,preview:buildTextPreview(row.text.slice(0,400),row.text.length),...(row.photoId?{photoId:row.photoId}:{}),wordless:!row.text.trim()}]:[];});
    if(supports.length!==supportIds.length)return missing;
    const [photo]=binding.source.kind==='inspiration'?await db.select({id:attachments.id}).from(attachments).where(and(eq(attachments.profileId,profileId),eq(attachments.inspirationId,binding.source.id),eq(attachments.type,'image'))).orderBy(asc(attachments.createdAt),asc(attachments.id)).limit(1):[];
    const [raw]=binding.source.kind==='inspiration'?await db.select({text:inspirations.text}).from(inspirations).where(and(eq(inspirations.profileId,profileId),eq(inspirations.id,binding.source.id))):[];
    // Full display prose/media were read after the first proof. Re-prove all
    // identities after those reads so READ COMMITTED cannot pair new words
    // with an old hash when an editor interleaves the statements.
    if((await currentConversationReferences(db,profileId,references)).some(row=>!row))return missing;
    if(binding.why){const witnesses=await whyReferences(db,profileId,binding.source.id,binding.supports.map(row=>row.id));if(!witnesses||!same(witnesses.map(ref),binding.supports))return missing;}
    return {binding,available:true as const,provenance:'application' as const,...(photo?{photoId:photo.id}:{}),wordless:binding.source.kind==='inspiration'&&!binding.imageId&&!raw?.text.trim(),...(binding.source.kind==='inspiration'?{quote:text,...(binding.question?{ask:catalogue(binding.locale)[binding.question]}:{})}:{ask:text}),sources:supports,context:sources as ConversationSource[]};
  }
  const text=binding.kind==='prompt'?catalogue(binding.locale)[binding.key]:(await activity(db,profileId,binding.locale,binding.asOf)).find(row=>row.day===binding.day&&row.backing===binding.backing)?.text;
  if(typeof text!=='string'||conversationHash(text)!==binding.hash)return missing;
  return {binding,available:true as const,provenance:'application' as const,ask:text,sources:[],context:[] as ConversationSource[]};
}
/** The public projection never returns internal context excerpts twice. */
export async function projectConversationOpening(db:Reader,profileId:string,value:unknown){
  const resolved=await resolveConversationOpening(db,profileId,value);if(!resolved)return null;
  const {context:_,...view}={context:undefined,...resolved};return view;
}
