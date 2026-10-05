import {and,asc,eq,inArray,isNotNull,ne,sql} from 'drizzle-orm';
import {groupMembers,principleGenerationSteps,profiles} from '../db/index.js';
import type {getDb} from './db.js';
import {assertGenerationRevision,type GenerationRevision} from './generation-revision.js';
import {BackgroundJobHeldError} from './background-job-hold.js';

type Db=ReturnType<typeof getDb>;
type Tx=Parameters<Parameters<Db['transaction']>[0]>[0];
export const PRINCIPLE_WORK_LIMITS={callsPerPass:4,callsPerHour:40,pendingMs:10*60*1000,responseCharacters:32000} as const;
export interface PrincipleWorkOptions{db:Db;profileId:string;billingProfileId:string;inputHash:string;revision:GenerationRevision;jobId?:string;beforeProgress?:(tx:Tx)=>Promise<void>}

/** Completed results are reused; each actual dispatch has a retained receipt.
 * No model is called while a transaction or advisory lock is held. */
export function principleWork(options:PrincipleWorkOptions){
  const {db,profileId,billingProfileId,inputHash,revision,jobId}=options;
  let calls=0;
  let completed:Map<string,unknown>|null=null;
  return {async run<T>(stepKey:string,operation:()=>Promise<T>,validate:(value:unknown)=>T):Promise<T>{
    const key=and(eq(principleGenerationSteps.profileId,profileId),eq(principleGenerationSteps.inputHash,inputHash),eq(principleGenerationSteps.stepKey,stepKey),eq(principleGenerationSteps.kind,'model'));
    if(!completed){
      const rows=await db.select({key:principleGenerationSteps.stepKey,response:principleGenerationSteps.response}).from(principleGenerationSteps)
        .where(and(eq(principleGenerationSteps.profileId,profileId),eq(principleGenerationSteps.inputHash,inputHash),eq(principleGenerationSteps.kind,'model'),eq(principleGenerationSteps.status,'ready'),isNotNull(principleGenerationSteps.response)));
      completed=new Map(rows.map(row=>[row.key,row.response]));
    }
    if(completed.has(stepKey))return validate(completed.get(stepKey));
    if(calls>=PRINCIPLE_WORK_LIMITS.callsPerPass)throw new BackgroundJobHeldError(new Date(Date.now()+1000),'Principle comparisons continue in the next pass');
    const reservation=await db.transaction(async tx=>{
      const owners=await tx.select({id:profiles.id,accountId:profiles.accountId,groupId:profiles.groupId}).from(profiles).where(inArray(profiles.id,[profileId,billingProfileId])).orderBy(asc(profiles.id)).for('key share',{noWait:true});
      const target=owners.find(row=>row.id===profileId),payer=owners.find(row=>row.id===billingProfileId);
      if(!target||!payer?.accountId)throw new Error('Principle billing scope changed');
      if(target.groupId){const [member]=await tx.select({id:groupMembers.id}).from(groupMembers).where(and(eq(groupMembers.groupId,target.groupId),eq(groupMembers.profileId,billingProfileId)));if(!member)throw new Error('Principle billing scope changed');}
      else if(target.accountId!==payer.accountId)throw new Error('Principle billing scope changed');
      await assertGenerationRevision(tx,revision);await options.beforeProgress?.(tx);
      const [ready]=await tx.select().from(principleGenerationSteps).where(and(key,eq(principleGenerationSteps.status,'ready'),isNotNull(principleGenerationSteps.response))).limit(1);
      if(ready)return {cached:ready.response};
      const [pending]=await tx.select().from(principleGenerationSteps).where(and(key,eq(principleGenerationSteps.status,'running'))).limit(1);
      if(pending&&Date.now()-pending.startedAt.getTime()<PRINCIPLE_WORK_LIMITS.pendingMs)
        throw new BackgroundJobHeldError(new Date(Date.now()+5000),'A Principle model request is already running');
      if(pending)await tx.update(principleGenerationSteps).set({status:'failed',finishedAt:new Date()}).where(eq(principleGenerationSteps.id,pending.id));
      const [owner]=await tx.select({accountId:profiles.accountId}).from(profiles).where(eq(profiles.id,billingProfileId));
      if(!owner?.accountId)throw new Error('Principle work needs a billing account');
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${'waka.principle-budget:'+owner.accountId},0))`);
      const [usage]=await tx.execute<{count:number;oldest:string|null}>(sql`SELECT count(*)::int AS count,min(s.started_at)::text AS oldest
        FROM principle_generation_steps s JOIN profiles p ON p.id=s.billing_profile_id
        WHERE p.account_id=${owner.accountId}::uuid AND s.kind='model' AND s.started_at>=now()-interval '1 hour'`);
      if(usage.count>=PRINCIPLE_WORK_LIMITS.callsPerHour)throw new BackgroundJobHeldError(new Date(Date.parse(usage.oldest!)+3600001),'Principle model budget waits');
      // Discard obsolete response bodies without erasing recent billing receipts.
      await tx.update(principleGenerationSteps).set({response:null}).where(and(eq(principleGenerationSteps.profileId,profileId),ne(principleGenerationSteps.inputHash,inputHash),eq(principleGenerationSteps.kind,'model'),ne(principleGenerationSteps.status,'running')));
      await tx.delete(principleGenerationSteps).where(and(eq(principleGenerationSteps.profileId,profileId),ne(principleGenerationSteps.inputHash,inputHash),eq(principleGenerationSteps.kind,'model'),sql`${principleGenerationSteps.startedAt}<now()-interval '1 hour'`));
      const [row]=await tx.insert(principleGenerationSteps).values({profileId,billingProfileId,jobId,inputHash,stepKey,kind:'model',status:'running'}).returning({id:principleGenerationSteps.id});
      return {id:row!.id};
    });
    if('cached' in reservation){completed.set(stepKey,reservation.cached);return validate(reservation.cached);}
    calls++;
    try{
      const result=validate(await operation());
      if(JSON.stringify(result).length>PRINCIPLE_WORK_LIMITS.responseCharacters)throw new Error('Principle result exceeds checkpoint budget');
      await db.transaction(async tx=>{
        await assertGenerationRevision(tx,revision);await options.beforeProgress?.(tx);
        const rows=await tx.update(principleGenerationSteps).set({status:'ready',response:result,finishedAt:new Date()})
          .where(and(eq(principleGenerationSteps.id,reservation.id!),eq(principleGenerationSteps.status,'running'))).returning({id:principleGenerationSteps.id});
        if(!rows.length)throw new Error('Principle reservation was superseded');
      });
      completed.set(stepKey,result);
      return result;
    }catch(error){
      await db.update(principleGenerationSteps).set({status:'failed',finishedAt:new Date()}).where(and(eq(principleGenerationSteps.id,reservation.id!),eq(principleGenerationSteps.status,'running')));
      throw error;
    }
  }};
}
