/** Only freshly inserted human profiles. Existing login/recovery winners never
 * enter this helper. Direct SQL and absent-control readers remain native001. */
import {sql} from 'drizzle-orm';
import type {PostgresJsDatabase} from 'drizzle-orm/postgres-js';
import {profiles} from '../db/index.js';
import {EMBEDDING_2_SPACE} from './embedding-2-space.js';
import {EMBEDDING_2_CANDIDATE_POLICY} from './embedding-policy.js';
type Db=PostgresJsDatabase<typeof import('../db/index.js')>;
type Tx=Parameters<Parameters<Db['transaction']>[0]>[0];
export function newHumanEmbeddingEnrollmentEnabled(env:Record<string,string|undefined>){
 const flag=env.WAKA_ENROLL_NEW_EMPTY_HUMAN_EMBEDDING_2;
 if(flag===undefined||flag==='0')return false;
 if(flag!=='1'||!['development','dev','production'].includes(env.WAKA_STAGE??''))throw Error('New-human embedding enrollment configuration is invalid');
 let app:unknown;try{app=JSON.parse(env.SST_RESOURCE_App??'null');}catch{}
 if(!app||typeof app!=='object'||(app as {name?:unknown}).name!=='waka'||(app as {stage?:unknown}).stage!==env.WAKA_STAGE)throw Error('New-human embedding enrollment configuration is invalid');
 return true;
}
export async function insertHumanProfile(tx:Tx,input:{accountId:string;name:string;preferredLocale?:typeof profiles.$inferInsert.preferredLocale;avatarUrl?:string|null}){
 const enroll=newHumanEmbeddingEnrollmentEnabled(process.env);
 const [row]=await tx.insert(profiles).values({...input,type:'human'}).returning();
 if(!row)throw Error('Human profile creation failed');
 if(enroll){
  // The inserted row is invisible outside this creation transaction. There is
  // no existing profile ID parameter, asynchronous wake or provider path.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('waka.embedding-index:'||${row.id}::text,0))`);
  const [r]=await tx.execute<{empty:boolean}>(sql`SELECT NOT EXISTS(SELECT 1 FROM inspirations WHERE profile_id=${row.id}::uuid)
   AND NOT EXISTS(SELECT 1 FROM signals WHERE profile_id=${row.id}::uuid)
   AND NOT EXISTS(SELECT 1 FROM embedding_index_work WHERE profile_id=${row.id}::uuid)
   AND NOT EXISTS(SELECT 1 FROM embedding_index_attempts WHERE profile_id=${row.id}::uuid)
   AND NOT EXISTS(SELECT 1 FROM inspiration_embeddings WHERE profile_id=${row.id}::uuid)
   AND NOT EXISTS(SELECT 1 FROM signal_embeddings WHERE profile_id=${row.id}::uuid) AS empty`);
  if(!r?.empty)throw Error('New human profile is not empty');
  const generation=await tx.execute(sql`SELECT profile_id FROM generation_revisions WHERE profile_id=${row.id}::uuid FOR UPDATE NOWAIT`);
  if(generation.length!==1)throw Error('New human generation metadata is unavailable');
  await tx.execute(sql`INSERT INTO profile_embedding_indexes(profile_id,active_space,active_epoch,active_threshold_policy,cutover_covered_version)
   VALUES(${row.id}::uuid,${EMBEDDING_2_SPACE.id},1,${EMBEDDING_2_CANDIDATE_POLICY},0)`);
  await tx.execute(sql`SELECT advance_generation_revisions(ARRAY[${row.id}::uuid])`);
 }
 return row;
}
