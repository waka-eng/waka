import { Hono } from 'hono';
import { z } from 'zod';
import { getDb } from '../lib/db.js';
import { humanSessionsOnly, requireAuth, type AuthEnv } from '../lib/middleware.js';
import { chooseReviewItem, completeReviewSession, createReviewSession, MAX_REVIEW_ITEMS, readActiveReview, readReviewSession, ReviewSessionError } from '../lib/review-sessions.js';
import { profileQuerySchema } from './inspirations-validation.js';
import { resolveTargetProfile } from './inspirations-tenancy.js';
import {registerReviewDialogueRoutes} from './review-dialogue.js';

const uuid=z.string().uuid().transform(value=>value.toLowerCase());
const revision=z.number().int().min(0).max(2147483646);
const createSchema=z.object({id:uuid,inspirationIds:z.array(uuid).min(1).max(MAX_REVIEW_ITEMS)
  .refine(ids=>new Set(ids).size===ids.length,'Choose each inspiration once').optional()}).strict();
const choiceSchema=z.object({revision,inspirationId:uuid,sourceRevision:z.string().regex(/^[1-9]\d{0,18}$/)
  .refine(value=>BigInt(value)<=9223372036854775807n),choice:z.enum(['keep','skip']).nullable()}).strict();
export type ReviewEnv=AuthEnv&{Variables:{reviewProfileId:string}};

export function createReviewSessionRoutes(deps:{getDatabase?:typeof getDb;authMiddleware?:typeof requireAuth}={}) {
  const routes=new Hono<ReviewEnv>(),database=deps.getDatabase??getDb;
  routes.use('*',async(c,next)=>{c.header('Cache-Control','private, no-store');await next();});
  routes.use('*',deps.authMiddleware??requireAuth,humanSessionsOnly);
  routes.onError((error,c)=>{
    if (error instanceof ReviewSessionError) return c.json({error:error.message,code:error.code},error.status);
    const code=(error as {code?:string;cause?:{code?:string}}).cause?.code??(error as {code?:string}).code;
    if (code==='23505') return c.json({error:'This review already exists. Check your open review.',code:'review_conflict'},409);
    if (code==='55P03'||code==='40P01'||code==='40001') return c.json({error:'The source is changing. Check the review again.',code:'review_busy'},409);
    // Driver errors include SQL parameters, which can contain private answers.
    console.error('[review-sessions]',{code:typeof code==='string'&&/^[0-9A-Z]{5}$/.test(code)?code:'unknown'});
    return c.json({error:'The review could not be updated.'},500);
  });
  routes.use('*',async(c,next)=>{
    const query=profileQuerySchema.safeParse(c.req.query());
    if (!query.success) return c.json({error:'Invalid profile'},400);
    const target=await resolveTargetProfile(database(),c.get('session'),query.data.profile,c.req.method==='GET'?'read':'write');
    if (!target.ok) return c.json(target.body,target.status);
    c.set('reviewProfileId',target.profileId);
    await next();
  });
  routes.get('/active',async c=>c.json({session:await readActiveReview(database(),c.get('reviewProfileId'))}));
  routes.post('/',async c=>{
    const input=createSchema.safeParse(await c.req.json().catch(()=>null));
    if (!input.success) return c.json({error:'Choose up to five available inspirations and a review id.'},400);
    return c.json({session:await createReviewSession(database(),c.get('reviewProfileId'),input.data)});
  });
  routes.get('/:id',async c=>{
    const id=uuid.safeParse(c.req.param('id')); if (!id.success) return c.json({error:'Invalid review id'},400);
    const session=await readReviewSession(database(),c.get('reviewProfileId'),id.data);
    return session?c.json({session}):c.json({error:'Review not found'},404);
  });
  routes.post('/:id/choices',async c=>{
    const id=uuid.safeParse(c.req.param('id')),input=choiceSchema.safeParse(await c.req.json().catch(()=>null));
    if (!id.success || !input.success) return c.json({error:'Invalid review choice'},400);
    return c.json({session:await chooseReviewItem(database(),c.get('reviewProfileId'),id.data,input.data)});
  });
  routes.post('/:id/complete',async c=>{
    const id=uuid.safeParse(c.req.param('id')),input=z.object({revision}).strict().safeParse(await c.req.json().catch(()=>null));
    if (!id.success || !input.success) return c.json({error:'Invalid review completion'},400);
    return c.json({session:await completeReviewSession(database(),c.get('reviewProfileId'),id.data,input.data.revision)});
  });
  registerReviewDialogueRoutes(routes,database);
  return routes;
}
