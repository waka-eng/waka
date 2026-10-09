// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY (gate G6): `lib/data` supplies the three layers and
 * direct detail reads, `lib/api` supplies group reads and principle edits,
 * `lib/api/principles` supplies principle reads, `lib/auth-context` supplies the
 * session. `helpers/render-home` and `helpers/canvas-stub` replace canvas/viewport/clock/randomness, but the real
 * world simulation and React Router history run. Appearance/SQL are not claimed. */
import { act } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { installCanvasStub, setViewport } from './helpers/canvas-stub';
import { mountWorld, dataMockFrom, apiMockFrom, VIEWER_ID, type MountedWorld } from './helpers/render-home';
import {fetchGroupMembers} from '../src/lib/api';
import { loadInspirations, loadInspiration, type InspirationDetail } from '../src/lib/data';
import {fetchPrinciples,updatePrinciple,updateInspiration,type ApiPrinciple} from '../src/lib/api';

const FACTS = vi.hoisted(() => ({ inspirations: [{ id: 'loaded', text: 'Current inspiration', daysAgo: 1 }],
  groups: [{ id: 'group-id', name: 'Renamed room', field: [{id:'viewer-public',ownerProfileId:'profile-viewer',ownerName:'You',daysAgo:1},{id:'peer-public',ownerProfileId:'peer',ownerName:'Bo',daysAgo:1}] }] }));
const principleState=vi.hoisted(()=>({rows:[] as ApiPrinciple[]}));
vi.mock('../src/lib/api/principles',async original=>({...await original<typeof import('../src/lib/api/principles')>(),fetchPrincipleRead:vi.fn(async()=>({principles:principleState.rows,status:{phase:'ready',eligible:false}}))}));
vi.mock('../src/lib/data', async (original) => ({ ...await original<typeof import('../src/lib/data')>(),
  ...dataMockFrom(FACTS), loadInspirations: vi.fn(dataMockFrom(FACTS).loadInspirations), loadInspiration: vi.fn() }));
vi.mock('../src/lib/api', async (original) => ({ ...await original<typeof import('../src/lib/api')>(), ...apiMockFrom(FACTS),fetchGroupMembers:vi.fn(apiMockFrom(FACTS).fetchGroupMembers),fetchPrinciples:vi.fn(async()=>principleState.rows),updatePrinciple:vi.fn(),updateInspiration:vi.fn() }));
vi.mock('../src/lib/auth-context', async (original) => {
  const session = { status: 'authenticated', account: { id: 'account-1', email: 'you@example.test' },
    profile: { id: VIEWER_ID, name: 'You', type: 'human' }, profiles: [], refresh: async () => undefined, signOut: async () => undefined };
  return { ...await original<typeof import('../src/lib/auth-context')>(), useOptionalAuth: () => session, useAuth: () => session };
});
let world: MountedWorld, go: ReturnType<typeof useNavigate>, location: ReturnType<typeof useLocation>;
function RouterTools() { go = useNavigate(); location = useLocation(); return null; }
const detail: InspirationDetail = { id: 'older', text: 'An older inspiration beyond the field window', preview: 'An older inspiration',
  source: 'app', kind: 'note', isPublic: false, capturedMs: 1700000000000, updatedMs: 1700000000000,
  attachments: [], enrichment: [], reflectionCount: 2, reflections: [
    { id: 'answer-1', question: 'Why?', answer: 'My earlier words', skipped: false, createdMs: 1700000000000 },
    { id: 'answer-2', question: 'Next?', answer: 'My later words', skipped: false, createdMs: 1700000001000 },
  ] };
beforeAll(() => { installCanvasStub(); setViewport(1280, 900); (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => { principleState.rows=[];vi.mocked(updatePrinciple).mockReset();vi.mocked(fetchPrinciples).mockClear();vi.mocked(fetchGroupMembers).mockReset().mockImplementation(apiMockFrom(FACTS).fetchGroupMembers);localStorage.clear(); vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); vi.mocked(loadInspirations).mockClear(); vi.mocked(loadInspiration).mockReset().mockResolvedValue(detail); });
afterEach(() => { world?.unmount(); vi.useRealTimers(); });
async function settle() {
  for (let turn = 0; turn < 8; turn += 1) { await world.step(100); await act(async () => { await vi.advanceTimersByTimeAsync(100); }); }
}
async function navigate(to: string | number) { await act(async () => { if (typeof to === 'number') go(to); else go(to); }); await settle(); }

it('keeps named personal destinations available and records section navigation for Back',async()=>{
  world=await mountWorld(FACTS,{routerTools:<RouterTools/>});await settle();
  const nav=()=>world.container.querySelector<HTMLElement>('.jar-personal-navigation')!;
  const button=(label:string)=>[...nav().querySelectorAll<HTMLButtonElement>('button')].find(node=>node.textContent?.startsWith(label))!;
  expect(nav().hidden).toBe(false);
  await act(async()=>button('Inspirations').click());await settle();expect(location.search).toContain('view=field');
  expect(nav().hidden).toBe(false);expect(button('Inspirations').getAttribute('aria-current')).toBe('page');
  await act(async()=>button('Principles').click());await settle();expect(location.search).toContain('view=sky');
  await navigate(-1);expect(location.search).toContain('view=field');
  await act(async()=>button('Home').click());await settle();expect(location.pathname+location.search).toBe('/');
  expect(nav().querySelector('[aria-label="Find inspiration"]')).not.toBeNull();
});

it('allows moving above and below Home without using the tab bar, with Back restoring each place',async()=>{
  world=await mountWorld(FACTS,{routerTools:<RouterTools/>});await settle();
  const click=async(selector:string)=>{await act(async()=>world.container.querySelector<HTMLButtonElement>(selector)!.click());await settle();};
  expect(world.container.querySelector('.jar-values')).not.toBeNull();expect(world.container.querySelector('.jar-saved--personal')).not.toBeNull();
  await click('.jar-values');expect(location.search).toContain('view=sky');
  await click('.jar-up--down');expect(location.pathname+location.search).toBe('/');
  await click('.jar-saved--personal');expect(location.search).toContain('view=field');
  await click('.jar-up');expect(location.pathname+location.search).toBe('/');
  await navigate(-1);expect(location.search).toContain('view=field');
  await navigate(-1);expect(location.pathname+location.search).toBe('/');
});
it('makes a group avatar tap open that member’s public view and lets Back return to the room',async()=>{
  world=await mountWorld(FACTS,{initialEntries:['/w/group-id/renamed-room'],routerTools:<RouterTools/>});await settle();
  const peer=world.audit().company.find(seat=>seat.id==='peer')!;
  expect(peer).toBeDefined();const {x,y}=peer;
  const pointer={pointerId:1,pointerType:'mouse',bubbles:true,clientX:x,clientY:y};
  await act(async()=>{
    world.container.querySelector('canvas')!.dispatchEvent(new PointerEvent('pointerdown',{...pointer,cancelable:true}));
    window.dispatchEvent(new PointerEvent('pointerup',pointer));
  });
  expect(location.search).toContain('member=peer');await settle();
  expect(location.search).toContain('view=field');expect(world.audit().ground).toBe('peer');expect(world.audit().present).toBe(1);
  await navigate(-1);expect(location.search).toBe('');expect(world.audit().ground).toBeNull();
});
it('opens the member on the painted room even before the room route observer catches up',async()=>{
  world=await mountWorld(FACTS,{routerTools:<RouterTools/>});await settle();
  await world.travelTo(/Renamed room/);expect(world.audit().wallId).toBe('group-id');
  const member=[...world.container.querySelectorAll<HTMLButtonElement>('.jar-grounds-row')].find(button=>button.textContent==='Bo')!;
  await act(async()=>member.click());expect(location.pathname).toContain('/w/group-id/');
  expect(location.search).toContain('member=peer');await settle();expect(world.audit().ground).toBe('peer');
});
it('gives a member with nothing public an explicit empty view',async()=>{
  const base=await apiMockFrom(FACTS).fetchGroupMembers('group-id');
  vi.mocked(fetchGroupMembers).mockResolvedValue([...base,{profileId:'empty-member',name:'Sora',type:'human',role:'member',joinedAt:'2026-10-01T12:00:00Z'}]);
  world=await mountWorld(FACTS,{initialEntries:['/w/group-id/renamed-room'],routerTools:<RouterTools/>});await settle();
  const member=[...world.container.querySelectorAll<HTMLButtonElement>('.jar-grounds-row')].find(button=>button.textContent==='Sora')!;
  await act(async()=>member.click());await settle();
  expect(world.audit().ground).toBe('empty-member');expect(world.audit().present).toBe(0);
  expect(world.container.querySelector('.jar-group-ground-status')?.textContent).toContain('SoraNo public inspirations');
});
it('keeps member-list scrolling and arrow selection inside the list',async()=>{
  world=await mountWorld(FACTS,{initialEntries:['/w/group-id/renamed-room'],routerTools:<RouterTools/>});await settle();
  const group=world.container.querySelector<HTMLElement>('[role="radiogroup"]')!;
  const rows=[...group.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
  expect(rows[0].tabIndex).toBe(0);expect(rows[1].tabIndex).toBe(-1);
  const wheel=new WheelEvent('wheel',{deltaY:300,bubbles:true,cancelable:true});
  await act(async()=>group.dispatchEvent(wheel));await settle();
  expect(wheel.defaultPrevented).toBe(false);expect(location.search).toBe('');
  await act(async()=>rows[0].dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true})));await settle();
  expect(world.audit().ground).toBe('peer');expect(rows[1].tabIndex).toBe(0);expect(document.activeElement).toBe(rows[1]);
  await act(async()=>rows[1].dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true,cancelable:true})));await settle();
  expect(world.audit().ground).toBeNull();expect(rows[0].tabIndex).toBe(0);
});
it('opens a room member’s public view by name and keeps that selection across Back/Forward',async()=>{
  world=await mountWorld(FACTS,{initialEntries:['/w/group-id/renamed-room'],routerTools:<RouterTools/>});await settle();
  const member=[...world.container.querySelectorAll<HTMLButtonElement>('.jar-grounds-row')].find(button=>button.textContent==='Bo')!;
  await act(async()=>member.click());await settle();
  expect(location.search).toContain('view=field');expect(location.search).toContain('member=peer');
  expect(world.audit().ground).toBe('peer');expect(world.audit().present).toBe(1);
  expect(world.container.querySelector('.jar-group-ground-status')?.textContent).toContain('BoPublic inspirations');
  await navigate(-1);expect(location.search).toBe('');expect(world.audit().ground).toBeNull();
  await navigate(1);expect(world.audit().ground).toBe('peer');
});

it('keeps the selected principle and its route after editing, so Back returns to the prior view',async()=>{
  principleState.rows=[{id:'principle-one',statement:'Leave room for thought.',type:'maxim',state:'held',origin:'declared',rank:0,locked:true,heldSince:null,conflictsWithId:null,createdAt:'2026-10-03T12:00:00Z',citedSignals:[]}];
  vi.mocked(updatePrinciple).mockImplementation(async(_id,text)=>{principleState.rows=[{...principleState.rows[0],statement:text}];return principleState.rows[0];});
  world=await mountWorld(FACTS,{routerTools:<RouterTools/>});await settle();await navigate('/principles/principle-one');
  await act(async()=>world.container.querySelector<HTMLButtonElement>('[aria-label="Edit wording"]')!.click());
  const editor=world.container.querySelector<HTMLTextAreaElement>('[aria-label="this principle in your own words"]')!;
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(editor,'Leave unhurried time for thought.');editor.dispatchEvent(new Event('input',{bubbles:true}));});
  await act(async()=>[...world.container.querySelectorAll<HTMLButtonElement>('.jar-principles-list--personal button')].find(button=>button.textContent==='save')!.click());await settle();
  expect(location.pathname).toBe('/principles/principle-one');expect(world.container.textContent).toContain('Make a share card');
  expect(updatePrinciple).toHaveBeenCalledWith('principle-one','Leave unhurried time for thought.');
  await navigate(-1);expect(location.pathname+location.search).toBe('/');
});
it('shows principle management only after choosing the words to read',async()=>{
  principleState.rows=[{id:'principle-one',statement:'Leave room for thought.',type:'maxim',state:'held',origin:'declared',rank:0,locked:true,heldSince:null,conflictsWithId:null,createdAt:'2026-10-03T12:00:00Z',citedSignals:[]}];
  world=await mountWorld(FACTS,{initialEntries:['/?view=sky'],routerTools:<RouterTools/>});await settle();
  expect(world.container.querySelector('.jar-principle-tools')).toBeNull();
  const words=world.container.querySelector<HTMLButtonElement>('.jar-values-value')!;await act(async()=>words.click());await settle();
  expect(location.pathname).toBe('/principles/principle-one');
  expect(world.container.querySelector('[aria-label="Edit wording"]')).not.toBeNull();
  await navigate(-1);expect(world.container.querySelector('.jar-principle-tools')).toBeNull();
});
it('hides a principle’s expanded evidence when Back closes that principle',async()=>{
  principleState.rows=[{id:'principle-one',statement:'Leave room for thought.',type:'maxim',state:'held',origin:'minted',rank:0,locked:false,heldSince:null,conflictsWithId:null,createdAt:'2026-10-03T12:00:00Z',citedSignals:[{id:'signal-one',statement:'Make space to think.',examples:[{text:'I left an unhurried morning for thinking.',createdAt:'2026-10-03T12:00:00Z'}]}]}];
  world=await mountWorld(FACTS,{routerTools:<RouterTools/>});await settle();await navigate('/principles/principle-one');
  const why=[...world.container.querySelectorAll<HTMLButtonElement>('.jar-principles-list--personal button')].find(button=>button.textContent==='Why this fits')!;
  await act(async()=>why.click());expect(world.container.querySelector('.jar-principle-evidence')).not.toBeNull();
  await navigate(-1);expect(location.pathname+location.search).toBe('/');
  expect(world.container.textContent).not.toContain('Talk about this');
  expect(world.container.querySelector('.jar-principle-evidence')).toBeNull();
});

it('starts a review beside the personal reading and restores home through Back',async()=>{
  world=await mountWorld(FACTS,{routerTools:<RouterTools/>});await settle();
  expect(world.container.querySelector('.jar-reading-heading')?.textContent).toContain('Top of mind');
  const review=[...world.container.querySelectorAll<HTMLButtonElement>('.jar-home-activities button')].find(button=>button.textContent?.startsWith('Revisit your inspirations'));
  expect(world.container.querySelector('.jar-reading-actions')?.textContent).not.toContain('Revisit your inspirations');
  expect(review).toBeDefined();await act(async()=>review!.click());await settle();expect(location.pathname).toBe('/review/new');
  await navigate(-1);expect(location.pathname).toBe('/');
});
it('requires a visible audience confirmation before publishing and leaves cancel private',async()=>{
  vi.mocked(updateInspiration).mockClear();
  world=await mountWorld(FACTS,{initialEntries:['/inspirations/older'],routerTools:<RouterTools/>});await settle();
  expect(world.container.querySelector<HTMLElement>('.jar-personal-shortcuts')?.hidden).toBe(true);
  const button=(label:string)=>[...world.container.querySelectorAll<HTMLButtonElement>('.jar-panel button')].find(item=>item.textContent?.trim()===label)!;
  expect(world.container.querySelector('.jar-panel .jar-audience-note')).toBeNull();
  expect(button('private').getAttribute('title')).toBeNull();
  expect(button('public').getAttribute('title')).toBeNull();
  await act(async()=>button('public').click());
  expect(world.container.textContent).toContain('People in your rooms can read it and its attachments');
  expect(updateInspiration).not.toHaveBeenCalled();
  await act(async()=>button('Keep private').click());expect(updateInspiration).not.toHaveBeenCalled();
  expect(button('private').getAttribute('aria-pressed')).toBe('true');
  await act(async()=>button('public').click());
  vi.mocked(updateInspiration).mockResolvedValue({} as Awaited<ReturnType<typeof updateInspiration>>);
  await act(async()=>button('Make public').click());
  expect(updateInspiration).toHaveBeenCalledExactlyOnceWith('older',{visibility:'public'});
  expect(button('public').getAttribute('aria-pressed')).toBe('true');
  expect(world.container.querySelector('.jar-panel .jar-audience-note')).toBeNull();
});

it('records opening Capture before the observer debounce and keeps it through later restoration',async()=>{
  world=await mountWorld(FACTS,{routerTools:<RouterTools/>});await settle();
  const capture=[...world.container.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent?.trim()==='Capture inspiration');
  expect(capture).toBeDefined();await act(async()=>capture!.click());
  expect(location.search).toContain('compose=1');
  await world.rerender();await settle();
  expect(world.container.querySelector('[role="dialog"][aria-label="Capture inspiration"]')).not.toBeNull();
  await navigate(-1);expect(location.search).not.toContain('compose=1');
});

it('does not let the returning-visitor greeting replace an explicitly linked reflection', async()=>{
  localStorage.setItem('waka.seen','1');
  world=await mountWorld(FACTS,{initialEntries:['/inspirations/older?reflection=answer-1'],routerTools:<RouterTools/>});
  await settle(); await act(async()=>{await vi.advanceTimersByTimeAsync(5000);}); await settle();
  expect(location.search).toContain('inspiration=older');
  expect(world.container.textContent).toContain('My earlier words');
});
it('records explicit reflection opening immediately, before the world observer debounce', async()=>{
  world=await mountWorld(FACTS,{initialEntries:['/inspirations/older'],routerTools:<RouterTools/>}); await settle();
  const open=[...world.container.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent==='read reflection')!;
  expect(open).toBeDefined(); await act(async()=>open.click());
  expect(location.search).toContain('reflection=open');
});
it('a greeting cannot close its own selected card after the person starts interacting with it', async()=>{
  localStorage.setItem('waka.seen','1');
  vi.mocked(loadInspiration).mockResolvedValue({...detail,id:'loaded'});
  world=await mountWorld(FACTS,{routerTools:<RouterTools/>}); await settle();
  await act(async()=>{await vi.advanceTimersByTimeAsync(1500);}); await settle();
  const panel=world.container.querySelector('[aria-label="a saved inspiration"]'); expect(panel).not.toBeNull();
  await act(async()=>panel!.dispatchEvent(new Event('pointerdown',{bubbles:true})));
  await act(async()=>{await vi.advanceTimersByTimeAsync(4000);}); await settle();
  expect(world.container.querySelector('[aria-label="a saved inspiration"]')).not.toBeNull();
  expect(location.search).toContain('inspiration=loaded');
});

it('restores an older card, its earlier reflection and date across Back/Forward without booting again', async () => {
  world = await mountWorld(FACTS, { routerTools: <RouterTools /> }); await settle();
  const date = 1780000000000;
  await navigate(`/?view=field&at=${date}&inspiration=older&reflection=answer-1`);
  expect(world.container.textContent).toContain(detail.text);
  expect(world.container.querySelector('.jar-reading-heading')?.textContent).toContain('Earlier reading');
  expect(world.container.querySelector<HTMLDetailsElement>('.jar-reflection-turns')?.open).toBe(true);
  expect(loadInspiration).toHaveBeenCalledWith('older', VIEWER_ID, expect.any(AbortSignal));
  await navigate('/w/group-id/old-name?view=sky');
  expect(world.audit().wallId).toBe('group-id'); expect(world.container.querySelector('.jar-here')?.textContent).toContain('Renamed room');
  await navigate(-1);
  expect(location.search).toContain(`at=${date}`); expect(world.container.textContent).toContain('My earlier words');
  expect(world.audit().wallKind).toBe('self');
  await navigate(1); expect(world.audit().wallId).toBe('group-id');
  expect(loadInspirations).toHaveBeenCalledOnce();
});
it('cold opens an older inspiration link without needing its orb in the initial field', async () => {
  world = await mountWorld(FACTS, { initialEntries: ['/inspirations/older?reflection=answer-1'], routerTools: <RouterTools /> });
  await settle(); expect(world.container.textContent).toContain(detail.text);
  expect(world.container.querySelector<HTMLDetailsElement>('.jar-reflection-turns')?.open).toBe(true);
  expect(world.audit().present).toBe(1); expect(location.search).toContain('reflection=answer-1');
});
it('restores reflection on the same inspiration across Back/Forward, without changing the card identity', async () => {
  world = await mountWorld(FACTS, { initialEntries: ['/inspirations/older'], routerTools: <RouterTools /> }); await settle();
  await navigate('/inspirations/older?reflection=answer-1');
  expect(world.container.textContent).toContain('My earlier words');
  await navigate(-1); expect(world.container.querySelector('.jar-reflection-flow')).toBeNull();
  await navigate(1); expect(world.container.querySelector<HTMLDetailsElement>('.jar-reflection-turns')?.open).toBe(true);
  expect(location.search).toContain('reflection=answer-1');
});
it('records actual world travel as a new history entry instead of replacing the previous ground', async () => {
  world = await mountWorld(FACTS, { routerTools: <RouterTools /> }); await settle();
  await world.toField(); await settle(); expect(location.search).toContain('view=field');
  await world.travelTo(/Renamed room/i); await settle(); expect(location.pathname).toContain('/w/group-id/');
  await navigate(-1); expect(world.audit().wallKind).toBe('self'); expect(location.search).toContain('view=field');
});
it('discards a late detail when the person navigates elsewhere', async () => {
  let resolve!: (value: InspirationDetail) => void;
  vi.mocked(loadInspiration).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  world = await mountWorld(FACTS, { routerTools: <RouterTools /> }); await settle();
  await navigate('/inspirations/older'); await navigate('/w/group-id/renamed-room');
  await act(async () => resolve(detail)); await settle();
  expect(world.audit().wallId).toBe('group-id'); expect(world.container.textContent).not.toContain(detail.text);
});
it('shows an unavailable link without silently opening another room and can return home', async () => {
  world = await mountWorld(FACTS, { initialEntries: ['/w/missing-id/old-name'], routerTools: <RouterTools /> }); await settle();
  expect(world.container.querySelector('[role="alert"]')?.textContent).toContain('isn’t available to this account');
  expect(world.container.querySelector('[role="alert"]')?.textContent).not.toContain('Try again');
  await act(async () => [...world.container.querySelectorAll<HTMLButtonElement>('.jar-navigation-notice button')].find(button => button.textContent === 'Me')!.click()); await settle();
  expect(world.container.querySelector('.jar-navigation-notice')).toBeNull(); expect(world.audit().wallKind).toBe('self');
});
