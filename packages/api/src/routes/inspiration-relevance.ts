/** User-initiated checks of originals. No model call, timer, or auto-deletion. */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { inspirations, inspirationRevisions, signalEvidence, signalReviewEvidence, signals } from '../db/index.js';
import { getDb } from '../lib/db.js';
import { humanSessionsOnly, requireAuth, type AuthEnv } from '../lib/middleware.js';
import { acquireSignalDerivationLock, reconcileSignalsAfterEvidenceLoss } from '../lib/signal-derivation.js';
import { reconcilePrinciplesAfterSignalLoss } from '../lib/principle-generation.js';
import { enqueueTopOfMindRefresh, wakeCommittedBackgroundJobs } from '../lib/queue.js';
import { requestSignalDerivation } from '../lib/inspiration-derivation-requests.js';

export const INSPIRATION_REVIEW_DAYS = 30;
export const INSPIRATION_REVIEW_LATER_DAYS = 7;
const DAY = 86_400_000;
const choiceSchema = z.object({
  requestId: z.string().uuid(),
  sourceRevision: z.string().regex(/^[1-9]\d{0,18}$/),
  reviewVersion: z.number().int().min(0).max(2147483646),
  choice: z.enum(['relevant', 'not_relevant', 'later']),
}).strict();
const selection = {
  id: inspirations.id, text: inspirations.text, kind: inspirations.kind,
  createdAt: inspirations.createdAt, reviewVersion: inspirations.reviewVersion,
  memoryExcludedAt: inspirations.memoryExcludedAt, reviewAfter: inspirations.reviewAfter,
  sourceRevision: sql<string>`${inspirationRevisions.personalRevision}::text`,
  attachmentLabel: sql<string | null>`(SELECT coalesce(a.name,a.url,a.type::text) FROM attachments a
    WHERE a.profile_id=${inspirations.profileId} AND a.inspiration_id=${inspirations.id} ORDER BY a.created_at,a.id LIMIT 1)`,
};
const revisionJoin = and(eq(inspirationRevisions.profileId,inspirations.profileId),eq(inspirationRevisions.inspirationId,inspirations.id));

export function createInspirationRelevanceRoutes(deps: {getDatabase?: typeof getDb; authMiddleware?: typeof requireAuth; now?: () => Date; wake?: typeof wakeCommittedBackgroundJobs} = {}) {
  const routes = new Hono<AuthEnv>(), database = deps.getDatabase ?? getDb, now = deps.now ?? (() => new Date());
  routes.use('*', deps.authMiddleware ?? requireAuth, humanSessionsOnly);
  routes.use('*', async (c,next) => {
    c.header('Cache-Control','private, no-store');
    const profile = c.req.query('profile');
    if (c.get('session').profile.type !== 'human' || profile && profile !== c.get('session').profile.id)
      return c.json({error:'Review belongs to your personal profile.'},403);
    await next();
  });
  routes.get('/',async c => {
    const limit=z.coerce.number().int().min(1).max(5).safeParse(c.req.query('limit') ?? 2);
    if(!limit.success)return c.json({error:'Invalid review limit'},400);
    const due=sql`coalesce(${inspirations.reviewAfter}, ${inspirations.createdAt} + ${INSPIRATION_REVIEW_DAYS} * interval '24 hours')`;
    const items=await database().select(selection).from(inspirations).innerJoin(inspirationRevisions,revisionJoin)
      .where(and(eq(inspirations.profileId,c.get('session').profile.id),isNull(inspirations.memoryExcludedAt),sql`${due} <= ${now().toISOString()}::timestamptz`))
      .orderBy(due,inspirations.createdAt,inspirations.id).limit(limit.data);
    return c.json({items});
  });
  routes.get('/:id',async c => {
    const id=z.string().uuid().safeParse(c.req.param('id'));if(!id.success)return c.json({error:'Invalid inspiration'},400);
    const [item]=await database().select(selection).from(inspirations).innerJoin(inspirationRevisions,revisionJoin)
      .where(and(eq(inspirations.profileId,c.get('session').profile.id),eq(inspirations.id,id.data)));
    return item?c.json({item}):c.json({error:'Inspiration not found'},404);
  });
  routes.post('/:id',async c => {
    const id=z.string().uuid().safeParse(c.req.param('id')),body=choiceSchema.safeParse(await c.req.json().catch(()=>null));
    if(!id.success||!body.success)return c.json({error:'Invalid relevance choice'},400);
    const profileId=c.get('session').profile.id,input=body.data,at=now(),db=database();
    const result=await db.transaction(async tx => {
      await acquireSignalDerivationLock(tx,profileId);
      const [source]=await tx.select().from(inspirations).where(and(eq(inspirations.profileId,profileId),eq(inspirations.id,id.data))).for('update');
      if(!source)return 'missing' as const;
      const [revision]=await tx.select().from(inspirationRevisions).where(and(eq(inspirationRevisions.profileId,profileId),eq(inspirationRevisions.inspirationId,id.data))).for('share');
      if(revision?.personalRevision.toString()!==input.sourceRevision)return 'changed' as const;
      if(source.reviewRequestId===input.requestId && source.reviewVersion===input.reviewVersion+1 && source.reviewChoice===input.choice)return {changed:false};
      if(source.reviewVersion!==input.reviewVersion)return 'changed' as const;
      const excluded=input.choice==='not_relevant' ? at : input.choice==='relevant' ? null : source.memoryExcludedAt;
      const changed=Boolean(excluded)!==Boolean(source.memoryExcludedAt);
      await tx.update(inspirations).set({memoryExcludedAt:excluded,reviewAfter:new Date(at.getTime()+DAY*(input.choice==='later'?INSPIRATION_REVIEW_LATER_DAYS:INSPIRATION_REVIEW_DAYS)),
        reviewVersion:source.reviewVersion+1,reviewRequestId:input.requestId,reviewChoice:input.choice})
        .where(and(eq(inspirations.profileId,profileId),eq(inspirations.id,id.data)));
      if(changed && excluded){
        const direct=await tx.delete(signalEvidence).where(and(eq(signalEvidence.ownerProfileId,profileId),eq(signalEvidence.inspirationId,id.data))).returning({id:signalEvidence.signalId});
        // A review witness that used this source cannot silently keep using it.
        const reviewed=await tx.delete(signalReviewEvidence).where(and(eq(signalReviewEvidence.profileId,profileId),sql`EXISTS (SELECT 1 FROM signal_review_evidence_sources rs
          WHERE rs.profile_id=${signalReviewEvidence.profileId} AND rs.signal_id=${signalReviewEvidence.signalId}
            AND rs.answer_id=${signalReviewEvidence.answerId} AND rs.inspiration_id=${id.data}::uuid)`)).returning({id:signalReviewEvidence.signalId});
        const ids=[...new Set([...direct,...reviewed].map(row=>row.id))];
        if(ids.length)await tx.select({id:signals.id}).from(signals).where(and(eq(signals.profileId,profileId),inArray(signals.id,ids))).orderBy(signals.id).for('no key update');
        await reconcileSignalsAfterEvidenceLoss(tx,{profileId,signalIds:ids});
        await reconcilePrinciplesAfterSignalLoss(tx,{profileId,signalIds:ids});
        await enqueueTopOfMindRefresh(profileId,'signals_changed',tx);
      }else if(changed){
        await requestSignalDerivation({profileId,inspirationId:id.data,reason:'edited'},tx);
      }
      return {changed};
    });
    if(result==='missing')return c.json({error:'Inspiration not found'},404);
    if(result==='changed')return c.json({error:'This inspiration or review changed. Read it again.',code:'inspiration_changed'},409);
    if(result.changed)await (deps.wake ?? wakeCommittedBackgroundJobs)();
    return c.json({ok:true});
  });
  return routes;
}
