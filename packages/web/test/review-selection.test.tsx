// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY (gate G6): nothing by default. One test replaces
 * `Storage.setItem` to exercise quota failure. The real selection hook, scoped
 * storage, multi-writer forks and exact settlement run without a network. */
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {useReviewSelection} from '../src/lib/use-review-selection';
import {readReviewSelections,settleReviewSelection} from '../src/lib/review-selection-drafts';
import {profileStorageKey} from '../src/lib/profile-storage';
const scope={accountId:'account',profileId:'profile'},first='11111111-1111-4111-8111-111111111111',second='22222222-2222-4222-8222-222222222222';
let host:HTMLDivElement,root:Root,hook:ReturnType<typeof useReviewSelection>;
function Harness({owner=scope}:{owner?:typeof scope}){hook=useReviewSelection(owner);return null;}
beforeEach(()=>{localStorage.clear();(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();});
const mount=(owner=scope)=>act(async()=>root.render(<Harness owner={owner}/>));
it('restores manual order and the unfinished query without storing source text',async()=>{
  await mount();await act(async()=>hook.add(second));await act(async()=>hook.add(first));await act(async()=>hook.setQuery('garden'));
  await act(async()=>root.unmount());root=createRoot(host);await mount();expect(hook.ids).toEqual([second,first]);expect(hook.query).toBe('garden');
  expect(Object.keys(readReviewSelections(scope)[0]!.value).sort()).toEqual(['id','ids','query','updatedAt','writer']);
});
it('isolates accounts and profiles',async()=>{
  await mount();await act(async()=>hook.add(first));await mount({accountId:'account',profileId:'agent'});expect(hook.ids).toEqual([]);
  await mount({accountId:'other',profileId:'profile'});expect(hook.ids).toEqual([]);await mount();expect(hook.ids).toEqual([first]);
});
it('keeps two mounted writers separate after they restore the same selection',async()=>{
  await mount();await act(async()=>hook.add(first));const firstWriter=hook;
  const otherHost=document.createElement('div'),otherRoot=createRoot(otherHost);await act(async()=>otherRoot.render(<Harness/>));const otherWriter=hook;
  await act(async()=>otherWriter.add(second));await act(async()=>firstWriter.remove(first));
  expect(readReviewSelections(scope).map(row=>row.value.ids).sort((a,b)=>a.length-b.length)).toEqual([[],[first,second]]);
  await act(async()=>otherRoot.unmount());
});
it('settles only an exact consumed snapshot, not another tab or newer edits',async()=>{
  await mount();await act(async()=>hook.add(first));const receipt=hook.receipt!;
  await act(async()=>hook.add(second));settleReviewSelection(scope,receipt);expect(readReviewSelections(scope)[0]?.value.ids).toEqual([first,second]);
  settleReviewSelection({accountId:'other',profileId:'profile'},hook.receipt!);expect(readReviewSelections(scope)).toHaveLength(1);
  settleReviewSelection(scope,hook.receipt!);expect(readReviewSelections(scope)).toHaveLength(0);
});
it('preserves visible selection on quota failure and saves it after explicit recovery',async()=>{
  await mount();const spy=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('quota');});
  await act(async()=>hook.add(first));expect(hook.error).toBe(true);expect(hook.ids).toEqual([first]);spy.mockRestore();
  await act(async()=>hook.recover());expect(hook.error).toBe(false);expect(readReviewSelections(scope)[0]?.value.ids).toEqual([first]);
});
it('retains corrupt bytes in owned recovery storage rather than silently overwriting them',async()=>{
  const key=profileStorageKey(scope,'reviewSelection:corrupt')!;localStorage.setItem(key,'original bad bytes');await mount();expect(hook.error).toBe(true);
  await act(async()=>hook.recover());expect(localStorage.getItem(key)).toBeNull();expect(Object.keys(localStorage).filter(key=>key.includes('reviewSelectionRecovery:')).map(key=>localStorage.getItem(key))).toEqual(['original bad bytes']);
});
it('deduplicates selections and caps them at five',async()=>{
  await mount();for(let i=1;i<=6;i++)await act(async()=>hook.add(`${i}`.repeat(8)+'-1111-4111-8111-111111111111'));
  expect(hook.ids).toHaveLength(5);await act(async()=>hook.add(hook.ids[0]!));expect(hook.ids).toHaveLength(5);
});
