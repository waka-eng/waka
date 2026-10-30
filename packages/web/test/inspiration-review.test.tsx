// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY (gate G6): `lib/data` supplies the memory layers;
 * `lib/api` supplies review queues; `lib/api/inspiration-relevance` supplies
 * decisions/reloads; `lib/auth-context` supplies the viewer. They are server
 * boundaries whose reads and writes these controls must prove.
 * `helpers/render-home` and `helpers/canvas-stub` replace drawing and timing,
 * never Home's behavior. */
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { apiMockFrom, dataMockFrom, mountWorld, diveIntoReview, VIEWER_ID, type MountedWorld } from './helpers/render-home';
import { installCanvasStub, setViewport } from './helpers/canvas-stub';
import { listClaims, listHarvest, listInspirationReviews } from '../src/lib/api';
import { readInspirationRelevance, reviewInspiration, type InspirationRelevance } from '../src/lib/api/inspiration-relevance';
import { ApiError } from '../src/lib/api/http';

vi.mock('../src/lib/api',async original=>({...await original<typeof import('../src/lib/api')>(),...apiMockFrom({inspirations:[]}),
  listClaims:vi.fn(),listHarvest:vi.fn(),listInspirationReviews:vi.fn()}));
vi.mock('../src/lib/api/inspiration-relevance',async original=>({...await original<typeof import('../src/lib/api/inspiration-relevance')>(),reviewInspiration:vi.fn(),readInspirationRelevance:vi.fn()}));
vi.mock('../src/lib/data',async original=>({...await original<typeof import('../src/lib/data')>(),...dataMockFrom({inspirations:[]})}));
vi.mock('../src/lib/auth-context',async original=>({...await original<typeof import('../src/lib/auth-context')>(),useOptionalAuth:()=>({status:'authenticated',account:{id:'account',email:'owner@example.test'},profile:{id:VIEWER_ID,name:'Owner',type:'human'},profiles:[]})}));
const original:InspirationRelevance={id:'original-1',text:'Build a business I can run alone.',kind:'note',createdAt:'2026-08-01T12:00:00Z',sourceRevision:'3',reviewVersion:0,memoryExcludedAt:null,reviewAfter:null,attachmentLabel:null};
let world:MountedWorld;
beforeAll(()=>{installCanvasStub();setViewport(390,844);(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;});
beforeEach(()=>{
  vi.mocked(listHarvest).mockResolvedValue([]);vi.mocked(listClaims).mockResolvedValue({claims:[],more:false});
  vi.mocked(listInspirationReviews).mockResolvedValue([original]);vi.mocked(reviewInspiration).mockResolvedValue();
});
afterEach(()=>{world?.unmount();vi.clearAllMocks();});
const button=(text:string)=>[...world.container.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.trim()===text)!;
const settle=async()=>{await act(async()=>{await new Promise(r=>setTimeout(r,330));});await world.step(5);};
async function open(){world=await mountWorld();await diveIntoReview(world.container,world.step);}
it('offers old originals through Actions even without signals or collector suggestions',async()=>{
  world=await mountWorld();await act(async()=>button('Actions').click());
  await act(async()=>button('Review suggestions').click());
  expect(world.container.textContent).toContain('Is this still relevant to you?');expect(world.container.textContent).toContain(original.text);
  expect(world.container.textContent).toContain('Your saved inspiration');
  await act(async()=>button('Still relevant').click());await settle();
  expect(reviewInspiration).toHaveBeenCalledWith(original,VIEWER_ID,'relevant',expect.any(String));
  expect(world.container.querySelector('.jar-pick-slip')).toBeNull();
});
it('keeps the same original on a failed write and retries with the same request identity',async()=>{
  vi.mocked(reviewInspiration).mockRejectedValueOnce(new Error('offline'));
  await open();await act(async()=>button('No longer relevant').click());await settle();
  expect(world.container.textContent).toContain(original.text);
  const first=vi.mocked(reviewInspiration).mock.calls[0];
  await act(async()=>button('No longer relevant').click());await settle();
  expect(vi.mocked(reviewInspiration).mock.calls[1]).toEqual(first);
  expect(first[2]).toBe('not_relevant');expect(world.container.querySelector('.jar-pick-slip')).toBeNull();
});
it('Later records a deferral without submitting a relevance verdict',async()=>{
  await open();await act(async()=>button('Later').click());
  expect(reviewInspiration).toHaveBeenCalledWith(original,VIEWER_ID,'later',expect.any(String));
  expect(world.container.querySelector('.jar-pick-slip')).toBeNull();
});
it('requires reading changed wording before an explicit new choice',async()=>{
  vi.mocked(reviewInspiration).mockRejectedValueOnce(new ApiError({status:409,message:'changed'}));
  const fresh={...original,text:'Work with a small team.',sourceRevision:'4'};vi.mocked(readInspirationRelevance).mockResolvedValue(fresh);
  await open();await act(async()=>button('Still relevant').click());await settle();
  expect(world.container.textContent).toContain('This inspiration changed.');
  await act(async()=>button('Read updated inspiration').click());expect(world.container.textContent).toContain(fresh.text);
  expect(reviewInspiration).toHaveBeenCalledOnce();
  await act(async()=>button('Still relevant').click());await settle();
  expect(vi.mocked(reviewInspiration).mock.calls[1][0]).toEqual(fresh);
});
it('limits a mixed sitting to five and reserves two slots for originals',async()=>{
  vi.mocked(listInspirationReviews).mockResolvedValue([original,{...original,id:'original-2'}]);
  vi.mocked(listClaims).mockResolvedValue({claims:Array.from({length:5},(_,i)=>({id:`signal-${i}`,statement:`Signal ${i}`,status:'active',confidence:80,evidenceCount:3,lastEvidenceAt:null,locked:false,unsupported:false,sharedGroupIds:[],createdAt:'2026-08-01T00:00:00Z'})),more:false});
  await open();expect(world.container.textContent).toContain(original.text);
  await act(async()=>button('Later').click());await act(async()=>button('Later').click());
  expect(world.container.textContent).toContain('Signal 0');
  expect(world.container.textContent).not.toContain('Signal 3');
});
it('shows a retry instead of an empty-state claim when the queue cannot load',async()=>{
  vi.mocked(listInspirationReviews).mockRejectedValueOnce(new Error('offline'));
  world=await mountWorld();await act(async()=>button('Actions').click());
  expect(world.container.textContent).toContain('Couldn’t load reviews · Retry');
  expect(world.container.textContent).not.toContain('Nothing to review right now.');
  await act(async()=>button('Couldn’t load reviews · Retry').click());await act(async()=>button('Actions').click());
  expect(button('Review suggestions')).toBeTruthy();
});
it('removes signals that lost their support after an original is marked irrelevant',async()=>{
  const signal={id:'retired-signal',statement:'A conclusion from this original.',status:'active' as const,confidence:80,evidenceCount:3,lastEvidenceAt:null,locked:false,unsupported:false,sharedGroupIds:[],createdAt:'2026-08-01T00:00:00Z'};
  vi.mocked(listClaims).mockResolvedValueOnce({claims:[signal],more:false}).mockResolvedValue({claims:[],more:false});
  await open();await act(async()=>button('No longer relevant').click());await settle();
  expect(listClaims).toHaveBeenCalledTimes(2);
  expect(world.container.textContent).not.toContain(signal.statement);
  expect(world.container.querySelector('.jar-pick-slip')).toBeNull();
});
it('offers retry instead of stale signal cards when relevance revalidation fails',async()=>{
  vi.mocked(listClaims).mockResolvedValueOnce({claims:[],more:false}).mockRejectedValueOnce(new Error('offline'));
  await open();await act(async()=>button('No longer relevant').click());await settle();
  await act(async()=>button('Actions').click());
  expect(world.container.textContent).toContain('Couldn’t load reviews · Retry');
  expect(reviewInspiration).toHaveBeenCalledOnce();
});
