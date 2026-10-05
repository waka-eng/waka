// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY: nothing except `Storage.setItem` in the quota
 * case. These legacy manifest journals still reconcile in useReviewSession;
 * the removed multi-selection UI/hook is deliberately not exercised. */
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {readReviewSelections,recoverReviewSelections,settleReviewSelection,storeReviewSelection,type ReviewSelectionDraft} from '../src/lib/review-selection-drafts';
import {profileStorageKey} from '../src/lib/profile-storage';
const scope={accountId:'account',profileId:'profile'},first='11111111-1111-4111-8111-111111111111',second='22222222-2222-4222-8222-222222222222';
const draft=():ReviewSelectionDraft=>({id:crypto.randomUUID(),writer:crypto.randomUUID(),ids:[second,first],query:'garden',updatedAt:Date.now()});
beforeEach(()=>localStorage.clear());afterEach(()=>vi.restoreAllMocks());
it('retains the legacy manifest order without copying original source text',()=>{
  const value=draft();storeReviewSelection(scope,value);expect(readReviewSelections(scope)[0]?.value).toEqual(value);
  expect(Object.keys(readReviewSelections(scope)[0]!.value).sort()).toEqual(['id','ids','query','updatedAt','writer']);
});
it('isolates legacy manifests by both account and profile',()=>{
  storeReviewSelection(scope,draft());expect(readReviewSelections({accountId:'account',profileId:'agent'})).toEqual([]);
  expect(readReviewSelections({accountId:'other',profileId:'profile'})).toEqual([]);expect(readReviewSelections(scope)).toHaveLength(1);
});
it('refuses stale same-manifest writers instead of overwriting another tab',()=>{
  const original=storeReviewSelection(scope,draft()),changed=storeReviewSelection(scope,{...original.value,ids:[first]},original);
  expect(()=>storeReviewSelection(scope,{...original.value,ids:[]},original)).toThrow();expect(readReviewSelections(scope)[0]?.value).toEqual(changed.value);
});
it('settles only an exact consumed snapshot under its owner',()=>{
  const receipt=storeReviewSelection(scope,draft()),changed=storeReviewSelection(scope,{...receipt.value,query:'newer'},receipt);
  settleReviewSelection(scope,receipt);expect(readReviewSelections(scope)).toHaveLength(1);
  settleReviewSelection({accountId:'other',profileId:'profile'},changed);expect(readReviewSelections(scope)).toHaveLength(1);
  settleReviewSelection(scope,changed);expect(readReviewSelections(scope)).toHaveLength(0);
});
it('reports quota failure without pretending a journal was stored',()=>{
  const spy=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('quota');});expect(()=>storeReviewSelection(scope,draft())).toThrow();spy.mockRestore();expect(readReviewSelections(scope)).toEqual([]);
});
it('retains corrupt bytes in owned recovery storage',()=>{
  const key=profileStorageKey(scope,'reviewSelection:corrupt')!;localStorage.setItem(key,'original bad bytes');expect(()=>readReviewSelections(scope)).toThrow();recoverReviewSelections(scope);
  expect(localStorage.getItem(key)).toBeNull();expect(Object.keys(localStorage).filter(key=>key.includes('reviewSelectionRecovery:')).map(key=>localStorage.getItem(key))).toEqual(['original bad bytes']);
});
it('rejects duplicate or oversized legacy manifests',()=>{
  expect(()=>storeReviewSelection(scope,{...draft(),ids:[first,first]})).toThrow();expect(()=>storeReviewSelection(scope,{...draft(),ids:Array.from({length:6},()=>crypto.randomUUID())})).toThrow();
});
