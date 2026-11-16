import {embeddingPolicySql,parseEmbeddingPolicy,embeddingPolicyIdentity,activeEmbeddingSpaceSql,embeddingRetrievalMinimum,embeddingCandidateRules} from '../lib/embedding-policy.js';
/** Own-profile semantic retrieval. Current support and vector identity are
 * proved again after HTTP; an unavailable embedder never invents a match. */
import { and, desc, eq, getTableColumns, inArray,sql } from 'drizzle-orm';
import { Hono, type MiddlewareHandler } from 'hono';
import { z } from 'zod';
import { signalEmbeddings, signals } from '../db/index.js';
import { recordConsultation } from '../lib/consultations.js';
import { getDb } from '../lib/db.js';
import { validateEmbeddingVector,
  type GeminiEmbeddingClient } from '../lib/inspiration-embeddings.js';
import {createEmbeddingClient,readableEmbeddingSpace,embeddingInSpace,embeddingInputHash,EmbeddingProviderUnavailableError} from '../lib/embedding-provider.js';
import { requireAuth, type AuthEnv } from '../lib/middleware.js';
import { personalSignalReadable } from '../lib/personal-output.js';
import { reserveRecallAttempt, RECALL_TIMEOUT_MS } from '../lib/recall-budget.js';
import { MATCH_CANDIDATE_SCAN_LIMIT, RECALL_LIMIT, RECALL_MIN_COSINE } from '../lib/signal-derivation-thresholds.js';
import { validationDetails } from '../lib/validation.js';
import { cosineSimilarity } from '../scoring/vector.js';
import { decorateSignals, loadProfileTarget, resolveProfileScope } from './signals.js';

const querySchema=z.object({q:z.string().trim().min(2).max(500),profile:z.string().uuid().optional()}).strict();
interface RecallRouteDependencies {
  authMiddleware?: MiddlewareHandler<AuthEnv>;
  getDatabase?: typeof getDb;
  embedClient?: GeminiEmbeddingClient;
  /** Hermetic vector fixtures only; deployed vectors remain 768-dimensional. */
  dimensions?: number;
  loadProfile?: typeof loadProfileTarget;
}
export function createRecallRoutes(deps:RecallRouteDependencies={}):Hono<AuthEnv>{
  const routes=new Hono<AuthEnv>(),getDatabase=deps.getDatabase??getDb;
  routes.use('*',deps.authMiddleware??requireAuth);
  routes.get('/',async c=>{
    c.header('Cache-Control','private, no-store');
    const parsed=querySchema.safeParse(c.req.query());
    if(!parsed.success)return c.json({error:'Invalid recall query',details:validationDetails(parsed.error)},400);
    const db=getDatabase(),session=c.get('session');
    const scope=await resolveProfileScope(db,session,parsed.data.profile,'read',deps.loadProfile??loadProfileTarget);
    if(!scope.ok)return c.json(scope.body,scope.status);
    const receipt=()=>recordConsultation(db,{profileId:scope.profileId,session,surface:'signals'});
    // LEFT JOIN retains eligible-but-unindexed memory. It must not become a
    // successful empty result or buy a query vector with no usable candidates.
    const candidates=async(reader:Pick<typeof db,'select'>)=>{
      const rows=await reader.select({...getTableColumns(signals),embedding:signalEmbeddings.embedding,inputHash:signalEmbeddings.inputHash,
        dimensions:signalEmbeddings.dimensions,model:signalEmbeddings.model,
        policy:sql<unknown>`CASE WHEN row_number() OVER(ORDER BY ${signals.lastEvidenceAt} DESC,${signals.createdAt} DESC,${signals.id} DESC)=1 THEN ${embeddingPolicySql(scope.profileId)} ELSE NULL END`})
        .from(signals).leftJoin(signalEmbeddings,and(eq(signalEmbeddings.signalId,signals.id),eq(signalEmbeddings.profileId,signals.profileId),
          eq(signalEmbeddings.model,deps.embedClient?.model??activeEmbeddingSpaceSql(scope.profileId)),eq(signalEmbeddings.dimensions,deps.dimensions??768)))
        .where(and(personalSignalReadable(scope.profileId),inArray(signals.status,['active','emerging'])))
        .orderBy(desc(signals.lastEvidenceAt),desc(signals.createdAt),desc(signals.id)).limit(MATCH_CANDIDATE_SCAN_LIMIT+1);
      const policy=parseEmbeddingPolicy(scope.profileId,rows[0]?.policy),space={model:deps.embedClient?.model??readableEmbeddingSpace(policy).model,dimensions:deps.dimensions??768};
      const scan=embeddingCandidateRules(policy)?.recall.scan??MATCH_CANDIDATE_SCAN_LIMIT,eligible=rows.slice(0,scan);
      const usable=eligible.filter((row):row is typeof row&{embedding:number[];inputHash:string}=>row.inputHash===embeddingInputHash(space,row.statement)&&embeddingInSpace(row.embedding,row.dimensions??0,space));
      return {policy,space,rows:usable,coverage:{scanned:eligible.length,compatible:usable.length,scanLimited:rows.length>scan}};
    };
    const before=await candidates(db);
    const unavailable=async(code:string)=>{await receipt();return c.json({error:'Semantic recall is unavailable. Use the list/detail tools to read current memory.',code,recall:{state:'unavailable',matches:[],coverage:before.coverage}},503);};
    if(!before.coverage.scanned){await receipt();return c.json({recall:{query:parsed.data.q,state:'empty',matches:[],coverage:before.coverage}});}
    if(!before.rows.length)return unavailable('recall_index_incomplete');
    let client:GeminiEmbeddingClient;
    const timeoutMs=embeddingCandidateRules(before.policy)?.recall.deadlineMs??RECALL_TIMEOUT_MS;
    try{client=deps.embedClient??createEmbeddingClient({timeoutMs,exchangeTimeoutMs:timeoutMs},before.policy);}
    catch(error){if(!(error instanceof EmbeddingProviderUnavailableError))throw error;return unavailable('recall_embedding_unavailable');}
    const dimensions=before.space.dimensions;
    const reservation=await reserveRecallAttempt(db,session.account.id);
    if(!reservation.allowed){
      await receipt();c.header('Retry-After',String(reservation.retryAfter));
      return c.json({error:'Recall attempt limit reached. Try again after the stated interval.',code:'recall_budget',recall:{state:'unavailable',matches:[]}},429);
    }
    let vector:number[],timer:ReturnType<typeof setTimeout>|undefined;
    try{
      vector=validateEmbeddingVector(await Promise.race([client.embed(parsed.data.q,'RETRIEVAL_QUERY'),
        new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('deadline')),timeoutMs);})]),dimensions);
      if(cosineSimilarity(vector,vector)===null)throw new Error('invalid vector');
    }catch{
      await receipt();
      return c.json({error:'Semantic recall is unavailable. No semantic matches were produced; use the list/detail tools to read current memory.',code:'recall_embedding_unavailable',recall:{state:'unavailable',matches:[]}},503);
    }finally{clearTimeout(timer);}
    // No transaction or source lock is held across provider HTTP. All output
    // proofs, confidence, owner feedback and conflict qualifiers share a NEW snapshot.
    const matches=await db.transaction(async tx=>{
      const fresh=await candidates(tx);
      if(embeddingPolicyIdentity(fresh.policy)!==embeddingPolicyIdentity(before.policy)||!fresh.rows.length)return 'recall_sources_changed' as const;
      const prior=new Map(before.rows.map(row=>[row.id,row.inputHash]));
      const retained=fresh.rows.filter(row=>prior.get(row.id)===row.inputHash);
      if(!retained.length)return 'recall_sources_changed' as const;
      const scored=retained.flatMap(row=>{
        const similarity=cosineSimilarity(vector,row.embedding);
        return similarity!==null&&similarity>=embeddingRetrievalMinimum(before.policy,'recall',RECALL_MIN_COSINE)?[{row,similarity}]:[];
      }).sort((a,b)=>b.similarity-a.similarity||a.row.id.localeCompare(b.row.id)).slice(0,embeddingCandidateRules(before.policy)?.recall.topK??RECALL_LIMIT);
      // Published MCP clients discard optional coverage metadata. An empty
      // subset cannot honestly represent unindexed eligible signal memory.
      if(!scored.length&&(before.coverage.compatible<before.coverage.scanned||fresh.coverage.compatible<fresh.coverage.scanned||before.coverage.scanLimited||fresh.coverage.scanLimited))return 'recall_index_incomplete' as const;
      const summaries=await decorateSignals(tx as unknown as typeof db,scope.profileId,scored.map(x=>x.row));
      const byId=new Map(summaries.map(row=>[row.id,row]));
      return scored.map(({row,similarity})=>{const {id,...summary}=byId.get(row.id)!;
        return {signalId:id,...summary,similarity:Math.round(similarity*1000)/1000};});
    },{isolationLevel:'repeatable read',accessMode:'read only'});
    if(typeof matches==='string')return unavailable(matches);
    await receipt();
    return c.json({recall:{query:parsed.data.q,state:matches.length?'ready':'empty',matches,coverage:before.coverage}});
  });
  return routes;
}
