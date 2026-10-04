import {and,desc,eq,inArray,sql} from 'drizzle-orm';
import {attachments,inspirationEmbeddings,inspirations,type Attachment} from '../db/index.js';
import type {getDb} from './db.js';
import {buildCanonicalInspirationEmbeddingInput,GEMINI_EMBEDDING_DIMENSIONS,GEMINI_EMBEDDING_MODEL,hashEmbeddingInput} from './inspiration-embeddings.js';
import {effectiveAttachmentStatus,effectiveAttachmentText} from './attachment-material.js';
import {MATCH_CANDIDATE_SCAN_LIMIT,RECALL_MIN_COSINE} from './signal-derivation-thresholds.js';
import {cosineSimilarity} from '../scoring/vector.js';

type Reader=Pick<ReturnType<typeof getDb>,'select'>;
export const CONVERSATION_RETRIEVAL_LIMITS={scan:MATCH_CANDIDATE_SCAN_LIMIT,validate:24,sources:6,children:16,canonicalCharacters:12000,strongSimilarity:.75,relativeGap:.03,uncorroboratedSimilarity:.65} as const;
export interface SemanticConversationCandidate{id:string;similarity:number;vector:number[]}
export interface ConversationRetrievalTrace{scanned:number;scanLimited:boolean;validated:number;rejected:number}

/** Hybrid rank with a modest diversity penalty. Lexical-only fallback is
 * useful when indexing is absent; similarity never overrides source ownership. */
export function rankConversationCandidates(lexicalIds:string[],semantic:SemanticConversationCandidate[],validatedSimilarities?:ReadonlyMap<string,number>){
  const sorted=semantic.filter(row=>Number.isFinite(row.similarity)&&row.similarity>=RECALL_MIN_COSINE
    &&(row.similarity>=CONVERSATION_RETRIEVAL_LIMITS.uncorroboratedSimilarity||lexicalIds.includes(row.id)))
    .sort((a,b)=>b.similarity-a.similarity||a.id.localeCompare(b.id));
  const floor=Math.max(RECALL_MIN_COSINE,Math.min(CONVERSATION_RETRIEVAL_LIMITS.strongSimilarity,(sorted[0]?.similarity??RECALL_MIN_COSINE)-CONVERSATION_RETRIEVAL_LIMITS.relativeGap));
  const relevant=sorted.filter(row=>row.similarity>=floor);
  const known=validatedSimilarities??new Map(semantic.map(row=>[row.id,row.similarity]));
  const candidates=new Map<string,{id:string;score:number;vector?:number[]}>();
  // A weak keyword must not pull in a source that a current, validated vector
  // places well below the strongest matches. Unindexed sources retain lexical
  // access, and no confident semantic result still means lexical fallback.
  lexicalIds.filter(id=>!relevant.length||!known.has(id)||known.get(id)!>=floor).slice(0,CONVERSATION_RETRIEVAL_LIMITS.validate).forEach((id,index)=>candidates.set(id,{id,score:.45/(index+1)}));
  relevant.slice(0,CONVERSATION_RETRIEVAL_LIMITS.validate).forEach((row,index)=>{
    const prior=candidates.get(row.id);candidates.set(row.id,{id:row.id,score:(prior?.score??0)+.55/(index+1),vector:row.vector});
  });
  const selected:Array<{id:string;vector?:number[]}>=[];
  while(candidates.size&&selected.length<CONVERSATION_RETRIEVAL_LIMITS.sources){
    const next=[...candidates.values()].map(row=>({...row,utility:row.score-.15*Math.max(0,...selected.map(other=>row.vector&&other.vector?cosineSimilarity(row.vector,other.vector)??0:0))}))
      .sort((a,b)=>b.utility-a.utility||b.score-a.score||a.id.localeCompare(b.id))[0]!;
    selected.push(next);candidates.delete(next.id);
  }
  return selected.map(row=>row.id);
}

/** No provider calls. Existing personal vectors are used only after checking
 * the same canonical bytes used by the indexing path. Oversized/unavailable
 * material fails closed for semantic ranking; lexical recall stays available. */
export async function readSemanticConversationCandidates(db:Reader,profileId:string,queryVector:number[],model=GEMINI_EMBEDDING_MODEL,lexicalIds:string[]=[]){
  if(queryVector.length!==GEMINI_EMBEDDING_DIMENSIONS||queryVector.some(value=>!Number.isFinite(value)))throw new Error('Invalid conversation query vector');
  const vectors=await db.select({id:inspirationEmbeddings.inspirationId,vector:inspirationEmbeddings.embedding,inputHash:inspirationEmbeddings.inputHash})
    .from(inspirationEmbeddings).where(and(eq(inspirationEmbeddings.profileId,profileId),eq(inspirationEmbeddings.inputScope,'personal'),eq(inspirationEmbeddings.model,model),eq(inspirationEmbeddings.dimensions,GEMINI_EMBEDDING_DIMENSIONS)))
    .orderBy(desc(inspirationEmbeddings.updatedAt),desc(inspirationEmbeddings.id)).limit(CONVERSATION_RETRIEVAL_LIMITS.scan+1);
  const scored=vectors.slice(0,CONVERSATION_RETRIEVAL_LIMITS.scan).map(row=>({...row,similarity:cosineSimilarity(queryVector,row.vector)}))
    .filter((row):row is typeof row&{similarity:number}=>row.similarity!==null&&Number.isFinite(row.similarity))
    .sort((a,b)=>b.similarity-a.similarity||a.id.localeCompare(b.id));
  const ranked=[...new Map([...scored.filter(row=>lexicalIds.includes(row.id)).slice(0,6),...scored.filter(row=>row.similarity>=RECALL_MIN_COSINE)].map(row=>[row.id,row])).values()].slice(0,CONVERSATION_RETRIEVAL_LIMITS.validate);
  const trace={scanned:Math.min(vectors.length,CONVERSATION_RETRIEVAL_LIMITS.scan),scanLimited:vectors.length>CONVERSATION_RETRIEVAL_LIMITS.scan,validated:0,rejected:0};
  const similarities=new Map<string,number>();
  if(!ranked.length)return {candidates:[] as SemanticConversationCandidate[],similarities,trace};
  const maximum=CONVERSATION_RETRIEVAL_LIMITS.canonicalCharacters,children=CONVERSATION_RETRIEVAL_LIMITS.children;
  // Keep the outer qualifier explicit: Drizzle can shorten column selections
  // in a single-table SELECT, where a bare "id" would bind to the child row.
  const parentId=sql`${sql.identifier('inspirations')}.${sql.identifier('id')}`;
  const rows=await db.select({id:inspirations.id,text:sql<string>`left(${inspirations.text},${maximum+1})`,kind:inspirations.kind,
    answers:sql<Array<{question:string;answer:string|null;skipped:boolean;createdAt:string}>>`COALESCE((SELECT jsonb_agg(q) FROM (
      SELECT left(question,${maximum+1}) AS question,left(answer,${maximum+1}) AS answer,skipped,created_at AS "createdAt"
      FROM reflections WHERE profile_id=${profileId}::uuid AND inspiration_id=${parentId} AND NOT skipped AND length(trim(coalesce(answer,'')))>0
      ORDER BY created_at,id LIMIT ${children+1}) q),'[]'::jsonb)`,
    media:sql<Array<{type:Attachment['type'];enrichmentText:string|null;status:string|null}>>`COALESCE((SELECT jsonb_agg(q) FROM (
      SELECT ${attachments.type} AS type,left(${effectiveAttachmentText},${maximum+1}) AS "enrichmentText",${effectiveAttachmentStatus} AS status
      FROM ${attachments} WHERE ${attachments.profileId}=${profileId}::uuid AND ${attachments.inspirationId}=${parentId} AND length(trim(coalesce(${effectiveAttachmentText},'')))>0
      ORDER BY ${attachments.createdAt},${attachments.id} LIMIT ${children+1}) q),'[]'::jsonb)`,
  }).from(inspirations).where(and(eq(inspirations.profileId,profileId),inArray(inspirations.id,ranked.map(row=>row.id))));
  const current=new Map(rows.map(row=>[row.id,row]));
  const candidates:SemanticConversationCandidate[]=[];
  for(const candidate of ranked){
    const row=current.get(candidate.id);trace.validated++;
    if(!row||row.answers.length>children||row.media.length>children||row.media.some(item=>item.enrichmentText?.trim()&&item.status!=='ready')){trace.rejected++;continue;}
    const canonical=buildCanonicalInspirationEmbeddingInput({text:row.text,kind:row.kind,reflections:row.answers.map(answer=>({...answer,createdAt:new Date(answer.createdAt)})),attachments:row.media});
    if(canonical.length>maximum||hashEmbeddingInput(canonical)!==candidate.inputHash){trace.rejected++;continue;}
    similarities.set(candidate.id,candidate.similarity);
    if(candidate.similarity>=RECALL_MIN_COSINE)candidates.push({id:candidate.id,similarity:candidate.similarity,vector:candidate.vector});
  }
  return {candidates:candidates.sort((a,b)=>b.similarity-a.similarity||a.id.localeCompare(b.id)),similarities,trace};
}
