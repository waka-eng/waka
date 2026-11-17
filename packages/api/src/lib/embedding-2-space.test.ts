/** WHAT THIS MOCKS, AND WHY (gate G6): `fetchFn` supplies deterministic
 * provider envelopes; `process.env` supplies synthetic privacy settings only.
 * Actual model2 formatter, hashing, request/parser and native factory execute.
 * This proves the wire contract, not model quality, availability or migration. */
import {afterEach,expect,it,vi} from 'vitest';
import {EMBEDDING_2_SPACE,formatEmbedding2Input,hashEmbedding2Input} from './embedding-2-space.js';
import {OpenRouterEmbedding2Candidate} from './openrouter-media.js';
import {createEmbeddingClient,readableEmbeddingSpace} from './embedding-provider.js';
import {GEMINI_EMBEDDING_MODEL,hashEmbeddingInput} from './inspiration-embeddings.js';

afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();});
const values=[2,1,...Array<number>(766).fill(0)];
const input='\r\n조용한 시간.  ';
it('versions the exact model/provider/format/dimensions/raw policy separately from native001',()=>{
 expect(EMBEDDING_2_SPACE).toEqual({id:'waka.embedding.gemini-2.text-retrieval.v1.768.raw',wireModel:'google/gemini-embedding-2',provider:'google-ai-studio',dimensions:768,documentPrefix:'title: none | text: ',queryPrefix:'task: search result | query: ',normalization:'provider-output-raw-no-client-l2-v1',inputHash:'sha256-exact-formatted-utf8-v1'});
 expect(formatEmbedding2Input(input,'RETRIEVAL_DOCUMENT')).toBe('title: none | text: '+input);
 expect(formatEmbedding2Input(input,'RETRIEVAL_QUERY')).toBe('task: search result | query: '+input);
 expect(hashEmbedding2Input(input,'RETRIEVAL_DOCUMENT')).toBe('ebdcd597c066f798b0ca595a6cdec791f1053d2c75041fa0f3bfbd8481b90aed');
 expect(hashEmbedding2Input(input,'RETRIEVAL_QUERY')).toBe('ccc98454363c687ae7ee22f2414861ef17b60960e7f1b9fa2666fb0596874bf1');
 expect(hashEmbedding2Input(input,'RETRIEVAL_DOCUMENT')).not.toBe(hashEmbeddingInput(input));
 vi.stubEnv('WAKA_EMBEDDING_PROVIDER',undefined);
 expect(createEmbeddingClient().model).toBe(GEMINI_EMBEDDING_MODEL);expect(readableEmbeddingSpace().model).toBe(GEMINI_EMBEDDING_MODEL);
 expect(new OpenRouterEmbedding2Candidate().model).not.toBe(GEMINI_EMBEDDING_MODEL);
});
it.each(['RETRIEVAL_DOCUMENT','RETRIEVAL_QUERY'] as const)('sends exact model2 %s instructions as input text, with no task parameter',async task=>{
 const fetchFn=vi.fn<typeof fetch>().mockResolvedValue(Response.json({model:'google/gemini-embedding-2',data:[{index:0,embedding:values}]}));
 vi.stubEnv('WAKA_OPENROUTER_DATA_COLLECTION','deny');vi.stubEnv('WAKA_OPENROUTER_REQUIRE_ZDR','1');
 const client=new OpenRouterEmbedding2Candidate({apiKey:'SYNTHETIC_OR_ONLY',fetchFn});
 expect(await client.embed(input,task)).toEqual(values);expect(values[0]).toBe(2);
 expect(fetchFn).toHaveBeenCalledOnce();const [url,init]=fetchFn.mock.calls[0]!;
 expect(url).toBe('https://openrouter.ai/api/v1/embeddings');
 expect(init!.headers).toMatchObject({Authorization:'Bearer SYNTHETIC_OR_ONLY'});expect(init!.headers).not.toHaveProperty('x-goog-api-key');
 expect(JSON.parse(String(init!.body))).toEqual({model:'google/gemini-embedding-2',input:formatEmbedding2Input(input,task),dimensions:768,encoding_format:'float',provider:{data_collection:'deny',zdr:true,require_parameters:true,only:['google-ai-studio'],order:['google-ai-studio'],allow_fallbacks:false}});
});
it('retains unset account policy and stops a failed response without retry or native fallback',async()=>{
 vi.stubEnv('WAKA_OPENROUTER_DATA_COLLECTION',undefined);vi.stubEnv('WAKA_OPENROUTER_REQUIRE_ZDR',undefined);
 const fetchFn=vi.fn<typeof fetch>().mockResolvedValue(new Response('PRIVATE_PROVIDER_CANARY',{status:429}));
 const client=new OpenRouterEmbedding2Candidate({apiKey:'SYNTHETIC_OR_ONLY',fetchFn});
 await expect(client.embed('Synthetic text')).rejects.toMatchObject({status:429});
 expect(fetchFn).toHaveBeenCalledOnce();expect(JSON.parse(String(fetchFn.mock.calls[0]![1]!.body)).provider).toEqual({require_parameters:true,only:['google-ai-studio'],order:['google-ai-studio'],allow_fallbacks:false});
 try{await new OpenRouterEmbedding2Candidate({apiKey:'SYNTHETIC_OR_ONLY',fetchFn:async()=>new Response('PRIVATE_PROVIDER_CANARY',{status:400})}).embed('Fixture');}catch(error){expect(String(error)).not.toContain('PRIVATE_PROVIDER_CANARY');}
});
it.each([
 {model:'google/gemini-embedding-2-preview',data:[{index:0,embedding:values}]},
 {model:'google/gemini-embedding-001',data:[{index:0,embedding:values}]},
 {model:'google/gemini-embedding-2',data:[{index:1,embedding:values}]},
 {model:'google/gemini-embedding-2',data:[]},
 {model:'google/gemini-embedding-2',data:[{index:0,embedding:[1,2]}]},
 {model:'google/gemini-embedding-2',data:[{index:0,embedding:Array(768).fill(0)}]},
 {model:'google/gemini-embedding-2',data:[{index:0,embedding:[null,...Array(767).fill(1)]}]},
 {model:'google/gemini-embedding-2',data:[{index:0,embedding:Array(768).fill(1e308)}]},
])('refuses foreign/malformed/degenerate vectors without retry',async body=>{
 const fetchFn=vi.fn<typeof fetch>().mockResolvedValue(Response.json(body));
 await expect(new OpenRouterEmbedding2Candidate({apiKey:'SYNTHETIC_OR_ONLY',fetchFn}).embed('Synthetic text')).rejects.toThrow();
 expect(fetchFn).toHaveBeenCalledOnce();
});
it('rejects empty or invalid task inputs before HTTP and does not echo them',async()=>{
 const fetchFn=vi.fn<typeof fetch>();const client=new OpenRouterEmbedding2Candidate({apiKey:'SYNTHETIC_OR_ONLY',fetchFn});
 await expect(client.embed('')).rejects.toThrow('input is empty');
 await expect(client.embed('PRIVATE_INPUT_CANARY','unknown' as never)).rejects.toThrow('task is invalid');expect(fetchFn).not.toHaveBeenCalled();
});
