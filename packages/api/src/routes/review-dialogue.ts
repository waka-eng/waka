import {z} from 'zod';
import type {Hono} from 'hono';
import type {getDb} from '../lib/db.js';
import type {ReviewEnv} from './review-sessions.js';
import {changeReviewAnswer,readReviewDialogue,requestReviewQuestion,saveReviewAnswer} from '../lib/review-dialogue.js';
import {wakeCommittedBackgroundJobs} from '../lib/queue.js';

const uuid=z.string().uuid().transform(value=>value.toLowerCase());
const answer=z.string().trim().min(1).max(16000);
const revision=z.number().int().min(1).max(2147483646);
export function registerReviewDialogueRoutes(routes:Hono<ReviewEnv>,database:typeof getDb){
  routes.get('/:id/dialogue',async c=>{
    const id=uuid.safeParse(c.req.param('id'));if(!id.success)return c.json({error:'Invalid review'},400);
    return c.json(await readReviewDialogue(database(),c.get('reviewProfileId'),id.data));
  });
  routes.post('/:id/question',async c=>{
    const id=uuid.safeParse(c.req.param('id')),body=z.object({afterAnswerId:uuid.nullable().default(null),retry:z.boolean().optional()}).strict().safeParse(await c.req.json().catch(()=>null));
    if(!id.success||!body.success)return c.json({error:'Invalid question request'},400);
    const result=await requestReviewQuestion(database(),c.get('reviewProfileId'),id.data,body.data.afterAnswerId,body.data.retry);
    return c.json(result,result.question.phase==='processing'?202:200);
  });
  routes.post('/:id/answers',async c=>{
    const id=uuid.safeParse(c.req.param('id')),body=z.object({id:uuid,questionJobId:uuid,contextHash:z.string().regex(/^[a-f0-9]{64}$/),answer}).strict().safeParse(await c.req.json().catch(()=>null));
    if(!id.success||!body.success)return c.json({error:'Invalid review answer'},400);
    const result=await saveReviewAnswer(database(),c.get('reviewProfileId'),id.data,body.data);await wakeCommittedBackgroundJobs();return c.json(result);
  });
  routes.patch('/:id/answers/:answerId',async c=>{
    const id=uuid.safeParse(c.req.param('id')),answerId=uuid.safeParse(c.req.param('answerId')),body=z.object({revision,answer}).strict().safeParse(await c.req.json().catch(()=>null));
    if(!id.success||!answerId.success||!body.success)return c.json({error:'Invalid review edit'},400);
    const result=await changeReviewAnswer(database(),c.get('reviewProfileId'),id.data,answerId.data,body.data.revision,body.data.answer);await wakeCommittedBackgroundJobs();return c.json(result);
  });
  routes.delete('/:id/answers/:answerId',async c=>{
    const id=uuid.safeParse(c.req.param('id')),answerId=uuid.safeParse(c.req.param('answerId')),body=z.object({revision}).strict().safeParse(await c.req.json().catch(()=>null));
    if(!id.success||!answerId.success||!body.success)return c.json({error:'Invalid review removal'},400);
    const result=await changeReviewAnswer(database(),c.get('reviewProfileId'),id.data,answerId.data,body.data.revision,null);await wakeCommittedBackgroundJobs();return c.json(result);
  });
}
