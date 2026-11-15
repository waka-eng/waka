/** WHAT THIS MOCKS, AND WHY (gate G6): `fetchFn` returns fixed synthetic
 * response envelopes at the actual adapter HTTP seam. Parser and diagnostics
 * execute unchanged; no key, provider, memory, database or vector is real. */
import {expect,it,vi} from 'vitest';
import {OpenRouterEmbedding2Candidate} from './openrouter-media.js';
import {Embedding2ResponseError,inspectEmbedding2Response,parseEmbedding2Response} from './embedding-2-response.js';
import {EMBEDDING_2_SPACE} from './embedding-2-space.js';
const model=EMBEDDING_2_SPACE.wireModel,values=[2,1,...Array<number>(766).fill(0)];
const row=(patch:Record<string,unknown>={})=>({index:0,embedding:values,...patch});
const body=(patch:Record<string,unknown>={})=>({model,data:[row()],...patch});
const cases=[
 ['null envelope',null,'envelope_object',{envelopeType:'null'}],
 ['array envelope',[],'envelope_object',{envelopeType:'array'}],
 ['missing model',{data:[row()]},'model_missing',{modelPresent:false,modelType:'missing'}],
 ['null model',body({model:null}),'model_type',{modelPresent:true,modelType:'null'}],
 ['number model',body({model:123}),'model_type',{modelType:'number'}],
 ['unknown model',body({model:'PRIVATE_RETURNED_MODEL_CANARY'}),'model_mismatch',{modelType:'string',modelClass:'other',modelMatchesRequested:false}],
 ['known preview',body({model:'google/gemini-embedding-2-preview'}),'model_mismatch',{modelClass:'preview'}],
 ['known legacy',body({model:'google/gemini-embedding-001'}),'model_mismatch',{modelClass:'legacy_001'}],
 ['bare preview',body({model:'gemini-embedding-2-preview'}),'model_mismatch',{modelClass:'preview',modelIdentityAccepted:false}],
 ['bare legacy',body({model:'gemini-embedding-001'}),'model_mismatch',{modelClass:'legacy_001',modelIdentityAccepted:false}],
 ['models resource path',body({model:'models/gemini-embedding-2'}),'model_mismatch',{modelClass:'other',modelIdentityAccepted:false}],
 ['full resource path',body({model:'projects/synthetic/locations/synthetic/publishers/google/models/gemini-embedding-2'}),'model_mismatch',{modelClass:'other',modelIdentityAccepted:false}],
 ['arbitrary prefix',body({model:'other/gemini-embedding-2'}),'model_mismatch',{modelClass:'other',modelIdentityAccepted:false}],
 ['bare wrong case',body({model:'Gemini-embedding-2'}),'model_mismatch',{modelClass:'other',modelIdentityAccepted:false}],
 ['wire wrong case',body({model:'Google/gemini-embedding-2'}),'model_mismatch',{modelClass:'other',modelIdentityAccepted:false}],
 ['bare trailing space',body({model:'gemini-embedding-2 '}),'model_mismatch',{modelClass:'other',modelIdentityAccepted:false}],
 ['wire leading space',body({model:' google/gemini-embedding-2'}),'model_mismatch',{modelClass:'other',modelIdentityAccepted:false}],
 ['bare trailing newline',body({model:'gemini-embedding-2\n'}),'model_mismatch',{modelClass:'other',modelIdentityAccepted:false}],
 ['missing data',{model},'data_array',{dataType:'missing',dataCount:null}],
 ['object data',body({data:{}}),'data_array',{dataType:'object',dataCount:null}],
 ['zero rows',body({data:[]}),'data_count',{dataCount:0}],
 ['multiple rows',body({data:[row(),row()]}),'data_count',{dataCount:2}],
 ['null row',body({data:[null]}),'row_object',{rowType:'null'}],
 ['string row',body({data:['PRIVATE_ROW_CANARY']}),'row_object',{rowType:'string'}],
 ['null index',body({data:[row({index:null})]}),'index_type',{indexPresent:true,indexType:'null'}],
 ['string index',body({data:[row({index:'PRIVATE_INDEX_CANARY'})]}),'index_type',{indexType:'string',indexIsZero:false}],
 ['nonzero index',body({data:[row({index:1})]}),'index_value',{indexIsInteger:true,indexIsZero:false}],
 ['fractional index',body({data:[row({index:.5})]}),'index_value',{indexIsInteger:false,indexIsZero:false}],
 ['negative index',body({data:[row({index:-1})]}),'index_value',{indexIsInteger:true,indexIsZero:false}],
 ['boolean index',body({data:[row({index:false})]}),'index_type',{indexType:'boolean',indexIsZero:false}],
 ['object index',body({data:[row({index:{private:'PRIVATE_INDEX_CANARY'}})]}),'index_type',{indexType:'object',indexIsZero:false}],
 ['missing vector',body({data:[{index:0}]}),'vector_array',{vectorType:'missing'}],
 ['base64 vector',body({data:[row({embedding:'PRIVATE_BASE64_CANARY'})]}),'vector_array',{vectorType:'string'}],
 ['short vector',body({data:[row({embedding:[1,2]})]}),'vector_dimensions',{vectorLength:2,dimensionsMatch:false}],
 ['long vector',body({data:[row({embedding:Array(769).fill(1)})]}),'vector_dimensions',{vectorLength:769,dimensionsMatch:false}],
 ['null component',body({data:[row({embedding:[null,...Array(767).fill(1)]})]}),'vector_element_type',{valuesAllNumbers:false,valuesAllFinite:false}],
 ['string component',body({data:[row({embedding:['PRIVATE_VECTOR_CANARY',...Array(767).fill(1)]})]}),'vector_element_type',{valuesAllNumbers:false}],
 ['zero vector',body({data:[row({embedding:Array(768).fill(0)})]}),'vector_zero',{hasNonzeroFiniteValue:false,selfCosineFinite:false}],
 ['overflow geometry',body({data:[row({embedding:Array(768).fill(1e308)})]}),'vector_geometry',{valuesAllFinite:true,selfCosineFinite:false}],
 ['underflow geometry',body({data:[row({embedding:Array(768).fill(1e-300)})]}),'vector_geometry',{hasNonzeroFiniteValue:true,selfCosineFinite:false}],
] as const;
it.each(cases)('classifies %s through the actual adapter without accepting it or leaking values',async(_name,payload,code,fields)=>{
 const fetchFn=vi.fn<typeof fetch>().mockResolvedValue(Response.json(payload));let error:unknown;
 try{await new OpenRouterEmbedding2Candidate({apiKey:'SYNTHETIC_DIAGNOSTIC_KEY',fetchFn}).embed('Synthetic diagnostic text');}catch(e){error=e;}
 expect(error).toBeInstanceOf(Embedding2ResponseError);const typed=error as Embedding2ResponseError;
 expect(typed.code).toBe(code);expect(typed.diagnostics).toMatchObject(fields);expect(typed.message).toBe('Embedding2 response refused: '+code);
 const serialized=JSON.stringify(error)+String(error);expect(serialized).not.toContain('PRIVATE_');expect(serialized).not.toContain('SYNTHETIC_DIAGNOSTIC_KEY');
 expect(Object.isFrozen(typed.diagnostics)).toBe(true);expect(fetchFn).toHaveBeenCalledOnce();
});
it('identifies nonfinite JSON numeric overflow separately from dimensions and zero',async()=>{
 const text=JSON.stringify(body()).replace('"embedding":[2,1,','"embedding":[1e999,1,');
 const fetchFn=vi.fn<typeof fetch>().mockResolvedValue(new Response(text,{headers:{'Content-Type':'application/json'}}));
 await expect(new OpenRouterEmbedding2Candidate({apiKey:'SYNTHETIC_DIAGNOSTIC_KEY',fetchFn}).embed('Synthetic')).rejects.toMatchObject({code:'vector_nonfinite',diagnostics:{vectorLength:768,dimensionsMatch:true,valuesAllNumbers:true,valuesAllFinite:false}});
 expect(fetchFn).toHaveBeenCalledOnce();
});
it.each(['google/gemini-embedding-2','gemini-embedding-2'])('accepts only approved stable identity %s and preserves exact raw vector',async returnedModel=>{
 const raw=body({model:returnedModel});const checked=inspectEmbedding2Response(raw);expect(checked.failure).toBeNull();
 expect(checked.diagnostics).toMatchObject({modelPresent:true,modelClass:returnedModel===model?'requested_stable':'unprefixed_stable',modelMatchesRequested:returnedModel===model,modelIdentityAccepted:true,dataCount:1,indexPresent:true,indexIsZero:true,vectorLength:768,valuesAllFinite:true,hasNonzeroFiniteValue:true,selfCosineFinite:true});
 expect(parseEmbedding2Response(raw)).toBe(values);expect(values[0]).toBe(2);
 const fetchFn=vi.fn<typeof fetch>().mockResolvedValue(Response.json(raw));expect(await new OpenRouterEmbedding2Candidate({apiKey:'SYNTHETIC_DIAGNOSTIC_KEY',fetchFn}).embed('Synthetic')).toEqual(values);expect(fetchFn).toHaveBeenCalledOnce();
 expect(JSON.parse(String(fetchFn.mock.calls[0]![1]!.body)).model).toBe('google/gemini-embedding-2');
});
it('exposes only safe structural fields when multiple predicates fail and caps large counts',()=>{
 const summary=inspectEmbedding2Response({model:'PRIVATE_UNKNOWN_MODEL',data:Array(65537).fill({index:'PRIVATE_INDEX',embedding:['PRIVATE_VECTOR']})});
 expect(summary.failure).toBe('model_mismatch');expect(summary.diagnostics.dataCount).toBe('over_65536');
 expect(JSON.stringify(summary)).not.toContain('PRIVATE_');expect(Object.keys(summary.diagnostics)).not.toContain('raw');
});

it('accepts an absent optional index only in the one-result single-string adapter',async()=>{
 const payload=body({data:[{embedding:values}]});const fetchFn=vi.fn<typeof fetch>().mockResolvedValue(Response.json(payload));
 expect(await new OpenRouterEmbedding2Candidate({apiKey:'SYNTHETIC_DIAGNOSTIC_KEY',fetchFn}).embed('Synthetic single input')).toEqual(values);
 expect(inspectEmbedding2Response(payload)).toMatchObject({failure:null,diagnostics:{dataCount:1,indexPresent:false,indexType:'missing',indexIsInteger:null,indexIsZero:null,indexAllowed:true}});expect(fetchFn).toHaveBeenCalledOnce();
 expect(inspectEmbedding2Response(body({data:[{embedding:values},{embedding:values}]})).failure).toBe('data_count');
 expect(inspectEmbedding2Response(body({data:[{index:undefined,embedding:values}]})).failure).toBe('index_type');
});
