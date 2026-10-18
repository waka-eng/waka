// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY: `lib/data` controls the archive's first/final
 * response and `lib/api` unrelated room/status reads; `lib/auth-context` supplies
 * the owner. `helpers/render-home` and `helpers/canvas-stub` replace rendering
 * environment/time, not Home readiness, capture or field scheduling. */
import {act} from 'react';
import {afterEach,beforeAll,expect,it,vi} from 'vitest';
import {installCanvasStub,setViewport} from './helpers/canvas-stub';
import {apiMockFrom,dataMockFrom,mountWorld,VIEWER_ID,type MountedWorld, keepBox} from './helpers/render-home';
import type {FieldLoad} from '../src/lib/data';
const facts={inspirations:[{id:'source-one',text:'A synthetic source',daysAgo:0}],groups:[]};
const progress=vi.hoisted(()=>({first:null as null|((value:FieldLoad)=>void),finish:null as null|((value:FieldLoad)=>void),fail:null as null|((error:Error)=>void),signal:null as AbortSignal|null,calls:0}));
vi.mock('../src/lib/api',async original=>({...await original<typeof import('../src/lib/api')>(),...apiMockFrom(facts)}));
vi.mock('../src/lib/auth-context',async original=>({...await original<typeof import('../src/lib/auth-context')>(),useOptionalAuth:()=>({status:'authenticated',account:{id:'owner',email:'owner@example.test'},profile:{id:VIEWER_ID,name:'Owner',type:'human'},profiles:[]})}));
vi.mock('../src/lib/data',async original=>({...await original<typeof import('../src/lib/data')>(),...dataMockFrom(facts),loadInspirations:async(_profile:unknown,options:{onFirstPage?:(field:FieldLoad)=>void;signal?:AbortSignal})=>{
  progress.calls++;progress.signal=options.signal??null;progress.first=options.onFirstPage??null;
  return new Promise<FieldLoad>((finish,fail)=>{progress.finish=finish;progress.fail=fail;});
}}));
let world:MountedWorld;
beforeAll(()=>{installCanvasStub();setViewport(1280,900);(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;});
afterEach(async()=>{await world?.unmount();progress.first=null;progress.finish=null;progress.fail=null;progress.signal=null;progress.calls=0;});
const source={id:'source-one',preview:'A synthetic source',isPublic:false,kind:'note' as const,source:'app' as const,capturedMs:1,updatedMs:1,attachments:[],reflectionCount:0};
it('enables Home/Capture after the first page and keeps the field unpainted until its complete geometry is ready',async()=>{
  world=await mountWorld(facts);expect(world.container.querySelector('.waka-corners')).toBeNull();
  await act(async()=>progress.first!({inspirations:[source],total:2000,short:true}));
  expect(world.container.querySelector('.waka-corners')).not.toBeNull();expect(world.audit().present).toBe(0);
  expect(keepBox(world.container)).toBeDefined();
  await act(async()=>progress.finish!({inspirations:[source],total:2000,short:true}));
  expect(world.audit().present).toBe(1);
});
it('keeps a capture draft through a later page failure',async()=>{
  world=await mountWorld(facts);
  await act(async()=>progress.first!({inspirations:[source],total:2000,short:true}));
  const capture=keepBox(world.container);
  const textarea=capture;
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(textarea,'Keep my unfinished spark');textarea.dispatchEvent(new Event('input',{bubbles:true}));});
  await act(async()=>progress.fail!(new Error('Later page unavailable')));
  /* THE RETRY MOVED WITH THE ARCHIVE. Explicitly re-asking for a failed page
     is the Inspirations page's job now — it loads its own data and reports its
     own failure. What this suite still owns is the part that would be
     unforgivable: a page failing underneath someone must not take the words
     they were in the middle of writing. */
  expect(keepBox(world.container).value).toBe('Keep my unfinished spark');
  expect(world.audit().present).toBe(0);
  expect(world.container.textContent).not.toContain('Couldn’t open inspirations');
});
it('cancels the archive continuation on leaving Home and ignores its late completion',async()=>{
  world=await mountWorld(facts);await act(async()=>progress.first!({inspirations:[source],total:2000,short:true}));
  const signal=progress.signal!,finish=progress.finish!;
  await world.unmount();expect(signal.aborted).toBe(true);
  await act(async()=>finish({inspirations:[source],total:1,short:false}));
  expect(world.container.querySelector('.waka-corners')).toBeNull();
});
/* The one line a GENUINELY empty archive gets, and nothing else may borrow
   it. While the walk is still coming back there is no honest way to say
   "nothing here" — the remainder already says there are two thousand. */
const FIRST_CAPTURE_HINT='A thought, a link, or something you noticed.';
it('labels loading on a cold field link instead of presenting the unfinished field as empty',async()=>{
  /* A COLD LINK LANDS IN THE FIELD BEFORE THE FIELD EXISTS, which is the one
     arrival where "not painted yet" and "nothing was ever kept" look
     identical on screen. The first page came back SHORT: zero orbs are placed
     (rank and crowding need the complete geometry — that is the first case in
     this file), so the ground a person is now standing on is bare for a
     second or two while two thousand memories are still on the wire.

     The empty-archive state is the thing that must not appear in that second.
     It is not a cosmetic difference: the hint under the poster is an
     instruction to a person who has never kept anything, and showing it to
     someone with two thousand memories tells them their archive is gone. The
     page avoids it by holding the REMAINDER (`fieldBeyond`) from the short
     first page, so "no orbs" and "no memories" stay different facts.

     This used to assert the Inspirations row in the menu read "Opening
     inspirations" and was disabled. That door went with the archive becoming
     its own page, and the assertions went with it — leaving a case that
     mounted a world, stepped it two thousand frames and asserted nothing, so
     it could not fail. What it was protecting is still here; only the surface
     that says it moved. */
  world=await mountWorld(facts,{initialEntries:['/?view=field']});
  await act(async()=>progress.first!({inspirations:[source],total:2000,short:true}));
  for(let n=0;n<20;n++)await world.step(100);
  const waiting=world.audit();
  /* the link was honoured: the camera is DOWN, which is what makes the empty
     ground visible at all — at headquarters none of this would be on screen */
  expect(Math.abs(waiting.camY-waiting.fieldRest)).toBeLessThan(1);
  expect(waiting.present).toBe(0);expect(waiting.drawn.active).toBe(0);
  expect(world.container.querySelector('.jar-first-capture-hint')).toBeNull();
  expect(world.container.textContent).not.toContain(FIRST_CAPTURE_HINT);
  /* AND IT RESOLVES INTO THE FIELD, rather than into a world that has to be
     re-entered: the complete geometry paints under a camera that never left. */
  await act(async()=>progress.finish!({inspirations:[source],total:1,short:false}));
  await world.step(60);
  const arrived=world.audit();
  expect(arrived.present).toBe(1);
  expect(Math.abs(arrived.camY-arrived.fieldRest)).toBeLessThan(1);
  expect(world.container.querySelector('.jar-first-capture-hint')).toBeNull();
  /* THE ABSENCE ABOVE HAS TO BE WORTH SOMETHING. An assertion that a line is
     missing passes just as well against a line that was deleted, a selector
     that was renamed, or a hint that never renders on this screen at all — so
     the same two checks run once more against the world the hint DOES belong
     to. A complete first page holding nothing is a real empty archive, and it
     says so. Without this half, the four lines above are a tripwire with
     nothing attached to it. */
  await world.unmount();
  world=await mountWorld(facts,{initialEntries:['/?view=field']});
  await act(async()=>progress.first!({inspirations:[],total:0,short:false}));
  for(let n=0;n<6;n++)await world.step(100);
  expect(world.audit().present).toBe(0);
  expect(world.container.querySelector('.jar-first-capture-hint')?.textContent).toBe(FIRST_CAPTURE_HINT);
});

/* ═══ A REBUILD UNDER A PRESS SETTLES WHAT THE PRESS OWED ══════════════════
   The rest of the archive arriving rebuilds the loop, and the rebuild does
   not carry a held press (see `Carry`). A press that interrupted an aim left
   the camera between two sections, and only its release would have sent it
   home — so the teardown pays that debt before the camera is carried, or the
   rebuilt world re-anchors against its own unsized first layout and lands
   wherever that says (code review, 2026-10-17). */
it('sends the camera to the section a held press owed when the archive lands under it',async()=>{
  world=await mountWorld(facts);
  await act(async()=>progress.first!({inspirations:[source],total:2,short:true}));
  await world.step(30);
  const sim=()=>(window as unknown as {wakaSim:()=>{toGround():void;isResting():boolean}|null}).wakaSim()!;
  await act(async()=>sim().toGround());
  await world.step(4);
  await act(async()=>{world.container.querySelector('canvas')!.dispatchEvent(new window.PointerEvent('pointerdown',
    {bubbles:true,cancelable:true,pointerId:31,pointerType:'touch',clientX:640,clientY:300,button:0,buttons:1}));});
  const {camY:stopped,fieldRest}=world.audit();
  expect(stopped>0&&stopped<fieldRest/2,`the press did not stop the camera in the upper half (${stopped} of ${fieldRest})`).toBe(true);
  const before=sim();
  await act(async()=>progress.finish!({inspirations:[source,{...source,id:'source-two',preview:'A second source'}],total:2,short:false}));
  await world.step(60);
  expect(sim(),'the archive landing did not rebuild the loop').not.toBe(before);
  expect(world.audit().camY,'the rebuilt camera did not go to the section the press owed').toBe(0);
  expect(sim().isResting()).toBe(true);
});
