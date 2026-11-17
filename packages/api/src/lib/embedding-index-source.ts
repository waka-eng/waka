/** Canonical read only. No provider, queue, singleton DB or work mutation. */
import {sql} from 'drizzle-orm';
import type {PostgresJsDatabase} from 'drizzle-orm/postgres-js';
import type * as schema from '../db/index.js';
import {readInspirationEmbeddingSource,buildCanonicalInspirationEmbeddingInput} from './inspiration-embedding-source.js';
import {EmbeddingSourceReadLimit} from './embedding-source-limits.js';

type Db=PostgresJsDatabase<typeof schema>;
export interface EmbeddingSourceIdentity{
 profile_id:string;source_kind:'inspiration'|'signal';source_id:string;input_scope:'personal'|'public'|'statement';
}
export async function readEmbeddingIndexSource(db:Db,work:EmbeddingSourceIdentity,lock=false,accountId?:string):Promise<{input:string;eligible:boolean}>{
 if(work.source_kind==='inspiration'){
  const row=await readInspirationEmbeddingSource(db,work.profile_id,work.source_id,work.input_scope==='public'?'public':'personal',lock?'nowait':false,accountId);
  const eligible=!!row&&!row.source.memoryExcludedAt&&(work.input_scope!=='public'||row.source.visibility==='public')&&row.input!==buildCanonicalInspirationEmbeddingInput({text:'',kind:row.source.kind});
  return {input:row?.input??'',eligible};
 }
 const owned=accountId?sql` AND EXISTS(SELECT 1 FROM profiles owner WHERE owner.id=${work.profile_id}::uuid AND owner.account_id=${accountId}::uuid)`:sql``;
 const [row]=await db.execute<{statement:string|null;oversized:boolean}>(sql`SELECT CASE WHEN octet_length(statement)<=${48000} THEN statement END AS statement,octet_length(statement)>${48000} AS oversized FROM signals WHERE profile_id=${work.profile_id}::uuid AND id=${work.source_id}::uuid${owned} ${lock?sql`FOR UPDATE NOWAIT`:sql``}`);
 if(row?.oversized)throw new EmbeddingSourceReadLimit();
 // Dismissed and retired statements still form required refusal anchors.
 return {input:row?.statement??'',eligible:!!row&&Boolean(row.statement?.trim())};
}
