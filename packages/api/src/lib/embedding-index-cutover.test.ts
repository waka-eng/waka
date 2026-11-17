/** WHAT THIS MOCKS, AND WHY (gate G6): transaction/execute are SQL-port fakes
 * for preflight refusals only. Server deadlines/locks require actual PG17. */
import {expect,it,vi} from 'vitest';
import {activateEmbeddingIndex,reconcileEmbeddingCutover,embeddingCutoverIntentHash,embeddingCutoverManifest,setEmbeddingCutoverDeadline} from './embedding-index-cutover.js';
import {EMBEDDING_2_SPACE} from './embedding-2-space.js';
import {EMBEDDING_2_CANDIDATE_POLICY} from './embedding-policy.js';
const input=()=>({version:'embedding-cutover-v1',mode:'empty',accountId:'10000000-0000-4000-8000-000000000001',profiles:[{id:'20000000-0000-4000-8000-000000000001',profileType:'human',epoch:'0',generation:'1',frontier:'0',controlPresent:false,coveredVersion:null,buildingSpace:null,buildingPolicy:null}],targetSpace:EMBEDDING_2_SPACE.id,thresholdPolicy:EMBEDDING_2_CANDIDATE_POLICY,approvedDbSha256:'a'.repeat(64),expiresAt:new Date(Date.now()+3600000).toISOString(),maxCells:10,maxBytes:8388608,maxStatements:100,maxDurationMs:5000,maxLedgerAttempts:100});
it('refuses arbitrary/no-op proof and policy inputs before any SQL',async()=>{
 const transaction=vi.fn();
 for(const delta of [{coverage:()=>true},{assertThresholdPolicy:()=>{}},{thresholdPolicy:'accepted'},{maxDurationMs:60000},{mode:'covered'}]){
  expect(embeddingCutoverManifest.safeParse({...input(),...delta}).success).toBe(false);
  await expect(activateEmbeddingIndex({transaction} as never,{...input(),...delta})).rejects.toMatchObject({code:'identity'});
 }
 expect(transaction).not.toHaveBeenCalled();
});
it('refuses PG16 rather than replacing the whole-transaction guarantee with JS time',async()=>{
 const execute=vi.fn(async()=>{throw {code:'42704'};});
 await expect(setEmbeddingCutoverDeadline({execute} as never)).rejects.toMatchObject({code:'unsupported_deadline'});
 expect(execute).toHaveBeenCalledOnce();
});
it('refuses an unsupported setting even on a claimed17 server before acquiring any lock',async()=>{
 const execute=vi.fn().mockRejectedValueOnce({code:'42704',message:'PRIVATE configuration data'});
 await expect(setEmbeddingCutoverDeadline({execute} as never)).rejects.toMatchObject({code:'unsupported_deadline'});
 expect(execute).toHaveBeenCalledOnce();
});

it('rejects expired mutation/read or changed historical identity before any SQL',async()=>{
 const transaction=vi.fn(),db={transaction} as never,m=embeddingCutoverManifest.parse(input());m.expiresAt='2020-01-01T00:00:00.000Z';
 await expect(activateEmbeddingIndex(db,m)).rejects.toMatchObject({code:'deadline'});
 const op={version:'embedding-cutover-read-v1',intent:m,intentSha256:embeddingCutoverIntentHash(m),approvedDbSha256:m.approvedDbSha256,expiresAt:new Date(Date.now()+3600000).toISOString(),maxDurationMs:5000};
 for(const delta of [{expiresAt:m.expiresAt},{intentSha256:'f'.repeat(64)},{approvedDbSha256:'f'.repeat(64)},{mode:'C1'},{unknown:'PRIVATE_SENTINEL'}])await expect(reconcileEmbeddingCutover(db,{...op,...delta})).rejects.toBeDefined();
 expect(transaction).not.toHaveBeenCalled();
});
