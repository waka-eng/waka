/** WHAT THIS MOCKS, AND WHY (gate G6): `process.env` selects closed synthetic
 * configuration and `global.fetch` is a no-network tripwire. Actual native
 * constructors/profile selection and unchanged storage geometry are executed. */
import {afterEach,expect,it,vi} from 'vitest';
import {createEmbeddingClient,configuredEmbeddingClient,readableEmbeddingSpace,requestedEmbeddingTransport,embeddingInSpace} from './embedding-provider.js';
import {GeminiEmbeddingHttpClient,GEMINI_EMBEDDING_MODEL} from './inspiration-embeddings.js';
import {EMBEDDING_2_SPACE} from './embedding-2-space.js';
import {PROVISIONAL_EMBEDDING_2_POLICY} from './embedding-policy.js';
import {assertEmbeddingDispatchDeadline,EmbeddingDispatchExpired} from './embedding-dispatch.js';
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
it('defaults to the existing native model and keeps construction free of credential/network reads',()=>{
 vi.stubEnv('WAKA_EMBEDDING_PROVIDER',undefined);vi.stubEnv('GEMINI_API_KEY',undefined);vi.stubEnv('SST_RESOURCE_GeminiApiKey',undefined);
 const network=vi.fn(()=>{throw Error('Unexpected network');});vi.stubGlobal('fetch',network);
 expect(requestedEmbeddingTransport()).toBe('gemini');expect(createEmbeddingClient()).toBeInstanceOf(GeminiEmbeddingHttpClient);
 expect(createEmbeddingClient().model).toBe(GEMINI_EMBEDDING_MODEL);expect(network).not.toHaveBeenCalled();
 expect(configuredEmbeddingClient({timeoutMs:5000,exchangeTimeoutMs:10000})).toEqual({client:null,availability:'not_configured'});
});
it('never grants the OpenRouter candidate native storage identity, even with both keys present',()=>{
 vi.stubEnv('WAKA_EMBEDDING_PROVIDER','openrouter');vi.stubEnv('GEMINI_API_KEY','SYNTHETIC_NATIVE');vi.stubEnv('OPENROUTER_API_KEY','SYNTHETIC_OR');
 const network=vi.fn(()=>{throw Error('Unexpected network');});vi.stubGlobal('fetch',network);
 expect(()=>createEmbeddingClient()).toThrow('compatibility_held');
 expect(configuredEmbeddingClient({timeoutMs:5000,exchangeTimeoutMs:10000})).toEqual({client:null,availability:'compatibility_held'});
 expect(readableEmbeddingSpace()).toEqual({model:GEMINI_EMBEDDING_MODEL,dimensions:768});expect(network).not.toHaveBeenCalled();
});
it('refuses unknown selection without echoing its value or falling back',()=>{
 vi.stubEnv('WAKA_EMBEDDING_PROVIDER','PRIVATE_CONFIGURATION_CANARY');
 expect(()=>createEmbeddingClient()).toThrow('invalid_configuration');
 try{createEmbeddingClient();}catch(error){expect(String(error)).not.toContain('PRIVATE_CONFIGURATION_CANARY');}
});
it('checks dimensions and nondegenerate finite geometry without normalizing stored values',()=>{
 const space=readableEmbeddingSpace(),values=[2,...Array<number>(767).fill(0)],copy=values.slice();
 expect(embeddingInSpace(values,768,space)).toBe(true);expect(values).toEqual(copy);
 for(const [value,dimensions] of [[values,3],[[1,0],768],[Array(768).fill(0),768],[Array(768).fill(Infinity),768],[Array(768).fill(1e308),768]] as const)expect(embeddingInSpace(value,dimensions,space)).toBe(false);
});
it('checks operator expiry at the actual OpenRouter fetch seam after lazy client setup, with no HTTP or usage record',async()=>{
 vi.stubEnv('OPENROUTER_API_KEY','SYNTHETIC_OR');const network=vi.fn(async()=>Response.json({}));vi.stubGlobal('fetch',network);const usage=vi.spyOn(console,'info').mockImplementation(()=>{});let now=0;
 const client=createEmbeddingClient({timeoutMs:5000,exchangeTimeoutMs:10000,beforeDispatch:()=>assertEmbeddingDispatchDeadline({expiresAtMs:10,deadlineAtMs:10},now)},{profileId:'00000000-0000-4000-8000-000000000001',activeSpace:EMBEDDING_2_SPACE.id,activeEpoch:1n,activeThresholdPolicy:PROVISIONAL_EMBEDDING_2_POLICY,buildingSpace:null});
 now=11;try{await expect(client.embed('A fixed synthetic document.')).rejects.toBeInstanceOf(EmbeddingDispatchExpired);expect(network).not.toHaveBeenCalled();expect(usage).not.toHaveBeenCalled();}finally{usage.mockRestore();}
});
