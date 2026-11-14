/** WHAT THIS MOCKS, AND WHY: `fetchFn` is the provider boundary. Real endpoint
 * payloads, parser bounds, task mapping and credential/privacy isolation execute.
 * The vectors are synthetic; this establishes no cross-provider semantic parity. */
import {afterEach,expect,it,vi} from 'vitest';
import {OpenRouterEmbeddingCandidate,requestAudioTranscript} from './openrouter-media.js';
import {GEMINI_EMBEDDING_MODEL} from './inspiration-embeddings.js';
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();});
const vector=Array.from({length:768},(_,i)=>i===0?1:0);
it.each([['RETRIEVAL_QUERY','search_query'],['RETRIEVAL_DOCUMENT','search_document']] as const)('maps %s explicitly without relabeling it as calibrated storage',async(task,inputType)=>{
 const fetchFn=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({model:'google/gemini-embedding-001',data:[{object:'embedding',index:0,embedding:vector}]})));
 vi.stubEnv('WAKA_OPENROUTER_REQUIRE_ZDR','1');const client=new OpenRouterEmbeddingCandidate({apiKey:'SYNTHETIC_OR',fetchFn});
 expect(await client.embed('Synthetic public fixture.',task)).toEqual(vector);expect(client.model).not.toBe(GEMINI_EMBEDDING_MODEL);
 const [url,init]=fetchFn.mock.calls[0]!;expect(url).toBe('https://openrouter.ai/api/v1/embeddings');
 expect(init!.headers).toMatchObject({Authorization:'Bearer SYNTHETIC_OR'});expect(init!.headers).not.toHaveProperty('x-goog-api-key');
 expect(JSON.parse(String(init!.body))).toMatchObject({model:'google/gemini-embedding-001',dimensions:768,input_type:inputType,encoding_format:'float',provider:{zdr:true,data_collection:'deny',require_parameters:true}});
 expect(fetchFn).toHaveBeenCalledOnce();
});
it.each([{model:'foreign',data:[{index:0,embedding:vector}]},{model:'google/gemini-embedding-001',data:[{index:0,embedding:[1,2]}]},
 {model:'google/gemini-embedding-001',data:[{index:1,embedding:vector}]},{model:'google/gemini-embedding-001',data:[]}])('refuses incompatible embedding envelopes without retry',async body=>{
 const fetchFn=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body)));
 await expect(new OpenRouterEmbeddingCandidate({apiKey:'SYNTHETIC_OR',fetchFn}).embed('Fixture')).rejects.toThrow();expect(fetchFn).toHaveBeenCalledOnce();
});
it('uses the dedicated STT endpoint and returns text without rewriting language',async()=>{
 const fetchFn=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({text:'여백을 남겨요. Leave room.',usage:{input_tokens:10,output_tokens:8,cost:.00001}})));
 const result=await requestAudioTranscript(new Uint8Array([1,2,3]),'audio/webm',{apiKey:'SYNTHETIC_OR',fetchFn});
 expect(result).toEqual({model:'google/gemini-3.5-transcribe',transcript:'여백을 남겨요. Leave room.'});
 const [url,init]=fetchFn.mock.calls[0]!;expect(url).toBe('https://openrouter.ai/api/v1/audio/transcriptions');
 expect(JSON.parse(String(init!.body))).toMatchObject({model:'google/gemini-3.5-transcribe',input_audio:{format:'webm',data:'AQID'}});expect(fetchFn).toHaveBeenCalledOnce();
});
it('does not retry or switch provider after a billed/uncertain media failure',async()=>{
 const fetchFn=vi.fn<typeof fetch>().mockResolvedValue(new Response('PRIVATE_BODY',{status:429}));
 await expect(requestAudioTranscript(new Uint8Array([1]),'audio/wav',{apiKey:'SYNTHETIC_OR',fetchFn})).rejects.toThrow('media HTTP failure');expect(fetchFn).toHaveBeenCalledOnce();
});
