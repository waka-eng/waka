import {embeddingRetrievalMinimum,embeddingCandidateRules,embeddingPolicyMatchesSql,type EmbeddingIndexPolicy} from './embedding-policy.js';
import {and,desc,eq,inArray,isNull,sql} from 'drizzle-orm';
import {attachments,inspirationEmbeddings,inspirations,type Attachment} from '../db/index.js';
import type {getDb} from './db.js';
import {buildCanonicalInspirationEmbeddingInput} from './inspiration-embeddings.js';
import {readableEmbeddingSpace,embeddingInSpace,embeddingInputHash,type EmbeddingSpace} from './embedding-provider.js';
import {effectiveAttachmentStatus,effectiveAttachmentText} from './attachment-material.js';
import {MATCH_CANDIDATE_SCAN_LIMIT,RECALL_MIN_COSINE} from './signal-derivation-thresholds.js';
import {cosineSimilarity} from '../scoring/vector.js';

type Reader=Pick<ReturnType<typeof getDb>,'select'>;
export const CONVERSATION_RETRIEVAL_LIMITS={scan:MATCH_CANDIDATE_SCAN_LIMIT,validate:24,sources:6,children:16,canonicalCharacters:12000,strongSimilarity:.75,relativeGap:.03,uncorroboratedSimilarity:.65} as const;
export interface SemanticConversationCandidate{id:string;similarity:number;vector:number[]}
export interface ConversationRetrievalTrace{scanned:number;scanLimited:boolean;validated:number;rejected:number}

/** Hybrid rank with a modest diversity penalty. Lexical-only fallback is
 * useful when indexing is absent; similarity never overrides source ownership. */
export function rankConversationCandidates(lexicalIds:string[],semantic:SemanticConversationCandidate[],validatedSimilarities?:ReadonlyMap<string,number>,policy?:EmbeddingIndexPolicy){
  const rules=embeddingCandidateRules(policy)?.chat,minimum=embeddingRetrievalMinimum(policy,'chat',RECALL_MIN_COSINE),newSpace=rules!==undefined;
  const sorted=semantic.filter(row=>Number.isFinite(row.similarity)&&row.similarity>=minimum
    &&(row.similarity>=(rules?.uncorroborated??(newSpace?minimum:CONVERSATION_RETRIEVAL_LIMITS.uncorroboratedSimilarity))||lexicalIds.includes(row.id)))
    .sort((a,b)=>b.similarity-a.similarity||a.id.localeCompare(b.id));
  const floor=rules&&rules.relativeFloor===null?minimum:Math.max(minimum,Math.min(rules?.relativeFloor??CONVERSATION_RETRIEVAL_LIMITS.strongSimilarity,(sorted[0]?.similarity??minimum)-(rules?.relativeGap??CONVERSATION_RETRIEVAL_LIMITS.relativeGap)));
  const relevant=sorted.filter(row=>row.similarity>=floor);
  const known=validatedSimilarities??new Map(semantic.map(row=>[row.id,row.similarity]));
  const candidates=new Map<string,{id:string;score:number;vector?:number[]}>();
  // A weak keyword must not pull in a source that a current, validated vector
  // places well below the strongest matches. Unindexed sources retain lexical
  // access, and no confident semantic result still means lexical fallback.
  lexicalIds.filter(id=>!relevant.length||!known.has(id)||known.get(id)!>=floor).slice(0,rules?.validate??CONVERSATION_RETRIEVAL_LIMITS.validate).forEach((id,index)=>candidates.set(id,{id,score:(rules?.lexicalWeight??.45)/(index+1)}));
  relevant.slice(0,rules?.validate??CONVERSATION_RETRIEVAL_LIMITS.validate).forEach((row,index)=>{
    const prior=candidates.get(row.id);candidates.set(row.id,{id:row.id,score:(prior?.score??0)+(rules?.semanticWeight??.55)/(index+1),vector:row.vector});
  });
  const selected:Array<{id:string;vector?:number[]}>=[];
  while(candidates.size&&selected.length<(rules?.topK??CONVERSATION_RETRIEVAL_LIMITS.sources)){
    const next=[...candidates.values()].map(row=>({...row,utility:row.score-(rules?.diversityPenalty??.15)*Math.max(0,...selected.map(other=>row.vector&&other.vector?cosineSimilarity(row.vector,other.vector)??0:0))}))
      .sort((a,b)=>b.utility-a.utility||b.score-a.score||a.id.localeCompare(b.id))[0]!;
    selected.push(next);candidates.delete(next.id);
  }
  return selected.map(row=>row.id);
}

/** No provider calls. Existing personal vectors are used only after checking
 * the same canonical bytes used by the indexing path. Oversized/unavailable
 * material fails closed for semantic ranking; lexical recall stays available. */
export async function readSemanticConversationCandidates(db:Reader,profileId:string,queryVector:number[],model?:string,lexicalIds:string[]=[],policy?:EmbeddingIndexPolicy){
  const space=readableEmbeddingSpace(policy);
  if(!space)return {candidates:[] as SemanticConversationCandidate[],similarities:new Map<string,number>(),trace:{scanned:0,scanLimited:false,validated:0,rejected:0}};
  const minimum=embeddingRetrievalMinimum(policy,'chat',RECALL_MIN_COSINE),rules=embeddingCandidateRules(policy)?.chat;
  if(model&&space.model!==model)throw new Error('Conversation embedding space changed');
  if(!embeddingInSpace(queryVector,space.dimensions,space))throw new Error('Invalid conversation query vector');
  const vectors=await db.select({id:inspirationEmbeddings.inspirationId,vector:inspirationEmbeddings.embedding,inputHash:inspirationEmbeddings.inputHash})
    .from(inspirationEmbeddings).where(and(eq(inspirationEmbeddings.profileId,profileId),eq(inspirationEmbeddings.inputScope,'personal'),eq(inspirationEmbeddings.model,space.model),eq(inspirationEmbeddings.dimensions,space.dimensions)))
    .orderBy(desc(inspirationEmbeddings.updatedAt),desc(inspirationEmbeddings.id)).limit((rules?.scan??CONVERSATION_RETRIEVAL_LIMITS.scan)+1);
  const scored=vectors.slice(0,rules?.scan??CONVERSATION_RETRIEVAL_LIMITS.scan).filter(row=>embeddingInSpace(row.vector,space.dimensions,space)).map(row=>({...row,similarity:cosineSimilarity(queryVector,row.vector)}))
    .filter((row):row is typeof row&{similarity:number}=>row.similarity!==null&&Number.isFinite(row.similarity))
    .sort((a,b)=>b.similarity-a.similarity||a.id.localeCompare(b.id));
  const ranked=[...new Map([...scored.filter(row=>lexicalIds.includes(row.id)).slice(0,6),...scored.filter(row=>row.similarity>=minimum)].map(row=>[row.id,row])).values()].slice(0,rules?.validate??CONVERSATION_RETRIEVAL_LIMITS.validate);
  const trace={scanned:Math.min(vectors.length,rules?.scan??CONVERSATION_RETRIEVAL_LIMITS.scan),scanLimited:vectors.length>(rules?.scan??CONVERSATION_RETRIEVAL_LIMITS.scan),validated:0,rejected:0};
  const similarities=new Map<string,number>();
  if(!ranked.length)return {candidates:[] as SemanticConversationCandidate[],similarities,trace};
  const rows=await currentMaterial(db,profileId,ranked.map(row=>row.id),policy);
  const current=new Map(rows.map(row=>[row.id,row]));
  const {children,canonicalCharacters:maximum}=CONVERSATION_RETRIEVAL_LIMITS;
  const candidates:SemanticConversationCandidate[]=[];
  for(const candidate of ranked){
    const row=current.get(candidate.id);trace.validated++;
    if(!row||row.oversized||row.answers.length>children||row.media.length>children||row.media.some(item=>item.enrichmentText?.trim()&&item.status!=='ready')){trace.rejected++;continue;}
    const canonical=buildCanonicalInspirationEmbeddingInput({text:row.text,kind:row.kind,reflections:row.answers.map(answer=>({...answer,createdAt:new Date(answer.createdAt)})),attachments:row.media});
    if(canonical.length>maximum||embeddingInputHash(space,canonical)!==candidate.inputHash){trace.rejected++;continue;}
    similarities.set(candidate.id,candidate.similarity);
    if(candidate.similarity>=minimum)candidates.push({id:candidate.id,similarity:candidate.similarity,vector:candidate.vector});
  }
  return {candidates:candidates.sort((a,b)=>b.similarity-a.similarity||a.id.localeCompare(b.id)),similarities,trace};
}

/** The same bounded canonical source check used before buying a query vector.
 * One SELECT, not an existence test over stale vector metadata. At most 24
 * sources/16 children/12k canonical characters; a conservative miss is lexical. */
async function currentMaterial(db:Reader,profileId:string,ids?:string[],policy?:EmbeddingIndexPolicy,space?:EmbeddingSpace){
  const maximum=CONVERSATION_RETRIEVAL_LIMITS.canonicalCharacters,children=CONVERSATION_RETRIEVAL_LIMITS.children;
  // Keep the outer qualifier explicit: Drizzle can shorten column selections
  // in a single-table SELECT, where a bare "id" would bind to the child row.
  const parentId=sql`${sql.identifier('inspirations')}.${sql.identifier('id')}`;
  const material=sql<{answers:Array<{question:string;answer:string|null;skipped:boolean;createdAt:string}>;media:Array<{type:Attachment['type'];enrichmentText:string|null;status:string|null}>}|null>`(
    SELECT CASE WHEN ${space===undefined} OR (r.n<=${children} AND a.n<=${children}
      AND length(${inspirations.text})+r.chars+a.chars+512+100*(r.n+a.n)<=${maximum})
      THEN jsonb_build_object('answers',r.rows,'media',a.rows) ELSE NULL END
    FROM (SELECT count(*) AS n,coalesce(sum(length(q.question)+length(coalesce(q.answer,''))),0) AS chars,coalesce(jsonb_agg(q),'[]'::jsonb) AS rows FROM (
      SELECT left(question,${maximum+1}) AS question,left(answer,${maximum+1}) AS answer,skipped,created_at AS "createdAt"
      FROM reflections WHERE profile_id=${profileId}::uuid AND inspiration_id=${parentId} AND NOT skipped AND length(trim(coalesce(answer,'')))>0
      ORDER BY created_at,id LIMIT ${children+1}) q) r
    CROSS JOIN (SELECT count(*) AS n,coalesce(sum(length(coalesce(q."enrichmentText",''))),0) AS chars,coalesce(jsonb_agg(q),'[]'::jsonb) AS rows FROM (
      SELECT ${attachments.type} AS type,left(${effectiveAttachmentText},${maximum+1}) AS "enrichmentText",${effectiveAttachmentStatus} AS status
      FROM ${attachments} WHERE ${attachments.profileId}=${profileId}::uuid AND ${attachments.inspirationId}=${parentId} AND length(trim(coalesce(${effectiveAttachmentText},'')))>0
      ORDER BY ${attachments.createdAt},${attachments.id} LIMIT ${children+1}) q) a)`;
  const selected=db.select({id:inspirations.id,...(space?{vector:inspirationEmbeddings.embedding,inputHash:inspirationEmbeddings.inputHash,dimensions:inspirationEmbeddings.dimensions}:{}),text:sql<string>`left(${inspirations.text},${maximum+1})`,kind:inspirations.kind,material}).from(inspirations);
  const join=and(eq(inspirationEmbeddings.profileId,inspirations.profileId),eq(inspirationEmbeddings.inspirationId,inspirations.id),eq(inspirationEmbeddings.inputScope,'personal'),eq(inspirationEmbeddings.model,space?.model??''),eq(inspirationEmbeddings.dimensions,space?.dimensions??768));
  // Presence scans existing selected vectors, so unrelated unindexed captures
  // cannot crowd all usable memory out of this bounded proof.
  const rows=await (space?selected.innerJoin(inspirationEmbeddings,join):selected.leftJoin(inspirationEmbeddings,join))
    .where(and(eq(inspirations.profileId,profileId),isNull(inspirations.memoryExcludedAt),ids?inArray(inspirations.id,ids):undefined,policy?embeddingPolicyMatchesSql(policy):undefined))
    .orderBy(desc(inspirations.createdAt),desc(inspirations.id)).limit(CONVERSATION_RETRIEVAL_LIMITS.validate);
  return rows.map(({material,...row})=>({...row,oversized:material===null,answers:material?.answers??[],media:material?.media??[]}));

}
export async function hasCurrentConversationIndex(db:Reader,profileId:string,policy?:EmbeddingIndexPolicy){
 const space=readableEmbeddingSpace(policy);
 if(!space)return false;
 const rows=await currentMaterial(db,profileId,undefined,policy,space);
 return rows.some(row=>{
  if(row.oversized||!embeddingInSpace(row.vector,row.dimensions??0,space)||row.answers.length>CONVERSATION_RETRIEVAL_LIMITS.children||row.media.length>CONVERSATION_RETRIEVAL_LIMITS.children||row.media.some(item=>item.enrichmentText?.trim()&&item.status!=='ready'))return false;
  const canonical=buildCanonicalInspirationEmbeddingInput({text:row.text,kind:row.kind,reflections:row.answers.map(answer=>({...answer,createdAt:new Date(answer.createdAt)})),attachments:row.media});
  return canonical.length<=CONVERSATION_RETRIEVAL_LIMITS.canonicalCharacters&&embeddingInputHash(space,canonical)===row.inputHash;
 });
}
