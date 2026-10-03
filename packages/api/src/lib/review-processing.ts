import {and,eq,sql} from 'drizzle-orm';
import {backgroundJobs,reviewAnswerProcessing,reviewSessions,type BackgroundJobResult} from '../db/index.js';
import type {getDb} from './db.js';
import {parseTopOfMindRefreshResult} from './top-of-mind-refresh-status.js';
import {enqueueReviewAnswerDerivation,enqueueTopOfMindRefresh,STALE_LOCK_SECONDS,wakeCommittedBackgroundJobs} from './queue.js';
import {personalPrincipleSupportCurrent} from './personal-output.js';
import {PRINCIPLE_MIN_SIGNALS} from './principle-generation.js';

type Database=ReturnType<typeof getDb>;
type Reader=Pick<Database,'execute'>;
type Phase='pending'|'ready'|'needs_context'|'failed';
export interface ReviewProcessingStatus {
  profileId:string;sessionId:string;phase:Phase|'empty';answerCount:number;completedCount:number;
  canRetry:boolean;runAfter:string|null;result:BackgroundJobResult|null;
  relatedPrinciples:Array<{id:string;statement:string}>;
}

/** Answer/source/statement changes request a newer numbered derivation in
 * their transaction. An old receipt cannot satisfy that later request. */
const currentRequest=sql`NOT EXISTS(SELECT 1 FROM background_jobs d
  WHERE d.profile_id=p.profile_id AND d.idempotency_key='derive_review_answer:'||p.profile_id::text||':'||p.answer_id::text
    AND (p.derivation_job_id IS DISTINCT FROM d.id OR (p.derivation_request_version>=d.request_version) IS NOT TRUE))`;

/** Same transaction as publication, not the later queue success marker. */
export async function recordReviewReadingResult(tx:Reader,input:{profileId:string;jobId:string;requestVersion:string;result:BackgroundJobResult}){
  const result=parseTopOfMindRefreshResult(input.result);
  if(!result)throw new Error('Invalid review reading result');
  if(result.topOfMindId){
    const [owned]=await tx.execute(sql`SELECT id FROM top_of_minds WHERE id=${result.topOfMindId}::uuid
      AND profile_id=${input.profileId}::uuid AND version=${result.version}`);
    if(!owned)throw new Error('Review reading owner changed');
  }
  await tx.execute(sql`UPDATE review_answer_processing p SET result=${JSON.stringify(result)}::jsonb,
    completed_at=CASE WHEN p.derived_at IS NOT NULL AND ${currentRequest} THEN clock_timestamp() ELSE NULL END,
    updated_at=clock_timestamp()
    FROM review_answers a WHERE a.profile_id=p.profile_id AND a.id=p.answer_id AND a.deleted_at IS NULL
      AND p.profile_id=${input.profileId}::uuid AND p.reading_job_id=${input.jobId}::uuid
      AND p.reading_request_version<=${input.requestVersion}::bigint AND p.result IS NULL`);
}

type Row = {
  answerId:string;current:boolean;derived:boolean;completed:boolean;result:unknown;
  derivationId:string|null;readingId:string|null;derivationStatus:string|null;readingStatus:string|null;
  derivationExpired:boolean|null;readingExpired:boolean|null;derivationExhausted:boolean|null;readingExhausted:boolean|null;
  derivationRunAfter:string|null;readingRunAfter:string|null;unresolved:boolean;
}
async function rowsForReview(db:Reader,profileId:string,sessionId:string){
  return db.execute<Row>(sql`SELECT a.id AS "answerId",(p.answer_id IS NOT NULL AND ${currentRequest}) AS current,
    p.derived_at IS NOT NULL AS derived,p.completed_at IS NOT NULL AS completed,p.result,
    d.id AS "derivationId",r.id AS "readingId",d.status::text AS "derivationStatus",r.status::text AS "readingStatus",
    (d.locked_at IS NULL OR d.locked_at<now()-${STALE_LOCK_SECONDS}*interval '1 second') AS "derivationExpired",
    (r.locked_at IS NULL OR r.locked_at<now()-${STALE_LOCK_SECONDS}*interval '1 second') AS "readingExpired",
    d.attempts>=d.max_attempts AS "derivationExhausted",r.attempts>=r.max_attempts AS "readingExhausted",
    d.run_after::text AS "derivationRunAfter",r.run_after::text AS "readingRunAfter",
    EXISTS(SELECT 1 FROM review_signal_support s WHERE s.profile_id=a.profile_id AND s.answer_id=a.id
      AND s.material_hash=p.material_hash AND s.verdict='unresolved') AS unresolved
    FROM review_answers a LEFT JOIN review_answer_processing p ON p.profile_id=a.profile_id AND p.answer_id=a.id
    LEFT JOIN background_jobs d ON d.profile_id=a.profile_id AND d.idempotency_key='derive_review_answer:'||a.profile_id::text||':'||a.id::text
    LEFT JOIN background_jobs r ON r.profile_id=a.profile_id AND r.id=p.reading_job_id AND r.type::text='refresh_top_of_mind'
    WHERE a.profile_id=${profileId}::uuid AND a.session_id=${sessionId}::uuid AND a.deleted_at IS NULL
    ORDER BY a.created_at,a.id`);
}
function phaseFor(row:Row):{phase:Phase;stage:'derivation'|'reading';runAfter:string|null}{
  const stage=row.current&&row.derived?'reading':'derivation';
  if(row.current&&row.derived&&row.completed&&parseTopOfMindRefreshResult(row.result))return {phase:'ready',stage,runAfter:null};
  if(row.current&&!row.derived&&row.unresolved&&row.derivationStatus==='succeeded')return {phase:'needs_context',stage,runAfter:null};
  const status=stage==='reading'?row.readingStatus:row.derivationStatus;
  const exhausted=stage==='reading'?row.readingExhausted:row.derivationExhausted;
  const expired=stage==='reading'?row.readingExpired:row.derivationExpired;
  const waiting=stage==='reading'?row.readingRunAfter:row.derivationRunAfter;
  if(status==='pending'||status==='running'&&(!expired||!exhausted))return {phase:'pending',stage,runAfter:status==='pending'&&waiting?new Date(waiting).toISOString():null};
  return {phase:'failed',stage,runAfter:null};
}
async function checkedPhase(db:Reader,row:Row,profileId:string){
  const item=phaseFor(row),result=item.phase==='ready'?parseTopOfMindRefreshResult(row.result):null;
  if(result?.topOfMindId){
    const [owned]=await db.execute(sql`SELECT id FROM top_of_minds WHERE id=${result.topOfMindId}::uuid AND profile_id=${profileId}::uuid AND version=${result.version}`);
    if(!owned)return {...item,phase:'failed' as const};
  }
  return item;
}
async function readStatus(db:Reader,profileId:string,sessionId:string):Promise<ReviewProcessingStatus|null>{
  const [owned]=await db.execute(sql`SELECT id FROM review_sessions WHERE profile_id=${profileId}::uuid AND id=${sessionId}::uuid`);
  if(!owned)return null;
  const rows=await rowsForReview(db,profileId,sessionId);
  const state:ReviewProcessingStatus={profileId,sessionId,phase:'empty',answerCount:rows.length,completedCount:0,canRetry:false,runAfter:null,result:null,relatedPrinciples:[]};
  if(!rows.length)return state;
  const states=[];
  for(const row of rows){
    const item=await checkedPhase(db,row,profileId);
    const result=item.phase==='ready'?parseTopOfMindRefreshResult(row.result):null;
    states.push(item);
    if(item.phase==='ready'){
      state.completedCount++;
      if(result&&(!state.result||result.version>state.result.version||result.version===state.result.version&&result.outcome==='changed'))state.result=result;
    }
  }
  state.canRetry=states.some(item=>item.phase==='failed');
  state.phase=states.some(item=>item.phase==='pending')?'pending':state.canRetry?'failed':states.some(item=>item.phase==='needs_context')?'needs_context':'ready';
  state.runAfter=states.map(item=>item.runAfter).filter((value):value is string=>value!==null).sort()[0]??null;
  // Never offer an earlier completed answer as the whole review's outcome.
  if(state.phase!=='ready')state.result=null;
  else state.relatedPrinciples=await db.execute<{id:string;statement:string}>(sql`SELECT principles.id,principles.statement FROM principles
    WHERE principles.profile_id=${profileId}::uuid AND principles.unsupported_at IS NULL
      AND ${personalPrincipleSupportCurrent(profileId,PRINCIPLE_MIN_SIGNALS)}
      AND EXISTS(SELECT 1 FROM principle_signals ps JOIN signal_review_evidence e ON e.profile_id=ps.profile_id AND e.signal_id=ps.signal_id
        WHERE ps.principle_id=principles.id AND e.profile_id=${profileId}::uuid AND e.session_id=${sessionId}::uuid
          AND review_evidence_current(e.profile_id,e.signal_id,e.answer_id))
    ORDER BY principles.rank,principles.id LIMIT 3`);
  return state;
}
export function loadReviewProcessingStatus(db:Database,profileId:string,sessionId:string){
  return db.transaction(tx=>readStatus(tx,profileId,sessionId),{isolationLevel:'repeatable read',accessMode:'read only'});
}

/** Explicit retry observes active/held work. It never regenerates a question
 * or changes an answer. The account model budget still bounds actual calls. */
export async function recoverReviewProcessing(db:Database,profileId:string,sessionId:string){
  const state=await db.transaction(async tx=>{
    const [session]=await tx.select({id:reviewSessions.id}).from(reviewSessions)
      .where(and(eq(reviewSessions.profileId,profileId),eq(reviewSessions.id,sessionId))).for('update',{noWait:true});
    if(!session)return null;
    const rows=await rowsForReview(tx,profileId,sessionId);
    for(const row of rows){
      const item=await checkedPhase(tx,row,profileId);if(item.phase!=='failed')continue;
      const jobId=item.stage==='reading'?row.readingId:row.derivationId;
      if(jobId){
        const [job]=await tx.select().from(backgroundJobs).where(and(eq(backgroundJobs.id,jobId),eq(backgroundJobs.profileId,profileId))).for('update',{noWait:true});
        if(job?.status==='pending'||job?.status==='running'&&job.lockedAt&&job.lockedAt.getTime()>Date.now()-STALE_LOCK_SECONDS*1000)continue;
        if(job?.status==='running')await tx.update(backgroundJobs).set({status:'failed',lockedAt:null}).where(eq(backgroundJobs.id,job.id));
      }
      if(item.stage==='reading'){
        const reading=await enqueueTopOfMindRefresh(profileId,'signals_changed',tx);
        await tx.update(reviewAnswerProcessing).set({readingJobId:reading.jobId,readingRequestVersion:BigInt(reading.requestVersion),result:null,completedAt:null})
          .where(and(eq(reviewAnswerProcessing.profileId,profileId),eq(reviewAnswerProcessing.answerId,row.answerId)));
      }else await enqueueReviewAnswerDerivation(profileId,sessionId,row.answerId,tx);
    }
    return readStatus(tx,profileId,sessionId);
  });
  if(state)await wakeCommittedBackgroundJobs();return state;
}
