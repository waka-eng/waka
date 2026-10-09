// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY (gate G6): `lib/api` scripts the active-review GET so
 * label selection and late cross-account responses can be tested without SQL. */
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {fetchActiveReview,type ApiReviewSession} from '../src/lib/api';
import {useReviewEntry} from '../src/lib/use-review-entry';
vi.mock('../src/lib/api',async original=>({...await original<typeof import('../src/lib/api')>(),fetchActiveReview:vi.fn()}));
let host:HTMLDivElement,root:Root;
const scope={accountId:'owner',profileId:'profile'};
const session={id:'review',profileId:'profile',completedAt:null,items:[{choice:'keep'},{choice:'skip'},{choice:'keep'}]} as ApiReviewSession;
function Probe({owner=scope,route=null}:{owner?:typeof scope;route?:string|null}){const entry=useReviewEntry(owner,route,'en-US');return <button data-resuming={entry.resuming}>{entry.label}</button>;}
beforeEach(()=>{vi.resetAllMocks();(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;host=document.createElement('div');root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());vi.useRealTimers();});
it('keeps a familiar invitation while preserving resume state and refreshes when returning from a review',async()=>{
  vi.mocked(fetchActiveReview).mockResolvedValue(session);await act(async()=>root.render(<Probe/>));
  expect(host.textContent).toBe('Revisit your inspirations');expect(host.querySelector('button')?.dataset.resuming).toBe('true');
  vi.mocked(fetchActiveReview).mockResolvedValue(null);await act(async()=>root.render(<Probe route="review"/>));
  expect(host.textContent).toBe('Revisit your inspirations');expect(fetchActiveReview).toHaveBeenCalledTimes(1);
  await act(async()=>root.render(<Probe route={null}/>));
  expect(host.textContent).toBe('Revisit your inspirations');expect(fetchActiveReview).toHaveBeenCalledTimes(2);expect(host.querySelector('button')?.dataset.resuming).toBe('false');
});
it('does not show another profile or a completed session as resumable',async()=>{
  vi.mocked(fetchActiveReview).mockResolvedValue({...session,profileId:'other'});await act(async()=>root.render(<Probe/>));
  expect(host.textContent).toBe('Revisit your inspirations');
  vi.mocked(fetchActiveReview).mockResolvedValue({...session,completedAt:'2026-10-04T01:00:00Z'});await act(async()=>root.render(<Probe route="done"/>));
  expect(host.textContent).toBe('Revisit your inspirations');
});
it('ignores a late old-account response and keeps an ordinary entry on read failure',async()=>{
  let resolve!:(row:ApiReviewSession)=>void;
  vi.mocked(fetchActiveReview).mockImplementationOnce(()=>new Promise(done=>{resolve=done;})).mockRejectedValueOnce(new Error('offline'));
  await act(async()=>root.render(<Probe/>));
  await act(async()=>root.render(<Probe owner={{accountId:'another',profileId:'another-profile'}}/>));
  await act(async()=>resolve(session));expect(host.textContent).toBe('Revisit your inspirations');
});
