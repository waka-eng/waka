/** Closed, content-free diagnostics for the held model2 response contract.
 * No model string, vector component, provider error or response object is kept. */
import {EMBEDDING_2_SPACE} from './embedding-2-space.js';
import {cosineSimilarity} from '../scoring/vector.js';

const object=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value);
type SafeType='missing'|'null'|'array'|'object'|'string'|'number'|'boolean'|'other';
function type(value:unknown,present=true):SafeType{
 if(!present)return 'missing';if(value===null)return 'null';if(Array.isArray(value))return 'array';
 return ['object','string','number','boolean'].includes(typeof value)?typeof value as SafeType:'other';
}
function count(value:unknown[]):number|'over_65536'{return value.length<=65536?value.length:'over_65536';}
type KnownModel='requested_stable'|'unprefixed_stable'|'preview'|'legacy_001'|'other'|'not_string';
function modelClass(value:unknown):KnownModel{
 if(typeof value!=='string')return 'not_string';
 if(value===EMBEDDING_2_SPACE.wireModel)return 'requested_stable';
 if(value==='gemini-embedding-2')return 'unprefixed_stable';
 if(['google/gemini-embedding-2-preview','gemini-embedding-2-preview'].includes(value))return 'preview';
 if(['google/gemini-embedding-001','gemini-embedding-001'].includes(value))return 'legacy_001';
 return 'other';
}
export type Embedding2ResponseFailure=
 'envelope_object'|'model_missing'|'model_type'|'model_mismatch'|'data_array'|'data_count'|
 'row_object'|'index_type'|'index_value'|'vector_array'|
 'vector_element_type'|'vector_dimensions'|'vector_nonfinite'|'vector_zero'|'vector_geometry';
export type Embedding2ResponseDiagnostics=Readonly<{
 envelopeType:SafeType;modelPresent:boolean;modelType:SafeType;modelClass:KnownModel;modelMatchesRequested:boolean;modelIdentityAccepted:boolean;
 dataType:SafeType;dataCount:number|'over_65536'|null;rowType:SafeType;
 indexPresent:boolean;indexType:SafeType;indexIsInteger:boolean|null;indexIsZero:boolean|null;indexAllowed:boolean|null;
 vectorType:SafeType;vectorLength:number|'over_65536'|null;dimensionsMatch:boolean|null;
 valuesAllNumbers:boolean|null;valuesAllFinite:boolean|null;hasNonzeroFiniteValue:boolean|null;selfCosineFinite:boolean|null;
}>;
export class Embedding2ResponseError extends Error{
 readonly code:Embedding2ResponseFailure;
 readonly diagnostics:Embedding2ResponseDiagnostics;
 constructor(code:Embedding2ResponseFailure,diagnostics:Embedding2ResponseDiagnostics){
  super(`Embedding2 response refused: ${code}`);this.name='Embedding2ResponseError';
  this.code=code;this.diagnostics=Object.freeze({...diagnostics});
 }
}

/** Inspection and acceptance share one ordered predicate set. Diagnostic
 * classes are observational. Only the two exact stable identifiers below
 * grant model identity; no prefix stripping, case folding or trimming.
 * This parser is only for one string input/one result. The documented optional
 * index may be absent; a supplied index must still be exactly integer zero. */
export function inspectEmbedding2Response(raw:unknown){
 const envelope=object(raw)?raw:null,hasModel=!!envelope&&Object.hasOwn(envelope,'model');
 const modelIdentityAccepted=envelope?.model===EMBEDDING_2_SPACE.wireModel||envelope?.model==='gemini-embedding-2';
 const data=Array.isArray(envelope?.data)?envelope.data:null,row=object(data?.[0])?data![0] as Record<string,unknown>:null;
 const hasIndex=!!row&&Object.hasOwn(row,'index'),vector=Array.isArray(row?.embedding)?row.embedding:null;
 const allNumbers=vector?vector.every(value=>typeof value==='number'):null;
 const allFinite=vector?vector.every(value=>typeof value==='number'&&Number.isFinite(value)):null;
 const nonzero=vector?vector.some(value=>typeof value==='number'&&Number.isFinite(value)&&value!==0):null;
 const cosine=allNumbers&&allFinite?cosineSimilarity(vector as number[],vector as number[]):null;
 const diagnostics:Embedding2ResponseDiagnostics=Object.freeze({
  envelopeType:type(raw),modelPresent:hasModel,modelType:type(envelope?.model,hasModel),modelClass:modelClass(envelope?.model),modelMatchesRequested:envelope?.model===EMBEDDING_2_SPACE.wireModel,modelIdentityAccepted,
  dataType:type(envelope?.data,!!envelope&&Object.hasOwn(envelope,'data')),dataCount:data?count(data):null,rowType:type(data?.[0],!!data&&data.length>0),
  indexPresent:hasIndex,indexType:type(row?.index,hasIndex),indexIsInteger:row&&hasIndex?typeof row.index==='number'&&Number.isInteger(row.index):null,indexIsZero:row&&hasIndex?row.index===0:null,indexAllowed:row?!hasIndex||row.index===0:null,
  vectorType:type(row?.embedding,!!row&&Object.hasOwn(row,'embedding')),vectorLength:vector?count(vector):null,dimensionsMatch:vector?vector.length===EMBEDDING_2_SPACE.dimensions:null,
  valuesAllNumbers:allNumbers,valuesAllFinite:allFinite,hasNonzeroFiniteValue:nonzero,selfCosineFinite:vector?cosine!==null&&Number.isFinite(cosine):null,
 });
 let failure:Embedding2ResponseFailure|null=null;
 if(!envelope)failure='envelope_object';
 else if(!modelIdentityAccepted)failure=!hasModel?'model_missing':typeof envelope.model!=='string'?'model_type':'model_mismatch';
 else if(!data)failure='data_array';else if(data.length!==1)failure='data_count';else if(!row)failure='row_object';
 else if(hasIndex&&row.index!==0)failure=typeof row.index!=='number'?'index_type':'index_value';
 else if(!vector)failure='vector_array';else if(!allNumbers)failure='vector_element_type';
 else if(vector.length!==EMBEDDING_2_SPACE.dimensions)failure='vector_dimensions';else if(!allFinite)failure='vector_nonfinite';
 else if(!nonzero)failure='vector_zero';else if(cosine===null||!Number.isFinite(cosine))failure='vector_geometry';
 return {failure,diagnostics};
}

export function parseEmbedding2Response(raw:unknown):number[]{
 const checked=inspectEmbedding2Response(raw);if(checked.failure)throw new Embedding2ResponseError(checked.failure,checked.diagnostics);
 // The ordered predicates prove this exact raw array; retain every value.
 return (raw as {data:Array<{embedding:number[]}>}).data[0]!.embedding;
}
