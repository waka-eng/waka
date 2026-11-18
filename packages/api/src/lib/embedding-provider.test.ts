/** WHAT THIS MOCKS, AND WHY (gate G6): `process.env` selects closed synthetic
 * configuration and `global.fetch` is a no-network tripwire. Actual native
 * constructors/profile selection and unchanged storage geometry are executed. */
import {afterEach,expect,it,vi} from 'vitest';
import {createEmbeddingClient,configuredEmbeddingClient,readableEmbeddingSpace,embeddingInSpace} from './embedding-provider.js';
import {GEMINI_EMBEDDING_MODEL} from './inspiration-embeddings.js';
import {EMBEDDING_2_SPACE} from './embedding-2-space.js';
import {nativeEmbeddingPolicy,EMBEDDING_2_CANDIDATE_POLICY,PROVISIONAL_EMBEDDING_2_POLICY} from './embedding-policy.js';
import {assertEmbeddingDispatchDeadline,EmbeddingDispatchExpired} from './embedding-dispatch.js';
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
const ready={profileId:'00000000-0000-4000-8000-000000000001',activeSpace:EMBEDDING_2_SPACE.id,activeEpoch:1n,activeThresholdPolicy:EMBEDDING_2_CANDIDATE_POLICY,buildingSpace:null};
it('holds absent, native, and unreviewed controls even with both keys configured',()=>{
 vi.stubEnv('GEMINI_API_KEY','SYNTHETIC_NATIVE');
 vi.stubEnv('OPENROUTER_API_KEY','SYNTHETIC_OR');
 const network=vi.fn(()=>{throw Error('Unexpected network');});vi.stubGlobal('fetch',network);
 for(const policy of [undefined,nativeEmbeddingPolicy(ready.profileId),{...ready,activeThresholdPolicy:PROVISIONAL_EMBEDDING_2_POLICY}]){
  expect(()=>createEmbeddingClient(undefined,policy)).toThrow('compatibility_held');
  expect(readableEmbeddingSpace(policy)).toBeNull();
  expect(configuredEmbeddingClient({timeoutMs:5000,exchangeTimeoutMs:10000},policy)).toEqual({client:null,availability:'compatibility_held'});
 }
 expect(createEmbeddingClient(undefined,ready).model).toBe(EMBEDDING_2_SPACE.id);
 expect(createEmbeddingClient(undefined,{...nativeEmbeddingPolicy(ready.profileId),buildingSpace:EMBEDDING_2_SPACE.id},'building').model).toBe(EMBEDDING_2_SPACE.id);
 expect(()=>createEmbeddingClient(undefined,{...ready,buildingSpace:GEMINI_EMBEDDING_MODEL},'building')).toThrow('invalid_configuration');
 expect(network).not.toHaveBeenCalled();
});
it('checks dimensions and nondegenerate finite geometry without normalizing stored values',()=>{
 const space=readableEmbeddingSpace(ready)!,values=[2,...Array<number>(767).fill(0)],copy=values.slice();
 expect(embeddingInSpace(values,768,space)).toBe(true);expect(values).toEqual(copy);
 for(const [value,dimensions] of [[values,3],[[1,0],768],[Array(768).fill(0),768],[Array(768).fill(Infinity),768],[Array(768).fill(1e308),768]] as const)expect(embeddingInSpace(value,dimensions,space)).toBe(false);
});
it('checks operator expiry at the actual OpenRouter fetch seam after lazy client setup, with no HTTP or usage record',async()=>{
 vi.stubEnv('OPENROUTER_API_KEY','SYNTHETIC_OR');const network=vi.fn(async()=>Response.json({}));vi.stubGlobal('fetch',network);const usage=vi.spyOn(console,'info').mockImplementation(()=>{});let now=0;
 const client=createEmbeddingClient({timeoutMs:5000,exchangeTimeoutMs:10000,beforeDispatch:()=>assertEmbeddingDispatchDeadline({expiresAtMs:10,deadlineAtMs:10},now)},ready);
 now=11;try{await expect(client.embed('A fixed synthetic document.')).rejects.toBeInstanceOf(EmbeddingDispatchExpired);expect(network).not.toHaveBeenCalled();expect(usage).not.toHaveBeenCalled();}finally{usage.mockRestore();}
});
