// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY: `lib/data` controls the archive's first/final
 * response and `lib/api` unrelated room/status reads; `lib/auth-context` supplies
 * the owner. `helpers/render-home` and `helpers/canvas-stub` replace rendering
 * environment/time, not Home readiness, capture or field scheduling. */
import {act} from 'react';
import {afterEach,beforeAll,expect,it,vi} from 'vitest';
import {installCanvasStub,setViewport} from './helpers/canvas-stub';
import {apiMockFrom,dataMockFrom,mountWorld,VIEWER_ID,type MountedWorld} from './helpers/render-home';
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
  world=await mountWorld(facts);expect(world.container.querySelector('.jar-home-activities')).toBeNull();
  await act(async()=>progress.first!({inspirations:[source],total:2000,short:true}));
  expect(world.container.querySelector('.jar-home-activities')).not.toBeNull();expect(world.audit().present).toBe(0);
  const field=world.container.querySelector<HTMLButtonElement>('.jar-saved')!;expect(field.disabled).toBe(true);expect(field.textContent).toContain('Opening inspirations');
  const capture=[...world.container.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent?.trim()==='Capture inspiration')!;
  await act(async()=>capture.click());expect(world.container.querySelector('[aria-label="Capture inspiration"]')).not.toBeNull();
  await act(async()=>progress.finish!({inspirations:[source],total:2000,short:true}));
  expect(world.container.querySelector('[aria-label="Capture inspiration"]')).not.toBeNull();expect(world.audit().present).toBe(1);
});
it('keeps Capture and its draft through a later page failure, with one explicit retry',async()=>{
  world=await mountWorld(facts);
  await act(async()=>progress.first!({inspirations:[source],total:2000,short:true}));
  const capture=[...world.container.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent?.trim()==='Capture inspiration')!;
  await act(async()=>capture.click());
  const textarea=world.container.querySelector<HTMLTextAreaElement>('[aria-label="Capture inspiration"] textarea')!;
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(textarea,'Keep my unfinished spark');textarea.dispatchEvent(new Event('input',{bubbles:true}));});
  await act(async()=>progress.fail!(new Error('Later page unavailable')));
  expect(world.container.querySelector('.jar-home-activities')).not.toBeNull();
  expect(world.container.querySelector<HTMLTextAreaElement>('[aria-label="Capture inspiration"] textarea')!.value).toBe('Keep my unfinished spark');
  expect(world.audit().present).toBe(0);
  const retry=world.container.querySelector<HTMLButtonElement>('.jar-saved')!;
  expect(retry.disabled).toBe(false);expect(retry.textContent).toContain('Try again');
  await act(async()=>{retry.click();retry.click();});expect(progress.calls).toBe(2);
  expect(world.container.querySelector<HTMLButtonElement>('.jar-saved')!.disabled).toBe(true);
  await act(async()=>progress.finish!({inspirations:[source],total:2000,short:true}));
  expect(world.container.querySelector<HTMLTextAreaElement>('[aria-label="Capture inspiration"] textarea')!.value).toBe('Keep my unfinished spark');
  expect(world.audit().present).toBe(1);expect(world.container.textContent).not.toContain('Couldn’t open inspirations');
});
it('cancels the archive continuation on leaving Home and ignores its late completion',async()=>{
  world=await mountWorld(facts);await act(async()=>progress.first!({inspirations:[source],total:2000,short:true}));
  const signal=progress.signal!,finish=progress.finish!;
  await world.unmount();expect(signal.aborted).toBe(true);
  await act(async()=>finish({inspirations:[source],total:1,short:false}));
  expect(world.container.querySelector('.jar-home-activities')).toBeNull();
});
it('labels loading on a cold field link instead of presenting the unfinished field as empty',async()=>{
  world=await mountWorld(facts,{initialEntries:['/?view=field']});
  await act(async()=>progress.first!({inspirations:[source],total:2000,short:true}));
  for(let n=0;n<20;n++)await world.step(100);
  expect(world.container.querySelector<HTMLButtonElement>('.jar-saved')!.textContent).toContain('Opening inspirations');
  expect(world.container.querySelector<HTMLButtonElement>('.jar-saved')!.disabled).toBe(true);
});
