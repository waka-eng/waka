// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY: `lib/data` holds the owned reading response pending;
 * `lib/api` supplies unrelated reads and refuses regeneration. `lib/auth-context`
 * states the owner. `helpers/canvas-stub` and `helpers/render-home` replace
 * drawing/time, not Home's loader or UI. Timeout cases fake only timers.
 * Assertions use the current personal wall, not the hidden agent's column.
 * No database, model or real account is used. */
import {act} from 'react';
import {afterEach,beforeAll,beforeEach,expect,it,vi} from 'vitest';
import {installCanvasStub,setViewport} from './helpers/canvas-stub';
import {apiMockFrom,dataMockFrom,mountWorld,VIEWER_ID,type MountedWorld, keepBox} from './helpers/render-home';
import type {TopOfMind} from '../src/lib/data';
import {profileStorageKey} from '../src/lib/profile-storage';
const facts=vi.hoisted(()=>({inspirations:[{id:'source-one',text:'A synthetic source',daysAgo:0}],groups:[]}));
const reads=vi.hoisted(()=>({owner:'profile-viewer',requests:[] as Array<{profile?:string;signal?:AbortSignal;resolve:(value:TopOfMind|null)=>void;reject:(reason:Error)=>void}>}));
vi.mock('../src/lib/api',async original=>({...await original<typeof import('../src/lib/api')>(),...apiMockFrom(facts),refreshTopOfMind:vi.fn(),fetchInspirationProcessing:vi.fn(),fetchPrincipleStatus:vi.fn()}));
vi.mock('../src/lib/auth-context',async original=>({...await original<typeof import('../src/lib/auth-context')>(),useOptionalAuth:()=>({status:'authenticated',account:{id:'owner',email:'owner@example.test'},profile:{id:reads.owner,name:'Owner',type:'human'},profiles:[]})}));
vi.mock('../src/lib/data',async original=>({...await original<typeof import('../src/lib/data')>(),...dataMockFrom(facts),
  loadTopOfMind:(profile?:string,signal?:AbortSignal)=>new Promise<TopOfMind|null>((resolve,reject)=>reads.requests.push({profile,signal,resolve,reject}))}));
import {refreshTopOfMind,fetchInspirationProcessing,fetchPrincipleStatus} from '../src/lib/api';
let world:MountedWorld|undefined;
beforeAll(()=>{installCanvasStub();setViewport(1280,900);(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;});
beforeEach(()=>{reads.owner=VIEWER_ID;reads.requests=[];facts.inspirations=[{id:'source-one',text:'A synthetic source',daysAgo:0}];localStorage.clear();sessionStorage.clear();vi.mocked(refreshTopOfMind).mockClear();vi.mocked(fetchInspirationProcessing).mockReset();vi.mocked(fetchPrincipleStatus).mockReset().mockResolvedValue({phase:'ready',eligible:true,signalCount:3,topOfMindCount:1,readingPaused:false});});
afterEach(()=>{world?.unmount();world=undefined;vi.useRealTimers();});
const board=(body='Leave room for a small experiment.',profileId=reads.owner):TopOfMind=>({id:'reading-'+profileId,profileId,version:1,reason:'regenerated',createdMs:Date.now(),
  entries:[{id:'entry-one',type:'hypothesis',body,belief:null,prompt:null,locked:false,pinned:false,dismissed:false,sortOrder:0,citedSignals:[],createdMs:Date.now()}]});
const forming=()=>world!.container.querySelector('.jar-hq-inner--activities .jar-forming');
/**
 * THE SETTLED EMPTY LINE MOVED INTO THE COMPANION'S MOUTH.
 *
 * Founder, on that sentence printed across the middle of the screen with the
 * speech bubble floating through the word "formed": "I haven't formed
 * anything yet should be shown instead of the top of mind if it's not
 * existing yet."
 *
 * So it is said once, by the thing that would know, and `.jar-forming` keeps
 * only the two states the companion cannot speak to — LOADING and FAILED,
 * which are facts about a fetch rather than about what it has read. That
 * split is the whole of what these cases protect and it is now the harder
 * half: a companion that says "nothing yet" while the read is still in flight
 * is not slow, it is wrong, and it is wrong in the first person.
 */
const settled=()=>world!.container.querySelector('.jar-char-bubble-reading');
const poster=()=>world!.container.querySelector('h1.jar-poster[data-jar-chrome="1"]');
const retry=()=>[...world!.container.querySelectorAll<HTMLButtonElement>('.jar-hq-inner--activities .jar-forming button')].find(row=>row.textContent==='Try again')!;
const expectLoading=()=>{
  expect(forming()?.textContent).toContain('Loading your top of mind');
  expect(forming()?.getAttribute('role')).toBe('status');
  expect(world!.container.textContent).not.toContain('No reading yet');
  expect(world!.container.textContent).not.toContain('Capture your first inspiration');
  expect(world!.container.querySelector('.waka-corners')).not.toBeNull();
};
it('keeps Home usable while a delayed reading loads, without claiming it is empty',async()=>{
  world=await mountWorld(facts);expectLoading();expect(reads.requests).toHaveLength(1);expect(reads.requests[0]!.profile).toBe(VIEWER_ID);
  await act(async()=>reads.requests[0]!.resolve(board()));await world.step(2);
  expect(poster()?.textContent).toContain('Leave room for a small experiment.');
  expect(world.container.textContent).not.toContain('Loading your top of mind');expect(refreshTopOfMind).not.toHaveBeenCalled();
});
it('shows the real empty state only after the owned response confirms no reading',async()=>{
  world=await mountWorld(facts);expectLoading();await act(async()=>reads.requests[0]!.resolve(null));
  /* THE WORDS CHANGED AND THE CLAIM DID NOT. Founder: "this should say no
     top of mind formed yet, add more inspirations. Don't say no reading."
     "Reading" is the machinery's word for the thing; "top of mind" is the
     product's, and it is the one on every other surface. What this case is
     about is unchanged — the real empty state appears only once an OWNED
     response has confirmed there is nothing, never while a read is still in
     flight. */
  expect(settled()?.textContent).toContain('No top of mind formed yet');
  /* AND THE POSTER NO LONGER SAYS IT TOO. The same sentence in two registers
     sixty pixels apart, with the bubble overlapping the words, is exactly
     what the founder reported. */
  expect(forming()).toBeNull();
  expect(world.container.textContent).not.toContain('Loading your top of mind');expect(refreshTopOfMind).not.toHaveBeenCalled();
});
it('does not tell someone to capture their first inspiration until both reads confirm the empty state',async()=>{
  facts.inspirations=[];world=await mountWorld(facts);expectLoading();
  await act(async()=>reads.requests[0]!.resolve(null));
  expect(settled()?.textContent).toContain('Nothing kept to come back to yet.');
  expect(world.container.textContent).not.toContain('Loading your top of mind');
});
it('shows a read failure, preserves a Capture draft, and coalesces explicit read-only retries',async()=>{
  world=await mountWorld(facts);
  await act(async()=>reads.requests[0]!.reject(new Error('Unavailable')));
  expect(forming()?.textContent).toContain('Couldn’t load your top of mind');
  expect(forming()?.getAttribute('role')).toBe('alert');
  expect(world.container.textContent).not.toContain('No reading yet');
  const capture=keepBox(world.container);
  const textarea=capture;
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(textarea,'Keep my unfinished spark');textarea.dispatchEvent(new Event('input',{bubbles:true}));});
  await act(async()=>{retry().click();retry().click();});expect(reads.requests).toHaveLength(2);
  await act(async()=>reads.requests[1]!.resolve(board()));await world.step(2);
  /* There is no "continue" step any more: the draft never left the box, so the
     only thing to prove is that it is still sitting there after the failure
     and the retries. A placeholder about resuming would be a promise about a
     drawer that no longer exists. */
  expect(keepBox(world.container).value).toBe('Keep my unfinished spark');
  expect(keepBox(world.container).value).toBe('Keep my unfinished spark');
  expect(world.container.textContent).not.toContain('Couldn’t load your top of mind');expect(refreshTopOfMind).not.toHaveBeenCalled();
});
it('aborts a stalled read, permits retry and refuses its late completion',async()=>{
  vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});world=await mountWorld(facts);
  await act(async()=>{vi.advanceTimersByTime(15000);});expect(reads.requests[0]!.signal?.aborted).toBe(true);expect(retry()).toBeDefined();
  await act(async()=>retry().click());expect(reads.requests).toHaveLength(2);expectLoading();
  await act(async()=>reads.requests[0]!.resolve(board('Superseded reading.')));expectLoading();
  await act(async()=>reads.requests[1]!.resolve(board('The current reading.')));await world.step(2);
  expect(poster()?.textContent).toContain('The current reading.');expect(world.container.textContent).not.toContain('Superseded reading.');
});
it('does not carry a prior profile reading across an identity change',async()=>{
  world=await mountWorld(facts);const old=reads.requests[0]!;
  reads.owner='profile-other';await world.rerender();expect(old.signal?.aborted).toBe(true);expectLoading();expect(reads.requests).toHaveLength(2);
  await act(async()=>old.resolve(board('The first profile’s private reading.',VIEWER_ID)));expectLoading();
  await act(async()=>reads.requests[1]!.resolve(board('The second profile’s reading.')));await world.step(2);
  expect(poster()?.textContent).toContain('The second profile’s reading.');expect(world.container.textContent).not.toContain('first profile');
});
it('shows loading again on a Home remount instead of flashing an empty or unvalidated reading',async()=>{
  world=await mountWorld(facts);await act(async()=>reads.requests[0]!.resolve(board()));await world.step(2);world.unmount();world=undefined;
  world=await mountWorld(facts);expect(reads.requests).toHaveLength(2);expectLoading();
  await act(async()=>reads.requests[1]!.resolve(board()));await world.step(2);expect(poster()).not.toBeNull();
});
it('offers an explicit re-read when stale support is hidden and automatic reading is scheduled',async()=>{
  sessionStorage.setItem(profileStorageKey({accountId:'owner',profileId:VIEWER_ID},'sourceProcessing')!,JSON.stringify({profileId:VIEWER_ID,inspirationId:'source-one'}));
  vi.mocked(fetchInspirationProcessing).mockResolvedValue({profileId:VIEWER_ID,inspirationId:'source-one',receipt:null,
    currentMaterialRevision:'1',requestedMaterialRevision:'1',latestDerivedRevision:'1',latestCompletedRevision:'0',superseded:false,
    phase:'waiting',stage:'reading',runAfter:new Date(Date.now()+86400000).toISOString(),result:null,unavailableAttachments:0,canRetry:false});
  world=await mountWorld(facts);
  await act(async()=>reads.requests[0]!.resolve({...board(),entries:[],supportChanged:true}));await world.step(2);
  expect(world.container.textContent).toContain('This reading needs another look.');
  expect(world.container.textContent).toContain('The next reading is scheduled');
  expect(refreshTopOfMind).not.toHaveBeenCalled();
  const reread=[...world.container.querySelectorAll<HTMLButtonElement>('.jar-board-acts button')].find(row=>row.textContent?.trim()==='Read again');
  expect(reread).toBeDefined();
  await act(async()=>reread!.click());expect(refreshTopOfMind).toHaveBeenCalledOnce();
});
it.each(['queued','processing','waiting'] as const)('keeps active %s derivation separate from manual reading recovery',async phase=>{
  sessionStorage.setItem(profileStorageKey({accountId:'owner',profileId:VIEWER_ID},'sourceProcessing')!,JSON.stringify({profileId:VIEWER_ID,inspirationId:'source-one'}));
  vi.mocked(fetchInspirationProcessing).mockResolvedValue({profileId:VIEWER_ID,inspirationId:'source-one',receipt:null,
    currentMaterialRevision:'1',requestedMaterialRevision:'1',latestDerivedRevision:'0',latestCompletedRevision:'0',superseded:false,
    phase,stage:'derivation',runAfter:new Date(Date.now()+86400000).toISOString(),result:null,unavailableAttachments:0,canRetry:false});
  world=await mountWorld(facts);await act(async()=>reads.requests[0]!.resolve({...board(),entries:[],supportChanged:true}));await world.step(2);
  expect([...world.container.querySelectorAll<HTMLButtonElement>('.jar-board-acts button')].some(row=>row.textContent?.trim()==='Read again')).toBe(false);
  expect(refreshTopOfMind).not.toHaveBeenCalled();
});
/* The principles line and its Try again live in the sky, not on the board, so
   a principles failure must not hide the board's paused-reading Retry. */
it('shows the paused-reading notice with Retry on the board even when principles also failed',async()=>{
  vi.mocked(fetchPrincipleStatus).mockResolvedValue({phase:'failed',eligible:true,signalCount:3,topOfMindCount:1,readingPaused:true});
  world=await mountWorld(facts);await act(async()=>reads.requests[0]!.resolve(board()));await world.step(4);
  expect(world.container.textContent).toContain('Reading is paused — your saves are safe.');
  expect([...world.container.querySelectorAll<HTMLButtonElement>('.jar-board-acts button')].some(row=>row.textContent?.trim()==='Retry')).toBe(true);
});
