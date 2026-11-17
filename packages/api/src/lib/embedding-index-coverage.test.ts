/** WHAT THIS MOCKS, AND WHY (gate G6): `Db.transaction`/`execute` return
 * bounded synthetic rows to prove early guards and RO/RR contract. Geometry
 * and closed schema are actual code; no provider/network/DB is invoked. */
import {describe,expect,it,vi} from 'vitest';
import {readEmbeddingCoverage,embeddingCoverageManifest,finiteCoverageGeometry,coverageFieldBytes,type EmbeddingCoverageManifest} from './embedding-index-coverage.js';
const id='10000000-0000-4000-8000-000000000001',account='20000000-0000-4000-8000-000000000001';
const input=():EmbeddingCoverageManifest=>({version:'embedding-coverage-v1',accountId:account,profiles:[{id,epoch:'0',activeSpace:'gemini-embedding-001',activePolicy:'gemini-embedding-001.thresholds.v1',buildingSpace:null,buildingPolicy:null}],targetSpace:'waka.embedding.gemini-2.text-retrieval.v1.768.raw',approvedDbSha256:'a'.repeat(64),expiresAt:new Date(Date.now()+3600000).toISOString(),maxCells:10,maxBytes:8388608,maxStatements:100,maxDurationMs:60000,maxLedgerAttempts:100});
function fake(rows:unknown[][]){const execute=vi.fn(async()=>rows.shift()??[]);const transaction=vi.fn(async(fn:(tx:unknown)=>unknown,config:unknown)=>{expect(config).toEqual({isolationLevel:'repeatable read',accessMode:'read only'});return fn({execute});});return {execute,transaction,db:{transaction} as unknown as Parameters<typeof readEmbeddingCoverage>[0]};}
const owner=()=>({id,epoch:'0',active_space:'gemini-embedding-001',active_policy:'gemini-embedding-001.thresholds.v1',policy_oversized:false,building_space:null,building_policy:null,generation:'1',snapshot_at:'2026-11-15 12:00:00+00'});
const clear=()=>({reserved:0,received:0,unknown:0,total:0});
describe('finite unnormalized768 geometry',()=>{
 it('accepts ordinary values without changing any coordinate',()=>{const v=[1,...Array<number>(767).fill(.25)],before=[...v];expect(finiteCoverageGeometry(v,768)).toBe(true);expect(v).toEqual(before);});
 it.each([Array(768).fill(0),[1,...Array(766).fill(0)],[1,...Array(768).fill(0)],['1',...Array(767).fill(0)],[Infinity,...Array(767).fill(0)],[NaN,...Array(767).fill(0)],[1e308,...Array(767).fill(0)],[1e-300,...Array(767).fill(0)],{values:[1]}].map(values=>({values})))('refuses zero/malformed/nonfinite/norm-overflow or underflow',({values})=>{expect(finiteCoverageGeometry(values,768)).toBe(false);});
 it('refuses dimensions independently of an otherwise good vector',()=>expect(finiteCoverageGeometry([1,...Array(767).fill(0)],767)).toBe(false));
});
it('has a closed bounded schema and no repair/provider/activation surface',()=>{
 expect(embeddingCoverageManifest.safeParse(input()).success).toBe(true);
 for(const extra of [{mode:'C1'},{apiKey:'NEVER_USE'},{maxCells:1001},{maxBytes:8388609},{maxDurationMs:60001},{profiles:[input().profiles[0],input().profiles[0]]}])expect(embeddingCoverageManifest.safeParse({...input(),...extra}).success).toBe(false);
});
it('states empty coverage for its explicit RO/RR snapshot and keeps frontier UUIDs private',async()=>{
 const f=fake([[owner()],[clear()],[]]);const r=await readEmbeddingCoverage(f.db,input());
 expect(r.report).toMatchObject({complete:true,counts:{domainCells:0},activationAuthorized:false,providerOutcomeProven:false,invoiceProven:false,memoryMutations:0,providerCalls:0});
 expect(r.privateMetadata.frontiers).toEqual([{profileId:id,epoch:'0',generationRevision:'1',maxRequestedVersion:'0'}]);
 expect(JSON.stringify(r.report)).not.toContain(id);expect(JSON.stringify(r.report)).not.toContain(account);expect(f.execute).toHaveBeenCalledTimes(3);
});
it('rejects a missing owned profile without returning foreign data',async()=>{const f=fake([[]]);await expect(readEmbeddingCoverage(f.db,input())).rejects.toMatchObject({code:'scope'});expect(f.execute).toHaveBeenCalledOnce();});
it('rejects exact policy/epoch drift before any domain read',async()=>{const f=fake([[{...owner(),epoch:'1'}]]);await expect(readEmbeddingCoverage(f.db,input())).rejects.toMatchObject({code:'policy'});expect(f.execute).toHaveBeenCalledOnce();});
it('refuses a foreign manifest before its aggregate and without foreign counts',async()=>{const f=fake([[owner()],[clear()],[{invalid:true}]]);await expect(readEmbeddingCoverage(f.db,{...input(),reconcileManifestHash:'b'.repeat(64)})).rejects.toMatchObject({code:'foreign_manifest'});expect(f.execute).toHaveBeenCalledTimes(3);});
it('limits the full union domain before reading any source',async()=>{const f=fake([[owner()],[clear()],[{},{}]]);await expect(readEmbeddingCoverage(f.db,{...input(),maxCells:1})).rejects.toMatchObject({code:'domain_limit'});expect(f.execute).toHaveBeenCalledTimes(3);});
it('reports global unresolved holds without an optional manifest, separate from source coverage',async()=>{const f=fake([[owner()],[{reserved:0,received:1,unknown:2,total:3}],[]]);const r=await readEmbeddingCoverage(f.db,input());expect(r.report).toMatchObject({complete:true,reconciliation:null,unresolvedAttempts:{total:3,received:1,unknown:2,resolutionRequired:true},providerOutcomeProven:false,activationAuthorized:false});});
it('reserves control/catalog statement budget before the first SQL',async()=>{const f=fake([]);await expect(readEmbeddingCoverage(f.db,{...input(),maxStatements:4})).rejects.toMatchObject({code:'statement_limit'});expect(f.execute).not.toHaveBeenCalled();});
it('checks deadlines before SQL and does not certify an expired read',async()=>{const f=fake([]);let clock=0;await expect(readEmbeddingCoverage(f.db,{...input(),maxDurationMs:1},{now:()=>clock++})).rejects.toMatchObject({code:'deadline'});expect(f.execute).not.toHaveBeenCalled();});
it('charges server-sized JSON vector text rather than compact JS exponent encoding',()=>{const r={values:Array(768).fill(1e21),vector_bytes:20000};expect(coverageFieldBytes(r)).toBeGreaterThan(20000);});
it('closes SQL errors including nested raw query/identifier data at the verifier boundary',async()=>{
 const execute=vi.fn(async()=>{throw {message:'PRIVATE_WORDS_AND_SQL_PARAMS',cause:{code:'42P01',detail:id}};});
 const db={transaction:async(fn:(tx:unknown)=>unknown)=>fn({execute})} as unknown as Parameters<typeof readEmbeddingCoverage>[0];
 try{await readEmbeddingCoverage(db,input());throw Error('expected refusal');}catch(error){expect(error).toMatchObject({code:'schema_mismatch'});expect(String(error)).not.toContain('PRIVATE');expect(JSON.stringify(error)).not.toContain(id);}
});
