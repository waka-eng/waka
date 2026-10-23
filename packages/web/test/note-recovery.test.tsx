// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY (gate G6): `lib/data` supplies profile-scoped notes
 * and `lib/api` holds roster loading and records writes. `lib/api/principles`
 * supplies the unrelated reading; `lib/auth-context` supplies a human owner.
 * `helpers/render-home` and `helpers/canvas-stub` supply canvas/clock. Real Home, router, archive,
 * textarea events and localStorage run through a full unmount/remount. */
import { act } from 'react';
import { useLocation } from 'react-router-dom';
import { beforeAll, beforeEach, afterEach, expect, it, vi } from 'vitest';
import { mountWorld, dataMockFrom, apiMockFrom, VIEWER_ID, type MountedWorld } from './helpers/render-home';
import { installCanvasStub, setViewport } from './helpers/canvas-stub';
import { updateInspiration } from '../src/lib/api';
import { readNoteEdit, writeNoteEdit, clearNoteEdit } from '../src/lib/note-edit-drafts';

const S = vi.hoisted(() => ({ agent: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', text: 'Original saved text.',
  holdRoster: false, release: null as null | (() => void), reads: [] as string[] }));
const FACTS = { inspirations: [], groups: [] };
vi.mock('../src/lib/api/principles', async original => ({ ...await original<typeof import('../src/lib/api/principles')>(),
  fetchPrincipleRead: async () => ({ principles: [], status: { phase: 'ready', eligible: false } }),
}));
vi.mock('../src/lib/data', async original => ({ ...await original<typeof import('../src/lib/data')>(),
  ...dataMockFrom({ inspirations: [], groups: [] }),
  loadInspirations: async (profile?: string) => dataMockFrom({inspirations:profile===S.agent?[{id:'agent-note',text:S.text,daysAgo:1}]:[],groups:[]}).loadInspirations(),
  loadInspiration: async (id: string, profile?: string) => {
    S.reads.push(profile ?? 'human');
    if(profile !== S.agent) throw new Error('Wrong owner');
    return dataMockFrom({inspirations:[{id:'agent-note',text:S.text,daysAgo:1}],groups:[]}).loadInspiration(id);
  },
}));
vi.mock('../src/lib/api', async original => ({ ...await original<typeof import('../src/lib/api')>(), ...apiMockFrom({ inspirations: [], groups: [] }),
  fetchProfiles: async () => { if(S.holdRoster) await new Promise<void>(resolve => { S.release=resolve; });
    return [{id:S.agent,type:'agent',name:'Noah',createdAt:'2026-08-01T00:00:00Z',hasInspirations:true}]; },
  fetchPrinciples: async () => [], updateInspiration: vi.fn(async (_id, patch) => { S.text=patch.text; }),
}));
vi.mock('../src/lib/auth-context', async original => {
  const auth={status:'authenticated',account:{id:'owner',email:'owner@example.test'},profile:{id:VIEWER_ID,name:'Me',type:'human'},profiles:[]};
  return {...await original<typeof import('../src/lib/auth-context')>(),useOptionalAuth:()=>auth,useAuth:()=>auth};
});
let world: MountedWorld, location: ReturnType<typeof useLocation>;
function RouterProbe(){location=useLocation();return null;}
const scope={accountId:'owner',profileId:S.agent};
const url=()=>`/w/${S.agent}/noah?open=saves&note=agent-note`;
const page=()=>world.container.querySelector<HTMLTextAreaElement>('textarea.waka-note-page');
async function settle(){for(let i=0;i<8;i++){await world.step(100);await act(async()=>{await vi.advanceTimersByTimeAsync(100);});}}
async function boot(){world=await mountWorld(FACTS,{initialEntries:[url()],routerTools:<RouterProbe/>});await settle();}
async function edit(text:string){await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(page(),text);page()!.dispatchEvent(new Event('input',{bubbles:true}));});}
beforeAll(()=>{installCanvasStub();setViewport(1280,900);(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;});
beforeEach(()=>{localStorage.clear();S.text='Original saved text.';S.holdRoster=false;S.release=null;S.reads=[];vi.mocked(updateInspiration).mockClear();vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});});
afterEach(()=>{world?.unmount();vi.useRealTimers();});
it('keeps the agent note URL while its roster loads, then recovers edited words after reload',async()=>{
  S.holdRoster=true;await boot();
  expect(new URLSearchParams(location.search).get('note')).toBe('agent-note');
  expect(page()).toBeNull();
  S.holdRoster=false;await act(async()=>S.release?.());await settle();
  expect(page()?.value).toBe(S.text);expect(S.reads).toEqual([S.agent]);
  await edit('Edited words survive refresh.');
  expect(readNoteEdit(scope,'agent-note')?.text).toBe('Edited words survive refresh.');
  world.unmount();await boot();
  expect(page()?.value).toBe('Edited words survive refresh.');
  expect(new URLSearchParams(location.search).get('note')).toBe('agent-note');
  expect(vi.mocked(updateInspiration)).not.toHaveBeenCalled();
  const save=world.container.querySelector<HTMLButtonElement>('button[aria-label="Save inspiration"]');
  await act(async()=>save!.click());await settle();
  expect(S.text).toBe('Edited words survive refresh.');
  expect(readNoteEdit(scope,'agent-note')).toBeNull();
  expect(world.container.textContent).toContain('Saved');
});
it('does not recover sibling or other-account drafts and warns about changed server text',async()=>{
  writeNoteEdit({accountId:'other',profileId:S.agent},'agent-note',S.text,'PRIVATE',null);
  writeNoteEdit({accountId:'owner',profileId:'anotherone'},'agent-note',S.text,'SIBLING',null);
  await boot();expect(page()?.value).toBe(S.text);world.unmount();
  writeNoteEdit(scope,'agent-note',S.text,'Recovered local edit',null);S.text='Changed elsewhere';
  await boot();expect(page()?.value).toBe('Recovered local edit');
  expect(world.container.textContent).toContain('This note changed elsewhere');
  await act(async()=>page()!.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));await settle();
  expect(vi.mocked(updateInspiration)).not.toHaveBeenCalled();
});
it('names the URL’s agent as the capture destination after a cold load',async()=>{
  S.holdRoster=true;
  world=await mountWorld(FACTS,{initialEntries:[`/w/${S.agent}/noah?compose=1`],routerTools:<RouterProbe/>});
  await settle();
  expect(world.container.querySelector('.jar-note-owner')?.textContent ?? '').not.toContain('Me');
  S.holdRoster=false;await act(async()=>S.release?.());await settle();
  expect(world.container.querySelector('.jar-note-owner')?.textContent).toBe('Saving to Noah');
  expect(new URLSearchParams(location.search).get('compose')).toBe('1');
});
it('refuses another tab’s overwrite and preserves newer words when an older save finishes',()=>{
  const first=writeNoteEdit(scope,'agent-note','base','first',null)!;
  const next=writeNoteEdit(scope,'agent-note','base','newer',first.revision)!;
  clearNoteEdit(scope,'agent-note',first.revision);
  expect(readNoteEdit(scope,'agent-note')).toEqual(next);
  expect(()=>writeNoteEdit(scope,'agent-note','base','stale',first.revision)).toThrow();
});
