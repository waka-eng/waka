// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY (gate G6): `lib/data` supplies the memory layers;
 * `lib/api` supplies review queues; `lib/api/inspiration-relevance` supplies
 * decisions/reloads; `lib/auth-context` supplies the viewer. They are server
 * boundaries whose reads and writes these controls must prove.
 * `helpers/render-home` and `helpers/canvas-stub` replace drawing and timing,
 * never Home's behavior. */
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { apiMockFrom, dataMockFrom, mountWorld, diveIntoReview, pressHomeBar, closeOverlay, VIEWER_ID, type MountedWorld } from './helpers/render-home';
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
/* NO MENU ROW FOR REVIEW (2026-11-08): the creature asks, glasses on. */
const sim=()=>(window as unknown as {wakaSim:()=>{think(on:boolean):void}}).wakaSim();
const tapCreature=async()=>{await act(async()=>world.container.querySelector<HTMLButtonElement>('.jar-char-press')!.click());};
it('asks through the creature, glasses on, even without signals or collector suggestions',async()=>{
  world=await mountWorld();
  expect(world.container.querySelector('.waka-home-actions'),'the Actions menu is still on home').toBeNull();
  /* THE GLASSES ARE ON AT REST while something waits: the notepad takes
     them off, and coming home puts them back on. */
  const think=vi.spyOn(sim(),'think');
  await pressHomeBar(world.container,'Keep a thought');await settle();
  expect(think).toHaveBeenLastCalledWith(false);
  await closeOverlay(world.container);await settle();
  expect(think,'home with a review waiting did not put the glasses on').toHaveBeenLastCalledWith(true);
  /* The reading still comes first; a tap is the ask. */
  expect(world.container.querySelector('.jar-char-bubble--review')).toBeNull();
  await tapCreature();
  expect(world.container.querySelector('.jar-char-bubble--review')?.textContent).toContain('There is 1 thing to review!');
  await diveIntoReview(world.container,world.step);
  expect(world.container.textContent).toContain('Is this still relevant to you?');expect(world.container.textContent).toContain(original.text);
  expect(world.container.textContent).toContain('Your saved inspiration');
  await act(async()=>button('Still relevant').click());await settle();
  expect(reviewInspiration).toHaveBeenCalledWith(original,VIEWER_ID,'relevant',expect.any(String));
  expect(world.container.querySelector('.jar-pick-slip')).toBeNull();
});
it('shows nothing about review, and no glasses, when nothing waits',async()=>{
  vi.mocked(listInspirationReviews).mockResolvedValue([]);
  world=await mountWorld();
  const think=vi.spyOn(sim(),'think');
  await pressHomeBar(world.container,'Keep a thought');await settle();
  await closeOverlay(world.container);await settle();
  expect(think.mock.calls.some(([on])=>on),'the glasses went on with nothing to review').toBe(false);
  for(let tap=0;tap<4;tap+=1){
    await tapCreature();
    expect(world.container.querySelector('.jar-char-bubble--review'),'the creature offered review with nothing waiting').toBeNull();
  }
  expect(world.container.textContent).not.toContain('Nothing to review right now.');
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
it('shows nothing when the queue cannot load, and asks again on the next tap',async()=>{
  vi.mocked(listInspirationReviews).mockRejectedValueOnce(new Error('offline'));
  world=await mountWorld();await settle();
  expect(world.container.textContent).not.toContain('Couldn’t load reviews');
  expect(world.container.textContent).not.toContain('Nothing to review right now.');
  const asked=vi.mocked(listInspirationReviews).mock.calls.length;
  await tapCreature();await settle();
  expect(vi.mocked(listInspirationReviews).mock.calls.length,'the tap did not ask for the queue again').toBeGreaterThan(asked);
  /* Around the cycle once more, and the queue that came back is asked about. */
  for(let tap=0;tap<4&&!world.container.querySelector('.jar-char-bubble--review');tap+=1)await tapCreature();
  expect(world.container.querySelector('.jar-char-bubble--review')?.textContent,'the queue that came back was not asked about').toContain('Dive into review');
});
it('removes signals that lost their support after an original is marked irrelevant',async()=>{
  const signal={id:'retired-signal',statement:'A conclusion from this original.',status:'active' as const,confidence:80,evidenceCount:3,lastEvidenceAt:null,locked:false,unsupported:false,sharedGroupIds:[],createdAt:'2026-08-01T00:00:00Z'};
  vi.mocked(listClaims).mockResolvedValueOnce({claims:[signal],more:false}).mockResolvedValue({claims:[],more:false});
  await open();await act(async()=>button('No longer relevant').click());await settle();
  expect(listClaims).toHaveBeenCalledTimes(2);
  expect(world.container.textContent).not.toContain(signal.statement);
  expect(world.container.querySelector('.jar-pick-slip')).toBeNull();
});
it('shows no stale signal cards when relevance revalidation fails, and asks again on the next tap',async()=>{
  vi.mocked(listClaims).mockResolvedValueOnce({claims:[],more:false}).mockRejectedValueOnce(new Error('offline'));
  await open();await act(async()=>button('No longer relevant').click());await settle();
  expect(world.container.querySelector('.jar-pick-slip'),'a stale signal card stayed up').toBeNull();
  expect(reviewInspiration).toHaveBeenCalledOnce();
  /* Nothing is shown for the failure; the next tap on the creature asks again. */
  const asked=vi.mocked(listClaims).mock.calls.length;
  await tapCreature();await settle();
  expect(vi.mocked(listClaims).mock.calls.length,'the tap did not ask for the queue again').toBeGreaterThan(asked);
});
