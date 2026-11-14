/** Own-profile semantic retrieval. Current support and vector identity are
 * proved again after HTTP; an unavailable embedder never invents a match. */
import { and, desc, eq, getTableColumns, inArray } from 'drizzle-orm';
import { Hono, type MiddlewareHandler } from 'hono';
import { z } from 'zod';
import { signalEmbeddings, signals } from '../db/index.js';
import { recordConsultation } from '../lib/consultations.js';
import { getDb } from '../lib/db.js';
import { GeminiEmbeddingHttpClient, GEMINI_EMBEDDING_DIMENSIONS, hashEmbeddingInput, validateEmbeddingVector,
  type GeminiEmbeddingClient } from '../lib/inspiration-embeddings.js';
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
    const client=deps.embedClient??new GeminiEmbeddingHttpClient(undefined,{timeoutMs:RECALL_TIMEOUT_MS,exchangeTimeoutMs:RECALL_TIMEOUT_MS});
    const dimensions=deps.dimensions??GEMINI_EMBEDDING_DIMENSIONS;
    const candidates=async(reader:Pick<typeof db,'select'>)=>{
      const rows=await reader.select({...getTableColumns(signals),embedding:signalEmbeddings.embedding,inputHash:signalEmbeddings.inputHash})
        .from(signals).innerJoin(signalEmbeddings,and(eq(signalEmbeddings.signalId,signals.id),eq(signalEmbeddings.profileId,signals.profileId),
          eq(signalEmbeddings.model,client.model),eq(signalEmbeddings.dimensions,dimensions)))
        .where(and(personalSignalReadable(scope.profileId),inArray(signals.status,['active','emerging'])))
        .orderBy(desc(signals.lastEvidenceAt),desc(signals.createdAt),desc(signals.id)).limit(MATCH_CANDIDATE_SCAN_LIMIT);
      return rows.filter(row=>row.inputHash===hashEmbeddingInput(row.statement)&&row.embedding.length===dimensions&&cosineSimilarity(row.embedding,row.embedding)!==null);
    };
    const before=await candidates(db);
    const receipt=()=>recordConsultation(db,{profileId:scope.profileId,session,surface:'signals'});
    if(!before.length){await receipt();return c.json({recall:{query:parsed.data.q,state:'empty',matches:[]}});}
    const reservation=await reserveRecallAttempt(db,session.account.id);
    if(!reservation.allowed){
      await receipt();c.header('Retry-After',String(reservation.retryAfter));
      return c.json({error:'Recall attempt limit reached. Try again after the stated interval.',code:'recall_budget',recall:{state:'unavailable',matches:[]}},429);
    }
    let vector:number[],timer:ReturnType<typeof setTimeout>|undefined;
    try{
      vector=validateEmbeddingVector(await Promise.race([client.embed(parsed.data.q,'RETRIEVAL_QUERY'),
        new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('deadline')),RECALL_TIMEOUT_MS);})]),dimensions);
      if(cosineSimilarity(vector,vector)===null)throw new Error('invalid vector');
    }catch{
      await receipt();
      return c.json({error:'Semantic recall is unavailable. No semantic matches were produced; use the list/detail tools to read current memory.',code:'recall_embedding_unavailable',recall:{state:'unavailable',matches:[]}},503);
    }finally{clearTimeout(timer);}
    // No transaction or source lock is held across provider HTTP. All output
    // proofs, confidence, owner feedback and conflict qualifiers share a NEW snapshot.
    const matches=await db.transaction(async tx=>{
      const fresh=await candidates(tx);
      const prior=new Map(before.map(row=>[row.id,row.inputHash]));
      const scored=fresh.flatMap(row=>{
        if(prior.get(row.id)!==row.inputHash)return [];
        const similarity=cosineSimilarity(vector,row.embedding);
        return similarity!==null&&similarity>=RECALL_MIN_COSINE?[{row,similarity}]:[];
      }).sort((a,b)=>b.similarity-a.similarity||a.row.id.localeCompare(b.row.id)).slice(0,RECALL_LIMIT);
      const summaries=await decorateSignals(tx as unknown as typeof db,scope.profileId,scored.map(x=>x.row));
      const byId=new Map(summaries.map(row=>[row.id,row]));
      return scored.map(({row,similarity})=>{const {id,...summary}=byId.get(row.id)!;
        return {signalId:id,...summary,similarity:Math.round(similarity*1000)/1000};});
    },{isolationLevel:'repeatable read',accessMode:'read only'});
    await receipt();
    return c.json({recall:{query:parsed.data.q,state:matches.length?'ready':'empty',matches}});
  });
  return routes;
}
