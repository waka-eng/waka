/** WHAT THIS MOCKS, AND WHY: nothing. Controlled loader promises exercise the
 * real bounded snapshot cache. Node Web Crypto supplies the same SHA algorithm
 * used in browsers; no HTTP, account content or provider requests are involved. */
import {webcrypto,createHash} from 'node:crypto';
import {beforeEach,expect,it,vi} from 'vitest';
import {inspirationSnapshotFingerprint,invalidateInspirationSnapshots,invalidateSourceRequest,readInspirationSnapshot,setInspirationSnapshotOwner} from '../src/lib/inspiration-snapshots';
const scope={accountId:'account',profileId:'profile'};
const value={inspirations:[{id:'one',preview:'Synthetic summary'}],total:1};
const metadata=vi.fn(async()=> 'current'),load=vi.fn(async()=>({data:structuredClone(value),fingerprint:'current'}));
const read=(signal?:AbortSignal,owner=scope)=>readInspirationSnapshot({scope:owner,profileId:owner.profileId,signal,validate:metadata,load});
beforeEach(()=>{setInspirationSnapshotOwner(null);vi.clearAllMocks();metadata.mockResolvedValue('current');load.mockResolvedValue({data:structuredClone(value),fingerprint:'current'});});
it('validates warm summaries instead of repeating their loader and does not share mutable returned objects',async()=>{
  const first=await read();first.inspirations[0]!.preview='Changed by consumer';const second=await read();
  expect(load).toHaveBeenCalledOnce();expect(metadata).toHaveBeenCalledOnce();expect(second).toEqual(value);
});
it('reloads changed or uncacheable manifests without presenting old summaries as current',async()=>{
  await read();metadata.mockResolvedValueOnce('changed');load.mockResolvedValue({data:{...value,total:2},fingerprint:'changed'});
  expect((await read()).total).toBe(2);expect(load).toHaveBeenCalledTimes(2);
  invalidateInspirationSnapshots();load.mockResolvedValue({data:structuredClone(value),fingerprint:null});await read();await read();expect(load).toHaveBeenCalledTimes(4);
});
it('refuses cached data after a denied or broken validation',async()=>{
  await read();metadata.mockRejectedValueOnce(new Error('Forbidden'));await expect(read()).rejects.toThrow('Forbidden');
  await read();expect(load).toHaveBeenCalledTimes(2);
});
it('clears both account and profile boundaries, including logout',async()=>{
  await read();await read(undefined,{accountId:'other',profileId:'profile'});await read(undefined,{accountId:'other',profileId:'agent'});setInspirationSnapshotOwner(null);await read();
  expect(load).toHaveBeenCalledTimes(4);expect(metadata).not.toHaveBeenCalled();
});
it('shares reads without letting one canceled consumer cancel another',async()=>{
  let finish!:(result:{data:typeof value;fingerprint:string})=>void;load.mockImplementationOnce(()=>new Promise(done=>finish=done));
  const one=new AbortController(),two=new AbortController(),first=read(one.signal),second=read(two.signal);
  one.abort();await expect(first).rejects.toMatchObject({name:'AbortError'});expect(load.mock.calls[0]![0].aborted).toBe(false);
  finish({data:value,fingerprint:'current'});expect(await second).toEqual(value);expect(load).toHaveBeenCalledOnce();
});
it('aborts the last consumer and never caches its late response',async()=>{
  let finish!:(result:{data:typeof value;fingerprint:string})=>void;load.mockImplementationOnce(()=>new Promise(done=>finish=done));
  const controller=new AbortController(),pending=read(controller.signal);controller.abort();await expect(pending).rejects.toMatchObject({name:'AbortError'});
  finish({data:value,fingerprint:'old'});await Promise.resolve();await read();expect(load).toHaveBeenCalledTimes(2);expect(metadata).not.toHaveBeenCalled();
});
it('does not let an old identity repopulate the cache after switching',async()=>{
  let finish!:(result:{data:typeof value;fingerprint:string})=>void;load.mockImplementationOnce(()=>new Promise(done=>finish=done));
  const pending=read();setInspirationSnapshotOwner({accountId:'other',profileId:'other'});finish({data:value,fingerprint:'old'});
  await expect(pending).rejects.toMatchObject({name:'AbortError'});await read();expect(load).toHaveBeenCalledTimes(2);
});
it('invalidates attempted source writes but not review progress or unrelated requests',async()=>{
  await read();invalidateSourceRequest('/api/review-sessions/session/choices');await read();expect(load).toHaveBeenCalledOnce();
  invalidateSourceRequest('https://example.test/api/inspirations/one/reflections');await read();expect(load).toHaveBeenCalledTimes(2);
  invalidateSourceRequest('/api/attachments/file/transcript');await read();expect(load).toHaveBeenCalledTimes(3);
});
it('retries fresh data when a mutation invalidates an in-flight read',async()=>{
  let finish!:(result:{data:typeof value;fingerprint:string})=>void;load.mockImplementationOnce(()=>new Promise(done=>finish=done));
  const pending=read();invalidateInspirationSnapshots();finish({data:{...value,total:99},fingerprint:'old'});expect(await pending).toEqual(value);expect(load).toHaveBeenCalledTimes(2);
});
it('binds wire identity order, exact total, profile and material revisions in the digest',async()=>{
  Object.defineProperty(globalThis,'crypto',{configurable:true,value:webcrypto});
  const rows=[{id:'one',materialRevision:'2'},{id:'two',materialRevision:'1'}];
  const expected=createHash('sha256').update(JSON.stringify({policy:'inspiration-snapshot-v1',profileId:'profile',total:2,items:[['one','2'],['two','1']]})).digest('hex');
  expect(await inspirationSnapshotFingerprint('profile',2,rows)).toBe(expected);
  expect(await inspirationSnapshotFingerprint('other',2,rows)).not.toBe(expected);expect(await inspirationSnapshotFingerprint('profile',2,[...rows].reverse())).not.toBe(expected);
  expect(await inspirationSnapshotFingerprint('profile',3,rows)).toBeNull();expect(await inspirationSnapshotFingerprint('profile',2,[rows[0]!,rows[0]!])).toBeNull();expect(await inspirationSnapshotFingerprint('profile',1,[{id:'one'}])).toBeNull();
});
