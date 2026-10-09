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
import { mountWorld, dataMockFrom, apiMockFrom, chooseFromMenu, keepBox, VIEWER_ID, type MountedWorld } from './helpers/render-home';
import { loadInspirations, loadInspiration, type InspirationDetail } from '../src/lib/data';
import {fetchPrinciples,updatePrinciple,updateInspiration,type ApiPrinciple} from '../src/lib/api';

const FACTS = vi.hoisted(() => ({ inspirations: [{ id: 'loaded', text: 'Current inspiration', daysAgo: 1 }],
  groups: [{ id: 'group-id', name: 'Renamed room', field: [] }] }));
const principleState=vi.hoisted(()=>({rows:[] as ApiPrinciple[]}));
vi.mock('../src/lib/api/principles',async original=>({...await original<typeof import('../src/lib/api/principles')>(),fetchPrincipleRead:vi.fn(async()=>({principles:principleState.rows,status:{phase:'ready',eligible:false}}))}));
vi.mock('../src/lib/data', async (original) => ({ ...await original<typeof import('../src/lib/data')>(),
  ...dataMockFrom(FACTS), loadInspirations: vi.fn(dataMockFrom(FACTS).loadInspirations), loadInspiration: vi.fn() }));
vi.mock('../src/lib/api', async (original) => ({ ...await original<typeof import('../src/lib/api')>(), ...apiMockFrom(FACTS),fetchPrinciples:vi.fn(async()=>principleState.rows),updatePrinciple:vi.fn(),updateInspiration:vi.fn() }));
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
beforeEach(() => { principleState.rows=[];vi.mocked(updatePrinciple).mockReset();vi.mocked(fetchPrinciples).mockClear();localStorage.clear(); vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); vi.mocked(loadInspirations).mockClear(); vi.mocked(loadInspiration).mockReset().mockResolvedValue(detail); });
afterEach(() => { world?.unmount(); vi.useRealTimers(); });
async function settle() {
  for (let turn = 0; turn < 8; turn += 1) { await world.step(100); await act(async () => { await vi.advanceTimersByTimeAsync(100); }); }
}
async function navigate(to: string | number) { await act(async () => { if (typeof to === 'number') go(to); else go(to); }); await settle(); }

it('keeps named personal destinations available and records section navigation for Back',async()=>{
  world=await mountWorld(FACTS,{routerTools:<RouterTools/>});await settle();
  /* The archive and the principles are PAGES now, not positions on a vertical
     axis the camera travelled. So the thing to check is that each destination
     has a real address and that Back walks them — which is the capability the
     old `view=field` / `view=sky` query params were standing in for. */
  await chooseFromMenu(world.container,'Your inspirations');await settle();
  expect(location.pathname).toBe('/inspirations');
  await chooseFromMenu(world.container,'Principles');await settle();
  expect(location.pathname).toBe('/principles');
  await navigate(-1);expect(location.pathname).toBe('/inspirations');
  /* Find left the menu entirely: it is a thing you do TO your inspirations,
     so it is a search field on that page now rather than a destination. The
     menu holds places; it held one verb, and that was the odd one out. */
  await chooseFromMenu(world.container,'Top of mind');await settle();
  expect(location.pathname).toBe('/');
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
  /* The view is named ONCE, by the switcher at the top of the screen. It was
     printed again in the reading's own heading sixty pixels below it, which
     is the duplication the switcher replaced — so the name is asserted where
     it now lives. */
  expect(world.container.querySelector('.waka-switch-trigger')?.textContent).toContain('Top of mind');
  /* Review is not offered any more. It was an activity card beside the
     character, then a menu row, and it is now merged away: Claims is the one
     place that asks a person to rule on their own material, and two surfaces
     for "go back through what you kept" was the duplication the menu was cut
     to remove. The route still works for anything already holding a link —
     what went is the offer. */
  expect(world.container.querySelector('.jar-reading-actions')?.textContent).not.toContain('Review your inspirations');
  await navigate('/review/new');await settle();expect(location.pathname).toBe('/review/new');
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

it('keeps what you typed in the box across a re-render, without opening anything',async()=>{
  /* KEEPING IS INLINE NOW (founder ruling: "it shouldn't open up a modal, it
     should just let the user do it right there"). So there is no `compose=1`
     to record and no dialog to find — the thing worth proving is that the
     words stay in the box, which is the whole promise of typing in place. */
  world=await mountWorld(FACTS,{routerTools:<RouterTools/>});await settle();
  const capture=keepBox(world.container);
  await act(async()=>{
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(capture,'An unfinished spark');
    capture.dispatchEvent(new Event('input',{bubbles:true}));
  });
  expect(world.container.querySelector('[role="dialog"][aria-label="Capture inspiration"]')).toBeNull();
  expect(location.search).not.toContain('compose=1');
  await world.rerender();await settle();
  expect(keepBox(world.container).value).toBe('An unfinished spark');
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
