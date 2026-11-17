/** WHAT THIS MOCKS, AND WHY (gate G6): nothing. CI16 exercises the actual
 * unsupported-C1 refusal with zero metadata changes. Positive/deadline/ACK
 * semantics run explicitly on PG17 in test/pg17/embedding-index-cutover.pg17.ts. */
import {randomUUID} from 'node:crypto';
import {beforeAll,afterAll,expect,it} from 'vitest';
import {createTestDatabase,type TestDatabase} from '../../test/helpers/index.js';
import {activateEmbeddingIndex,type EmbeddingCutoverManifest} from './embedding-index-cutover.js';
import {EMBEDDING_2_SPACE} from './embedding-2-space.js';
import {EMBEDDING_2_CANDIDATE_POLICY} from './embedding-policy.js';
let t:TestDatabase;
beforeAll(async()=>{expect(['127.0.0.1','localhost','::1','[::1]']).toContain(new URL(process.env.DB_CONNECTION_URL!).hostname);t=await createTestDatabase();});
afterAll(async()=>t?.cleanup());
it('uses the actual server capability: CI16 fails closed;17 can enroll an actually empty owned profile',async()=>{
 const[a]=await t.sql`INSERT INTO accounts(email) VALUES(${randomUUID()+'@example.test'}) RETURNING id`;
 const[p]=await t.sql`INSERT INTO profiles(account_id,type,name) VALUES(${a.id},'human','Synthetic empty profile') RETURNING id`;
 const[g]=await t.sql`SELECT revision::text AS revision FROM generation_revisions WHERE profile_id=${p.id}`;
 const m:EmbeddingCutoverManifest={version:'embedding-cutover-v1',mode:'empty',accountId:a.id,profiles:[{id:p.id,profileType:'human',epoch:'0',generation:g.revision,frontier:'0',controlPresent:false,coveredVersion:null,buildingSpace:null,buildingPolicy:null}],targetSpace:EMBEDDING_2_SPACE.id,thresholdPolicy:EMBEDDING_2_CANDIDATE_POLICY,approvedDbSha256:'a'.repeat(64),expiresAt:new Date(Date.now()+3600000).toISOString(),maxCells:1,maxBytes:8388608,maxStatements:100,maxDurationMs:5000,maxLedgerAttempts:10};
 const[v]=await t.sql`SHOW server_version_num`;
 if(Number(v.server_version_num)<170000){
  await expect(activateEmbeddingIndex(t.db,m)).rejects.toMatchObject({code:'unsupported_deadline'});
  expect(await t.sql`SELECT profile_id FROM profile_embedding_indexes WHERE profile_id=${p.id}`).toHaveLength(0);
  expect(await t.sql`SELECT revision::text AS revision FROM generation_revisions WHERE profile_id=${p.id}`).toEqual([g]);
 }else expect(await activateEmbeddingIndex(t.db,m)).toMatchObject({activated:true,profiles:1,providerCalls:0});
 expect(await t.sql`SELECT id FROM embedding_index_attempts WHERE account_id=${a.id}`).toHaveLength(0);
});
