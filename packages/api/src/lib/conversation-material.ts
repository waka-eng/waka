import {createHash} from 'node:crypto';
import {and,asc,desc,eq,inArray,or,sql} from 'drizzle-orm';
import {attachments,inspirations,inspirationRevisions,reflections} from '../db/index.js';
import type {getDb} from './db.js';
import {effectiveAttachmentStatus,effectiveAttachmentText} from './attachment-material.js';

type Reader=Pick<ReturnType<typeof getDb>,'select'>;
/** Resolve short continuations from human context, never an assistant's
 * unadopted interpretation. The full messages remain unchanged for the reply. */
export function conversationSearchQuery(history:ReadonlyArray<{role:string;content:string}>){
  const human=history.filter(row=>row.role==='user'),latest=human.at(-1)?.content??'';
  const isContinuation=(text:string)=>text.length<=120&&(/\b(that|it|those|this idea)\b/i.test(text)||/^(why|how so)[?!.\s]*$/i.test(text)||/(그거|그것|이거|그건|그럼|이것|그 생각|그 얘기)|^왜[?\s]*$/.test(text));
  const prior=isContinuation(latest)?human.slice(0,-1).reverse().find(row=>!isContinuation(row.content)):undefined;
  return (prior?`${latest}\n${prior.content.slice(0,600)}`:latest).slice(0,1000);
}
const STOP_WORDS=new Set(['the','and','for','this','that','what','which','about','with','have','does','how','can','could','would','should','please','your','you','mine','from','http','https','이','그','저','나','내','너','왜','뭐','좀','요즘','지금','그것','이것','은','는','을','를','의','에','도','과','와','더']);
export function conversationSearchTerms(question:string){
  return [...new Set(question.toLowerCase().match(/[\p{L}\p{N}]+/gu)??[])]
    .filter(term=>!STOP_WORDS.has(term)&&(term.length>=3||/^[\p{Script=Hangul}]+$/u.test(term))).slice(0,8);
}
const likeValue=(term:string)=>`%${term.replace(/[!%_]/g,char=>`!${char}`)}%`;
export function conversationMaterialMatch(term:string){
  const search=likeValue(term);
  return or(sql`${inspirations.text} ILIKE ${search} ESCAPE '!'`,
    sql`EXISTS(SELECT 1 FROM ${reflections} WHERE ${reflections.profileId}=${inspirations.profileId}
      AND ${reflections.inspirationId}=${inspirations.id} AND NOT ${reflections.skipped}
      AND ${reflections.answer} ILIKE ${search} ESCAPE '!')`,
    sql`EXISTS(SELECT 1 FROM ${attachments} WHERE ${attachments.profileId}=${inspirations.profileId}
      AND ${attachments.inspirationId}=${inspirations.id} AND ${effectiveAttachmentStatus}='ready'
      AND ${effectiveAttachmentText} ILIKE ${search} ESCAPE '!')`)!;
}

/** One bounded query, with explicit ownership on every child. Excerpts are
 * deterministic so citation reopening does not depend on the latest question. */
export async function readConversationMaterial(db:Reader,profileId:string,terms:string[],ids?:string[]){
  if(ids?.length===0||!ids&&!terms.length)return [];
  const matches=terms.map(conversationMaterialMatch);
  const score=matches.length?sql<number>`(${sql.join(matches.map(match=>sql`CASE WHEN ${match} THEN 1 ELSE 0 END`),sql` + `)})`:undefined;
  const rows=await db.select({id:inspirations.id,text:sql<string>`left(${inspirations.text},1601)`,
    recordedAt:sql<string>`${inspirations.createdAt}::text`,revision:sql<string>`${inspirationRevisions.personalRevision}::text`,
    answers:sql<Array<{text:string}>>`COALESCE((SELECT jsonb_agg(q) FROM (
      SELECT left(answer,601) AS text FROM reflections WHERE profile_id=${profileId}::uuid
        AND inspiration_id=${inspirations.id} AND NOT skipped AND length(trim(coalesce(answer,'')))>0
      ORDER BY created_at DESC,id LIMIT 4) q),'[]'::jsonb)`,
    media:sql<Array<{text:string;type:string;corrected:boolean}>>`COALESCE((SELECT jsonb_agg(q) FROM (
      SELECT left(${effectiveAttachmentText},601) AS text,${attachments.type} AS type,
        (${attachments.type}='audio' AND ${attachments.transcriptCorrection} IS NOT NULL) AS corrected
      FROM ${attachments} WHERE ${attachments.profileId}=${profileId}::uuid AND ${attachments.inspirationId}=${inspirations.id}
        AND ${effectiveAttachmentStatus}='ready' AND length(trim(coalesce(${effectiveAttachmentText},'')))>0
      ORDER BY ${attachments.createdAt},${attachments.id} LIMIT 4) q),'[]'::jsonb)`,
  }).from(inspirations).innerJoin(inspirationRevisions,and(eq(inspirationRevisions.profileId,inspirations.profileId),eq(inspirationRevisions.inspirationId,inspirations.id)))
    .where(and(eq(inspirations.profileId,profileId),ids?inArray(inspirations.id,ids):or(...matches)))
    .orderBy(...(ids?.length?[sql`array_position(ARRAY[${sql.join(ids.map(id=>sql`${id}::uuid`),sql`, `)}],${inspirations.id})`]:score?[desc(score)]:[]),desc(inspirations.createdAt),asc(inspirations.id)).limit(6);
  return rows.map(row=>{
    const parts=[...(row.text.trim()?[{label:row.answers.length||row.media.length?'Saved text':'',text:row.text}]:[]),
      ...row.answers.slice(0,3).map(answer=>({label:'Reflection (your words)',text:answer.text})),
      ...row.media.slice(0,3).map(item=>({label:item.type==='audio'?item.corrected?'Audio transcript (your correction)':'Audio transcript':item.type==='image'?'Image description (generated)':'Link content',text:item.text}))];
    const allowance=Math.floor((1600-Math.max(0,parts.length-1)*2)/Math.max(1,parts.length));
    const formatted=parts.map(part=>part.label?`${part.label}:\n${part.text}`:part.text);
    const text=formatted.map(part=>part.slice(0,allowance)).join('\n\n');
    const truncated=formatted.some(part=>part.length>allowance)||row.answers.length>3||row.media.length>3;
    return {id:row.id,text,revision:row.revision,recordedAt:row.recordedAt,truncated,
      hash:'material-v1:'+createHash('sha256').update(JSON.stringify({profileId,id:row.id,revision:row.revision,text,recordedAt:row.recordedAt})).digest('hex')};
  });
}
