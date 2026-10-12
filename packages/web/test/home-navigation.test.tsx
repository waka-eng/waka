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
import { mountWorld, dataMockFrom, apiMockFrom, chooseFromMenu, pressChatCorner, closeOverlay, keepBox, VIEWER_ID, type MountedWorld } from './helpers/render-home';
import { loadInspirations, loadInspiration, type InspirationDetail } from '../src/lib/data';
import {fetchGroupMembers,fetchPrinciples,updatePrinciple,updateInspiration,type ApiPrinciple} from '../src/lib/api';

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

/**
 * THE THREE NAVIGATION COMPLAINTS, AS INVARIANTS.
 *
 * Founder, after walking the product: "for your inspirations, after I click
 * on it, I feel like I'm lost how to go back to the previous screen, and I
 * didn't realise clicking on top of mind would leave me there... I go to my
 * agent and then now I have no way to get back to my top of mind without
 * going to my agent's top of mind."
 *
 * Three reports with one cause: reaching your own material UNMOUNTED THE
 * WORLD. The previous shape of this suite asserted the opposite — that each
 * of the three had its own pathname — because at the time that was the fix
 * being shipped. Having a real address was not enough and the founder's three
 * sentences are why: an address replaces the world, and once the world is
 * gone there is nothing to return to, only somewhere else to navigate.
 *
 * So what is checked here is the thing being promised now, and each
 * expectation below is one of the three sentences made mechanical.
 */
it('opens your own material over a world that never leaves, and the world is one press back',async()=>{
  world=await mountWorld(FACTS,{routerTools:<RouterTools/>});await settle();

  /* ONE — THE PATHNAME DOES NOT MOVE. This is the whole fix in one
     assertion: an overlay is a parameter on the world's own address, so the
     world is never unmounted and the camera never forgets where it was. If
     this ever reads '/inspirations' again, "I'm lost how to go back" is back
     with it. */
  await chooseFromMenu(world.container,'Inspirations');await settle();
  expect(location.pathname).toBe('/');
  expect(new URLSearchParams(location.search).get('open')).toBe('saves');

  /* TWO — YOUR TOP OF MIND IS A CLOSE, NOT A TRIP. It is the world itself,
     so its row puts down whatever is held up rather than navigating. That is
     why pressing it can no longer strand you — "I didn't realise clicking on
     top of mind would leave me there" is now impossible rather than merely
     fixed. */
  await chooseFromMenu(world.container,'Now');await settle();
  expect(location.pathname).toBe('/');
  expect(new URLSearchParams(location.search).get('open')).toBeNull();

  await chooseFromMenu(world.container,'Principles');await settle();
  expect(new URLSearchParams(location.search).get('open')).toBe('principles');

  /* THREE — AND THE VISIBLE WAY OUT STILL WORKS. Escape and the scrim do
     too; the founder got lost on a surface whose every exit was invisible,
     so the seen one is the one under test. */
  await closeOverlay(world.container);await settle();
  expect(new URLSearchParams(location.search).get('open')).toBeNull();

  /* FOUR — CONVERSATIONS ARE THE CORNER'S, in one press. They are a history
     rather than a depth of your own material, which is why they are not in
     the three above. */
  await pressChatCorner(world.container);await settle();
  expect(new URLSearchParams(location.search).get('open')).toBe('conversations');
});

it('offers places in the dock, and nothing that is already on the screen',async()=>{
  /* THE FOUR RUNGS ACROSS THE TOP ARE GONE. Founder: "have a bottom navbar."
     Two of those four named rooms a person is already standing in — claims
     are the note the creature holds up, and saves are moving onto the home
     screen under it — and a door to a room you are in is not navigation.

     WHAT THIS CASE PROTECTS is that the dock holds PLACES. `Your claims` must
     never come back to it, because the claim lives on home now and a second
     entrance is the duplication this product has already paid for once.
     "HOME" IS NOT A PLACE IN THIS PRODUCT (founder: "I don't like the word
     'home'"). It is `Now` — which is what that screen is, and what the world
     already calls it everywhere underneath: `atNow`, the present wall, the
     dial's end. Four nouns rather than three nouns and a piece of app
     furniture.

     AND A FIFTH CONTROL THAT IS NOT A PLACE. The plus is the one verb on the
     bar; it is drawn rather than written and carries its name only in
     `aria-label`, which is why this reads the accessible name. It must stay
     unnamed-by-text and unlit: a verb that lights like a destination would
     say you were standing somewhere. */
  world=await mountWorld(FACTS,{routerTools:<RouterTools/>});await settle();
  const dock=[...world.container.querySelectorAll('.waka-dock .waka-dock-item')];
  const rows=dock.map(node=>(node.textContent?.trim()||node.getAttribute('aria-label')?.trim())??'');
  /* "CHATS", NOT "CONVERSATIONS" — founder: "change conversation to chat in
     bottom navigation as well". A dock row is read in a glance and in a
     thumb's width; the longer word was the longest thing on the bar and the
     one nobody calls it out loud. */
  expect(rows).toEqual(['Now','Inspirations','Make something','Chats','Principles']);
  expect(dock[2]!.textContent?.trim(),'the plus is drawn, not written').toBe('');
  expect(dock[2]!.getAttribute('aria-current'),'a verb is never a place you are at').toBeNull();
  expect(rows,'a claim is answered on home; the dock must not offer a second way in').not.toContain('Claims');
});

/* THE CLAIMS ROOM HAS NO DOOR IN THE DOCK, AND THAT IS THE POINT. This case
   pressed a `Your claims` rung and asserted the address. Founder: "the main
   screen should be just the character and then the claim should always show
   there. Because that's like the first thing that the user should answer."
   So a claim is on the home screen, in the note the creature holds up, and a
   dock row leading to a second copy of it is the duplication this product
   already removed once — see `ClaimsOverlay`'s header. The case above now
   asserts the row's ABSENCE instead, which is the thing worth protecting.
   The room itself is still reachable at `?open=claims` and still tested. */

/* ═══ MERGE NOTE, `origin/dev` 8b11c2f5 ════════════════════════════════════
   Five of that commit's six new cases are kept verbatim below. THE SIXTH IS
   DELETED AND REPLACED, and this is the one judgement call in this file.

   It read:

     it('allows moving above and below Home without using the tab bar, with
         Back restoring each place')
       expect(container.querySelector('.jar-values')).not.toBeNull();
       expect(container.querySelector('.jar-saved--personal')).not.toBeNull();
       await click('.jar-values');   -> view=sky
       await click('.jar-saved--personal'); -> view=field

   Both of those controls were deleted on this branch, with reasons recorded
   at their old sites in `Home.tsx`: the Principles pill and the
   "N inspirations" door were self-wall-only chrome, and the dock now carries
   both destinations on every wall. A case that presses them is asserting
   chrome, not behaviour.

   What dev's case was PROTECTING, though, is real and this branch had broken
   it: once you are above or below Home there must be a one-press way back,
   and until 8b11c2f5 the carets were gated `atWall.kind!=="self"` — so on
   your own wall the sky and the ground had no visible exit at all. Those
   states are reachable here: a search result writes `section:'field'`, and
   opening a principle from `PrinciplesOverlay` writes `section:'sky'`. The
   replacement below enters each of them the way the product does and presses
   the caret dev unlocked. Law 2, with the entrance updated. */
it('keeps a one-press way out of the sky and of the ground on your own wall',async()=>{
  world=await mountWorld(FACTS,{initialEntries:['/?view=sky'],routerTools:<RouterTools/>});await settle();
  const caret=(selector:string)=>world.container.querySelector<HTMLButtonElement>(selector);
  expect(caret('.jar-up--down.jar-up--personal'),'the sky on your own wall must offer the way down').not.toBeNull();
  await act(async()=>caret('.jar-up--down')!.click());await settle();
  expect(location.pathname+location.search).toBe('/');
  await navigate(-1);expect(location.search).toContain('view=sky');
  world.unmount();
  world=await mountWorld(FACTS,{initialEntries:['/?view=field'],routerTools:<RouterTools/>});await settle();
  expect(caret('.jar-up:not(.jar-up--down)'),'the ground must offer the way up').not.toBeNull();
  await act(async()=>caret('.jar-up:not(.jar-up--down)')!.click());await settle();
  expect(location.pathname+location.search).toBe('/');
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
  const editor=world.container.querySelector<HTMLTextAreaElement>('[aria-label="This principle in your own words"]')!;
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(editor,'Leave unhurried time for thought.');editor.dispatchEvent(new Event('input',{bubbles:true}));});
  await act(async()=>[...world.container.querySelectorAll<HTMLButtonElement>('.jar-principles-list--personal button')].find(button=>button.textContent==='Save')!.click());await settle();
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
  expect([...world.container.querySelectorAll('.waka-dock .waka-dock-item--here')].map(n=>n.textContent?.trim()))
    .toEqual(['Now']);
  /* Review is not offered any more. It was an activity card beside the
     character, then a menu row, and it is now merged away: Claims is the one
     place that asks a person to rule on their own material, and two surfaces
     for "go back through what you kept" was the duplication the menu was cut
     to remove. The route still works for anything already holding a link —
     what went is the offer. */
  expect(world.container.querySelector('.jar-reading-actions')?.textContent).not.toContain('Review your inspirations');
  await navigate('/review/new');await settle();expect(location.pathname).toBe('/review/new');
  /* `origin/dev` 8b11c2f5 renamed this button's label from "Review your
     inspirations" to "Revisit your inspirations" and asserted it inside
     `.jar-home-activities`. Both the component and the label are gone — the
     fold took `HomeActivities`, `useReviewEntry` and the whole review
     surface — so there is nothing left to relabel, and dev's wording change
     to `worldReviewTitle` landed on a key this branch had already deleted.
     The route is still reached below, which is the part that still exists. */
  await navigate(-1);expect(location.pathname).toBe('/');
});
it('requires a visible audience confirmation before publishing and leaves cancel private',async()=>{
  vi.mocked(updateInspiration).mockClear();
  world=await mountWorld(FACTS,{initialEntries:['/inspirations/older'],routerTools:<RouterTools/>});await settle();
  expect(world.container.querySelector<HTMLElement>('.jar-personal-shortcuts')?.hidden).toBe(true);
  const button=(label:string)=>[...world.container.querySelectorAll<HTMLButtonElement>('.jar-panel button')].find(item=>item.textContent?.trim()===label)!;
  expect(world.container.querySelector('.jar-panel .jar-audience-note')).toBeNull();
  expect(button('Private').getAttribute('title')).toBeNull();
  expect(button('Public').getAttribute('title')).toBeNull();
  await act(async()=>button('Public').click());
  expect(world.container.textContent).toContain('People in your rooms can read it and its attachments');
  expect(updateInspiration).not.toHaveBeenCalled();
  await act(async()=>button('Keep private').click());expect(updateInspiration).not.toHaveBeenCalled();
  expect(button('Private').getAttribute('aria-pressed')).toBe('true');
  await act(async()=>button('Public').click());
  vi.mocked(updateInspiration).mockResolvedValue({} as Awaited<ReturnType<typeof updateInspiration>>);
  await act(async()=>button('Make public').click());
  expect(updateInspiration).toHaveBeenCalledExactlyOnceWith('older',{visibility:'public'});
  expect(button('Public').getAttribute('aria-pressed')).toBe('true');
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
  const open=[...world.container.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent==='Read reflection')!;
  expect(open).toBeDefined(); await act(async()=>open.click());
  expect(location.search).toContain('reflection=open');
});
it('a greeting cannot close its own selected card after the person starts interacting with it', async()=>{
  localStorage.setItem('waka.seen','1');
  vi.mocked(loadInspiration).mockResolvedValue({...detail,id:'loaded'});
  world=await mountWorld(FACTS,{routerTools:<RouterTools/>}); await settle();
  await act(async()=>{await vi.advanceTimersByTimeAsync(1500);}); await settle();
  const panel=world.container.querySelector('[aria-label="A saved inspiration"]'); expect(panel).not.toBeNull();
  await act(async()=>panel!.dispatchEvent(new Event('pointerdown',{bubbles:true})));
  await act(async()=>{await vi.advanceTimersByTimeAsync(4000);}); await settle();
  expect(world.container.querySelector('[aria-label="A saved inspiration"]')).not.toBeNull();
  expect(location.search).toContain('inspiration=loaded');
});

it('restores an older card, its earlier reflection and date across Back/Forward without booting again', async () => {
  world = await mountWorld(FACTS, { routerTools: <RouterTools /> }); await settle();
  const date = 1780000000000;
  await navigate(`/?view=field&at=${date}&inspiration=older&reflection=answer-1`);
  expect(world.container.textContent).toContain(detail.text);
  expect(world.container.querySelector('.jar-reading-heading')?.textContent).toContain('Earlier reading');
  /* `[data-reflection-id]`, WHERE THIS READ `.jar-reflection-turns` + `.open`
     (2026-10-10). `ReflectionFlow` kept earlier answers inside a collapsed
     `<details>` and opened it when the address named one; the flow is folded
     and the save's panel now renders its answers plainly, so there is no
     `<details>` left to be open. The invariant is the one that mattered and
     is now asserted directly: a cold or restored `?reflection=<id>` link puts
     THAT answer on screen, identified by its own id rather than by a
     disclosure's state. */
  expect(world.container.querySelector('[data-reflection-id="answer-1"]')?.textContent).toContain('My earlier words');
  expect(loadInspiration).toHaveBeenCalledWith('older', VIEWER_ID, expect.any(AbortSignal));
  await navigate('/w/group-id/old-name?view=sky');
  /* THE CORNER NO LONGER NAMES A ROOM. It is a two-state switch — me, my
     agent — because those are the two places the product currently holds, so
     a room's name has nowhere to render there until rooms come back.
     What this line was really protecting survives and is still asserted: the
     URL carries a STALE slug (`old-name`) and the world still resolves it to
     the right wall rather than trusting the words in the address. */
  expect(world.audit().wallId).toBe('group-id');
  await navigate(-1);
  expect(location.search).toContain(`at=${date}`); expect(world.container.textContent).toContain('My earlier words');
  expect(world.audit().wallKind).toBe('self');
  await navigate(1); expect(world.audit().wallId).toBe('group-id');
  expect(loadInspirations).toHaveBeenCalledOnce();
});
it('cold opens an older inspiration link without needing its orb in the initial field', async () => {
  world = await mountWorld(FACTS, { initialEntries: ['/inspirations/older?reflection=answer-1'], routerTools: <RouterTools /> });
  await settle(); expect(world.container.textContent).toContain(detail.text);
  expect(world.container.querySelector('[data-reflection-id="answer-1"]')?.textContent).toContain('My earlier words');
  expect(world.audit().present).toBe(1); expect(location.search).toContain('reflection=answer-1');
});
it('restores reflection on the same inspiration across Back/Forward, without changing the card identity', async () => {
  world = await mountWorld(FACTS, { initialEntries: ['/inspirations/older'], routerTools: <RouterTools /> }); await settle();
  await navigate('/inspirations/older?reflection=answer-1');
  expect(world.container.textContent).toContain('My earlier words');
  await navigate(-1); expect(world.container.querySelector('.jar-reflection-flow')).toBeNull();
  await navigate(1); expect(world.container.querySelector('[data-reflection-id="answer-1"]')?.textContent).toContain('My earlier words');
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

/**
 * THE CREATURE CHANGES FORM WHERE IT STANDS.
 *
 * Founder: "I kind of want to give the feeling of like rather than my agent
 * like moving rooms it kind of like switching itself up to its agent form."
 * And, in three separate messages: "the agent the character shouldn't move
 * left It should move right."
 *
 * Those read as two requests and are one. The second was taken literally for
 * a long time — move the agent to the other side of the axis — and the axis
 * is the wrong place: agents sit at negative columns and rooms at positive,
 * so swapping them moves rooms for a reason that has nothing to do with
 * rooms. Measured on a quiet tree it costs twenty-four room-suite failures,
 * and the first attempt at it was abandoned on a failure count nobody had
 * attributed.
 *
 * The direction only matters because there is a glide to have a direction.
 * So the form switch arrives WITHOUT a crossing, and nothing slides either
 * way. This asserts the absence of travel, because that is the whole fix and
 * it is invisible in a screenshot — a glide that still happens would look
 * identical one frame before and one frame after.
 */
it('changes form in place instead of travelling to the agent', async () => {
  world = await mountWorld(FACTS, {routerTools: <RouterTools/>}); await settle();
  expect(world.audit().wallKind).toBe('self');

  const face = (label: string) =>
    [...world.container.querySelectorAll<HTMLButtonElement>('.jar-char-face')]
      .find(button => button.textContent?.trim() === label);
  const toAgent = face('My agent');
  expect(toAgent, 'the creature offers no way to take its agent form').toBeTruthy();

  /* ONE FRAME. `step(0)` advances the world without letting a crossing run,
     so arriving here means there was never a crossing to run. A glide would
     still be mid-flight on the column it started from. */
  await act(async () => toAgent!.click());
  await world.step(0);
  expect(world.audit().wallKind, 'the form switch is still flying the camera').toBe('agent');

  /* AND BACK, in the same single frame — the complaint was asymmetric
     ("no way to get back to my top of mind"), so the return is checked too. */
  const toMe = face('Me');
  expect(toMe).toBeTruthy();
  await act(async () => toMe!.click());
  await world.step(0);
  expect(world.audit().wallKind).toBe('self');
});

/**
 * THE CONVERSATION'S X ACTUALLY CLOSES IT.
 *
 * Founder: "x button doesnt work to close modal."
 *
 * It did not. The conversation reuses the overlay shell but not its address —
 * the other three surfaces set `open`, a conversation sets `conversationId` —
 * and its close was wired to `closeOpen`, which begins `if(!before?.open)
 * return`. The press ran and returned. Rendered, labelled, enabled, silent.
 *
 * So this presses the X and asserts the ADDRESS, not the markup. A test that
 * checked the button was on screen would have passed throughout.
 *
 * IT OPENS THE CONVERSATION THROUGH THE DOCK NOW. It used to press a "New
 * chat" pill at the top of the chats list, which is gone: that pill was the
 * only boxed control on any of the four destinations and the dock's plus
 * already offers the same two verbs from everywhere. Pressing the door that
 * exists is also the more honest setup — a test that reaches a surface by a
 * control nobody else can reach it by proves the surface works and not that
 * anyone can get to it.
 */
async function openANewChat(root: HTMLElement) {
  await act(async () => root.querySelector<HTMLButtonElement>('.waka-dock-item--new')!.click());
  await settle();
  const rows = [...root.querySelectorAll<HTMLButtonElement>('.waka-new-one')];
  const chat = rows.at(-1);
  expect(chat, 'the plus offers no way to start a chat').toBeTruthy();
  await act(async () => chat!.click());
  await settle();
}

it('closes a conversation from its own X, which the overlay handler could not', async () => {
  world = await mountWorld(FACTS, {routerTools: <RouterTools/>}); await settle();
  await openANewChat(world.container);
  expect(location.pathname.startsWith('/chat/'), 'the conversation never opened').toBe(true);

  /* THE X IS GONE FROM EVERY DESTINATION. Founder: "how do we even need the
     close button for inspiration and chat? There's no reason for there to be
     an X button when we're just moving across the pages." So what this
     presses is the control that replaced it — the dock's own first row,
     which is visible the whole time a conversation is open and is the way
     out the law is actually satisfied by. The assertion is unchanged: an
     address, not a rendered button. */
  const now = [...world.container.querySelectorAll<HTMLButtonElement>('.waka-dock-item')][0];
  expect(now, 'the bar a conversation leans on for its way out is not there').toBeTruthy();
  await act(async () => now!.click()); await settle();
  expect(location.pathname, 'the dock still does nothing from a conversation').not.toContain('/chat/');
});

/**
 * AND IT STEPS BACK TO THE LIST, which is the other half of the way out.
 *
 * Founder: "chat and inspirations should have same look and feel and
 * workflow and experience." An open inspiration had a chevron reading "All
 * inspirations" AND a ✕ AND a "Close"; an open chat had only the ✕, and the
 * ✕ leaves for the world rather than for the chats it came from. So the one
 * surface in the product with no step back was the one the founder has
 * reported being lost in most.
 *
 * Pressed, not counted — `six-laws.md` Law 8: the previous one-press return
 * in this product rendered, read correctly, was enabled, and did nothing.
 */
it('steps back from a conversation to the list of them', async () => {
  world = await mountWorld(FACTS, {routerTools: <RouterTools/>}); await settle();
  await openANewChat(world.container);
  expect(location.pathname.startsWith('/chat/'), 'the conversation never opened').toBe(true);

  const back = world.container.querySelector<HTMLButtonElement>('.waka-over--talk .waka-over-back');
  expect(back, 'a conversation offers no way back to its own list').toBeTruthy();
  await act(async () => back!.click()); await settle();
  expect(location.pathname, 'it stayed in the conversation').not.toContain('/chat/');
  expect(
    new URLSearchParams(location.search).get('open'),
    'the step back did not land on the chats',
  ).toBe('conversations');
});

/**
 * THE DOCK STANDS ON AN OPEN CHAT, as it does on every other destination.
 *
 * It was hidden there and shown on all three peers — including an open
 * inspiration, which is the same depth of the same gesture — so reading one
 * conversation was the single state in the product with no bottom bar.
 */
it('keeps the dock standing while a conversation is open', async () => {
  world = await mountWorld(FACTS, {routerTools: <RouterTools/>}); await settle();
  await openANewChat(world.container);
  expect(
    world.container.querySelector('.waka-dock'),
    'the bottom bar goes missing on the one surface that most needs it',
  ).toBeTruthy();
});

/**
 * ═══ A COMMENT IS NOT COPY ═════════════════════════════════════════════
 *
 * Found on 2026-10-11, on every screen in the product at once: two block
 * comments sitting in JSX CHILD position rather than inside braces, so React
 * rendered them as text. Four hundred words of engineering prose — "the
 * Principles pill and Find", "git holds this until they do" — printed over
 * the world, in the product, to whoever opened it.
 *
 * They had been there since the commit that wrote them. Nobody saw it
 * because the destinations painted an opaque ground over the world and the
 * leak sat underneath; the moment a page became transparent so it could
 * stand on the world's own floor, four hundred words came up through it.
 * That is the worst shape a bug can have — harmless-looking for weeks, then
 * surfaced by an unrelated change, everywhere at once.
 *
 * WHY THIS IS A RUNTIME CHECK AND NOT A GREP. The first attempt read the
 * source for a comment opening a line in child position, and flagged twelve
 * ordinary code comments that happened to follow a line ending in a brace —
 * a gate nobody could keep green. The renderer knows the answer exactly: a
 * comment that reached the DOM is a text node with the marker in it. No
 * heuristic, no exemptions.
 *
 * It covers what this suite mounts, which is the world — both leaks were
 * there, and it is the file where a stray comment is most likely, being by
 * far the largest tree in the product.
 */
it('renders no engineering comment as text on screen', async () => {
  world = await mountWorld(FACTS, {routerTools: <RouterTools/>}); await settle();
  const leaked: string[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === 3) {
      const text = node.nodeValue ?? '';
      if (text.includes('/*') || text.includes('*/')) {
        const host = node.parentElement;
        leaked.push(`${host?.className || host?.tagName}: ${text.trim().slice(0, 70)}`);
      }
      return;
    }
    node.childNodes.forEach(walk);
  };
  walk(world.container);
  expect(
    leaked,
    'a block comment is in JSX child position, so React is printing it on ' +
      'screen. Wrap it in braces — `{/* … */}`. Two of these printed four ' +
      'hundred words over every surface in the product and went unnoticed ' +
      'for weeks because an opaque page happened to be covering them.\n',
  ).toEqual([]);
});
