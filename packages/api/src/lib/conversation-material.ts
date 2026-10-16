import {createHash} from 'node:crypto';
import {and,asc,desc,eq,inArray,sql} from 'drizzle-orm';
import {attachments,inspirations,inspirationRevisions,reflections} from '../db/index.js';
import type {getDb} from './db.js';
import {effectiveAttachmentStatus,effectiveAttachmentText} from './attachment-material.js';

type Reader=Pick<ReturnType<typeof getDb>,'select'>;
/** Resolve short continuations from human context, never an assistant's
 * unadopted interpretation. The full messages remain unchanged for the reply. */
/**
 * What retrieval searches with: the person's latest words. A photo- or
 * file-only message (content '', migration 0076) has none, so the most recent
 * message that does stands in; with no words anywhere, `fallback` (the
 * attachments' names) does, so the reply still reads saved material.
 */
export function conversationSearchQuery(history:ReadonlyArray<{role:string;content:string}>,fallback=''){
  const human=history.filter(row=>row.role==='user'&&row.content.trim().length>0),latest=human.at(-1)?.content??'';
  if(!latest)return fallback.trim().slice(0,1000);
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

/** One bounded query, with explicit ownership on every child. Excerpts are
 * deterministic so citation reopening does not depend on the latest question. */
export async function readConversationMaterial(db:Reader,profileId:string,terms:string[],ids?:string[]){
  if(ids?.length===0||!ids&&!terms.length)return [];
  const selection={id:inspirations.id,text:sql<string>`left(${inspirations.text},1601)`,
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
  };
  const revisionJoin=and(eq(inspirationRevisions.profileId,inspirations.profileId),eq(inspirationRevisions.inspirationId,inspirations.id));
  // Preserve literal substring semantics, not search's whole-word semantics.
  // One bit per term counts it once even when raw text and several children
  // match. Each child arm is owned before scanning. Rank identities
  // and apply the six-source bound before assembling any excerpts.
  // PostgreSQL's UTF8 ILIKE itself lowers both strings before LIKE (like.c).
  // Fold each owned passage once, not once per term. Keep native ILIKE for
  // other encodings and keep original text solely for that fallback.
  const scores=ids?null:sql`(WITH encoding AS MATERIALIZED (SELECT current_setting('server_encoding')='UTF8' AS utf8),
    terms(term,pattern,folded_pattern) AS (VALUES ${sql.join(terms.map((term,index)=>sql`(${index},${likeValue(term)},lower(${likeValue(term)}))`),sql`, `)}),
    source_ids AS MATERIALIZED (
      SELECT ${inspirations.id},${inspirations.createdAt} FROM ${inspirations} JOIN ${inspirationRevisions}
        ON ${inspirationRevisions.profileId}=${inspirations.profileId} AND ${inspirationRevisions.inspirationId}=${inspirations.id}
      WHERE ${inspirations.profileId}=${profileId}::uuid
    ),
    source_text AS (
      SELECT id,lower(text) AS folded,CASE WHEN (SELECT utf8 FROM encoding) THEN NULL ELSE text END AS original
      FROM ${inspirations} WHERE ${inspirations.profileId}=${profileId}::uuid OFFSET 0
    ),source_answers AS (
      SELECT inspiration_id AS id,lower(answer) AS folded,CASE WHEN (SELECT utf8 FROM encoding) THEN NULL ELSE answer END AS original
      FROM ${reflections} WHERE ${reflections.profileId}=${profileId}::uuid AND NOT ${reflections.skipped} OFFSET 0
    ),source_media AS (
      SELECT inspiration_id AS id,lower(${effectiveAttachmentText}) AS folded,
        CASE WHEN (SELECT utf8 FROM encoding) THEN NULL ELSE ${effectiveAttachmentText} END AS original
      FROM ${attachments} WHERE ${attachments.profileId}=${profileId}::uuid AND ${effectiveAttachmentStatus}='ready' OFFSET 0
    )
    SELECT scored.id,scored.score,source_ids.created_at FROM (
      SELECT id,bit_count(bit_or(set_bit(repeat('0',${terms.length})::varbit,term::int,1))) AS score FROM (
      SELECT id,matched.term FROM source_text CROSS JOIN LATERAL (
        SELECT terms.term FROM terms WHERE CASE WHEN (SELECT utf8 FROM encoding) THEN source_text.folded LIKE terms.folded_pattern ESCAPE '!' ELSE source_text.original ILIKE terms.pattern ESCAPE '!' END OFFSET 0
      ) matched
      UNION ALL
      SELECT id,matched.term FROM source_answers CROSS JOIN LATERAL (
        SELECT terms.term FROM terms WHERE CASE WHEN (SELECT utf8 FROM encoding) THEN source_answers.folded LIKE terms.folded_pattern ESCAPE '!' ELSE source_answers.original ILIKE terms.pattern ESCAPE '!' END OFFSET 0
      ) matched
      UNION ALL
      SELECT id,matched.term FROM source_media CROSS JOIN LATERAL (
        SELECT terms.term FROM terms WHERE CASE WHEN (SELECT utf8 FROM encoding) THEN source_media.folded LIKE terms.folded_pattern ESCAPE '!' ELSE source_media.original ILIKE terms.pattern ESCAPE '!' END OFFSET 0
      ) matched
    ) matched_terms GROUP BY id) scored JOIN source_ids ON source_ids.id=scored.id) material_scores`;
  const candidates=scores?db.select({id:sql<string>`material_scores.id`.as('id'),score:sql<number>`material_scores.score`.as('score')})
    .from(scores).orderBy(desc(sql`material_scores.score`),desc(sql`material_scores.created_at`),asc(sql`material_scores.id`)).limit(6).as('conversation_candidates'):null;
  const rows=candidates?await db.select(selection).from(candidates)
    .innerJoin(inspirations,and(eq(inspirations.profileId,profileId),sql`${inspirations.id}="conversation_candidates"."id"`))
    .innerJoin(inspirationRevisions,revisionJoin)
    .orderBy(desc(sql`"conversation_candidates"."score"`),desc(inspirations.createdAt),asc(inspirations.id))
    :await db.select(selection).from(inspirations).innerJoin(inspirationRevisions,revisionJoin)
      .where(and(eq(inspirations.profileId,profileId),inArray(inspirations.id,ids!)))
      .orderBy(sql`array_position(ARRAY[${sql.join(ids!.map(id=>sql`${id}::uuid`),sql`, `)}],${inspirations.id})`,desc(inspirations.createdAt),asc(inspirations.id)).limit(6);
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
