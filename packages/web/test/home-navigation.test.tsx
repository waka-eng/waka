// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY (gate G6): `lib/data` supplies the three layers and
 * direct detail reads, `lib/api` supplies principle edits (it supplied the
 * group reads too, until rooms were removed on 2026-10-12),
 * `lib/api/principles` supplies principle reads, `lib/auth-context` supplies the
 * session. `helpers/render-home` and `helpers/canvas-stub` replace canvas/viewport/clock/randomness, but the real
 * world simulation and React Router history run. `helpers/note-top-row` replaces
 * nothing: it is a DOM query over the tree this suite rendered. Appearance/SQL are not claimed. */
import { act } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { installCanvasStub, setViewport } from './helpers/canvas-stub';
import { mountWorld, dataMockFrom, apiMockFrom, chooseFromMenu, pressChatCorner, closeOverlay, keepBox, barShape, VIEWER_ID, type MountedWorld } from './helpers/render-home';
import { pressesInTopRow } from './helpers/note-top-row';
import { loadInspirations, loadInspiration, type InspirationDetail } from '../src/lib/data';
import {fetchProfiles,fetchPrinciples,updatePrinciple,updateInspiration,type ApiPrinciple} from '../src/lib/api';

/* THE ROOM "Renamed room" IS GONE FROM THESE FACTS (founder, 2026-10-12: "방
   없애"). It held one memory of the viewer's and one of Bo's, and it was the
   second wall this file used for every Back/Forward-across-walls case as well
   as for the five member-navigation cases. There is no second wall a fixture
   can reach cheaply now: an agent's needs an agent roster and a bundle. */
const FACTS = vi.hoisted(() => ({ inspirations: [{ id: 'loaded', text: 'Current inspiration', daysAgo: 1 }] }));
const principleState=vi.hoisted(()=>({rows:[] as ApiPrinciple[]}));
vi.mock('../src/lib/api/principles',async original=>({...await original<typeof import('../src/lib/api/principles')>(),fetchPrincipleRead:vi.fn(async()=>({principles:principleState.rows,status:{phase:'ready',eligible:false}}))}));
vi.mock('../src/lib/data', async (original) => ({ ...await original<typeof import('../src/lib/data')>(),
  ...dataMockFrom(FACTS), loadInspirations: vi.fn(dataMockFrom(FACTS).loadInspirations), loadInspiration: vi.fn() }));
vi.mock('../src/lib/api', async (original) => ({ ...await original<typeof import('../src/lib/api')>(), ...apiMockFrom(FACTS),fetchProfiles:vi.fn(async()=>[]),fetchPrinciples:vi.fn(async()=>principleState.rows),updatePrinciple:vi.fn(),updateInspiration:vi.fn() }));
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
beforeEach(() => { vi.mocked(fetchProfiles).mockReset().mockResolvedValue([]); principleState.rows=[];vi.mocked(updatePrinciple).mockReset();vi.mocked(fetchPrinciples).mockClear();localStorage.clear(); vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); vi.mocked(loadInspirations).mockClear(); vi.mocked(loadInspiration).mockReset().mockResolvedValue(detail); });
afterEach(() => { world?.unmount(); vi.useRealTimers(); });
async function settle() {
  for (let turn = 0; turn < 8; turn += 1) { await world.step(100); await act(async () => { await vi.advanceTimersByTimeAsync(100); }); }
}
async function navigate(to: string | number) { await act(async () => { if (typeof to === 'number') go(to); else go(to); }); await settle(); }

it('opens both histories directly from home and returns home without creating a draft or chat', async () => {
  world=await mountWorld(FACTS,{routerTools:<RouterTools/>});await settle();
  for (const [label, destination] of [['Inspirations', 'saves'], ['Chats', 'conversations']]) {
    const button=[...world.container.querySelectorAll<HTMLButtonElement>('.waka-dock button')].find(node=>node.textContent?.trim()===label)!;
    await act(async()=>button.click());await settle();
    expect(new URLSearchParams(location.search).get('open')).toBe(destination);
    expect(new URLSearchParams(location.search).get('compose')).toBeNull();
    expect(location.pathname).toBe('/');
    expect(world.container.querySelector('textarea.jar-composer-text')).toBeNull();
    for (const selector of ['.jar-hq', '.jar-mouth']) {
      expect(world.container.querySelector(selector)?.hasAttribute('inert')).toBe(true);
      expect(world.container.querySelector(selector)?.getAttribute('aria-hidden')).toBe('true');
    }
    expect(world.container.querySelector('.waka-primary-navigation')?.closest('[inert]')).toBeNull();
    expect(world.container.querySelector('.waka-page-back')).toBeNull();
    const list = world.container.querySelector<HTMLDivElement>('.waka-over')!;
    await act(async () => { list.scrollTop = 300; list.dispatchEvent(new Event('scroll')); button.click(); });
    expect(list.scrollTop).toBe(0);
    expect(new URLSearchParams(location.search).get('open')).toBe(destination);
    const back=[...world.container.querySelectorAll<HTMLButtonElement>('.waka-dock button')].find(button=>button.textContent?.trim()==='Home')!;
    await act(async()=>back.click());await settle();
    expect(new URLSearchParams(location.search).get('open')).toBeNull();
    expect(new URLSearchParams(location.search).get('compose')).toBeNull();
    expect(world.container.querySelector('.jar-mouth')?.hasAttribute('inert')).toBe(false);
    expect(location.pathname).toBe('/');
  }
});

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

/* Audit f2afcbe2: the first Tab stops landed on a "Details" button inside the
   height-zero band, with nothing on screen to show where focus went. */
it('takes the collapsed band out of focus order while it yields to the creature',async()=>{
  world=await mountWorld(FACTS,{routerTools:<RouterTools/>});await settle();
  const yielded=[...world.container.querySelectorAll<HTMLElement>('.jar-hq-inner--yielded')];
  expect(yielded.length).toBeGreaterThan(0);
  for(const band of yielded){expect(band.hasAttribute('inert')).toBe(true);expect(band.getAttribute('aria-hidden')).toBe('true');}
  for(const band of world.container.querySelectorAll<HTMLElement>('.jar-hq-inner:not(.jar-hq-inner--yielded)'))expect(band.hasAttribute('inert')).toBe(false);
});

/* Audit f2afcbe2: from Now, the sky's principle rows (above the frame) were
   the first three Tab stops. */
it('keeps the sky out of reach until you stand in it',async()=>{
  world=await mountWorld(FACTS,{routerTools:<RouterTools/>});await settle();
  const own=()=>world.container.querySelector<HTMLElement>('.jar-values-room--live');
  expect(own()?.hasAttribute('inert')).toBe(true);
  world.unmount();
  world=await mountWorld(FACTS,{initialEntries:['/?view=sky'],routerTools:<RouterTools/>});await settle();
  expect(own()?.hasAttribute('inert')).toBe(false);
});

/* Review: `inSky` waits for half-way up, so a sky already partly on screen was
   unreachable. Reachable the moment ANY of it is in frame. */
it('makes the sky reachable as soon as any of it is in frame, before half-way',async()=>{
  world=await mountWorld(FACTS,{routerTools:<RouterTools/>});await settle();
  const own=()=>world.container.querySelector<HTMLElement>('.jar-values-room--live');
  const sim=(window as unknown as {wakaSim?:()=>{toSky():void}|null}).wakaSim!()!;
  await act(async()=>sim.toSky());
  let checked=false;
  for(let frame=0;frame<120&&!checked;frame+=1){
    await world.step(1);
    const {camY}=world.audit() as unknown as {camY:number};
    if(camY < -1 && camY > -300){ await act(async()=>{}); expect(own()?.hasAttribute('inert'),`camY ${camY}`).toBe(false); checked=true; }
  }
  expect(checked,'the camera never passed through a partly-shown sky').toBe(true);
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
     dial's end.

     TWO WORDS SINCE 2026-10-15. Founder: "at the bottom bar just keep
     inspiration and chat and clicking on it leads to new inspiration and new
     chat" — and "principle is sth user can only get by dragging". So Now,
     the plus and Principles all left the bar: the lit row pressed again is
     the way home, each word makes a new one, and Principles is walked to.
     Both words are written, not drawn, and on Now neither is lit — you are
     standing in neither. */
  world=await mountWorld(FACTS,{routerTools:<RouterTools/>});await settle();
  const dock=[...world.container.querySelectorAll('.waka-dock .waka-dock-item')];
  const rows=dock.map(node=>(node.textContent?.trim()||node.getAttribute('aria-label')?.trim())??'');
  expect(rows).toEqual(['Home', 'Inspirations', 'Chats']);
  expect(dock.map(node=>node.getAttribute('aria-current')),'on Now, the bar names nowhere you are standing').toEqual(['page',null,null]);
  expect(world.container.querySelector('.jar-char-principles')).toBeNull();
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
  expect(caret('.waka-page-back'),'the sky on your own wall must offer the way down').not.toBeNull();
  await act(async()=>caret('.waka-page-back')!.click());await settle();
  expect(location.search).toContain('open=principles');
  await act(async()=>caret('.waka-page-back')!.click());await settle();
  expect(location.pathname+location.search).toBe('/');
  await navigate(-1);expect(location.search).toContain('view=sky');
  world.unmount();
  world=await mountWorld(FACTS,{initialEntries:['/?view=field'],routerTools:<RouterTools/>});await settle();
  expect(caret('.jar-up:not(.jar-up--down)'),'the ground must offer the way up').not.toBeNull();
  await act(async()=>caret('.jar-up:not(.jar-up--down)')!.click());await settle();
  expect(location.pathname+location.search).toBe('/');
});
/* ═══ FIVE CASES ABOUT STANDING IN SOMEBODY ELSE'S GROUND ════════════════
   Founder, 2026-10-12: "방 없애" — remove rooms. All five are gone with the
   surfaces they drove, and they are named because each pinned a rule nothing
   else in the suite does:

     A GROUP AVATAR TAP OPENED THAT MEMBER'S PUBLIC VIEW, and Back returned
     to the room. It pressed a PAINTED avatar — a pointerdown on the canvas
     at the seat's own coordinates, read out of `audit().company` — which is
     the only test in this file that ever proved the loop's hit areas agree
     with where the figures are drawn.

     THE PAINTED ROOM ANSWERED BEFORE THE ROUTE OBSERVER CAUGHT UP: pressing
     a member wrote the address immediately rather than waiting for the
     debounced observer, so the ground switched on the press and not a frame
     later.

     A MEMBER WITH NOTHING PUBLIC GOT AN EXPLICIT EMPTY VIEW — "Sora. No
     public inspirations" — rather than an empty ground with no explanation,
     which is the same rule the rest of this product follows: an empty place
     you can stand in beats a door that refuses.

     THE MEMBER LIST KEPT SCROLLING AND ARROW SELECTION INSIDE ITSELF: a
     wheel over the band did not travel the world and did not write the
     address, and Arrow keys roved focus through the radios while actually
     switching the ground. That is the roving-focus standard this product
     holds radio groups to, and the band was the only radiogroup in the world
     layer.

     AND THE SAME VIEW OPENED BY NAME, surviving Back and Forward — the
     bookmarkable `?member=` half of `/w/:wall/:label`.

   `audit().ground`, `audit().company` and `MountedWorld.standIn` existed
   only for these. All three are gone: the first two on 2026-10-15, when
   `canvas/simulation.ts`'s group branches came out and the two fields could
   no longer report anything but a constant, and the helper with them. */

it('keeps the selected principle and its route after editing, so Back returns to the prior view',async()=>{
  principleState.rows=[{id:'principle-one',statement:'Leave room for thought.',type:'maxim',state:'held',origin:'declared',rank:0,locked:true,heldSince:null,conflictsWithId:null,createdAt:'2026-10-03T12:00:00Z',citedSignals:[]}];
  vi.mocked(updatePrinciple).mockImplementation(async(_id,text)=>{principleState.rows=[{...principleState.rows[0],statement:text}];return principleState.rows[0];});
  world=await mountWorld(FACTS,{routerTools:<RouterTools/>});await settle();await navigate('/principles/principle-one');
  await act(async()=>world.container.querySelector<HTMLButtonElement>('[aria-label="Edit wording"]')!.click());
  const editor=world.container.querySelector<HTMLTextAreaElement>('[aria-label="This principle in your own words"]')!;
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(editor,'Leave unhurried time for thought.');editor.dispatchEvent(new Event('input',{bubbles:true}));});
  await act(async()=>[...world.container.querySelectorAll<HTMLButtonElement>('.jar-principles-list--personal button')].find(button=>button.textContent==='Save')!.click());await settle();
  expect(location.pathname).toBe('/principles/principle-one');expect(world.container.textContent).toContain('Make a share card');
  expect(updatePrinciple).toHaveBeenCalledWith('principle-one','Leave unhurried time for thought.', expect.objectContaining({ profile: VIEWER_ID }));
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
  /* Since 2026-10-15 Now has no row, so at home nothing on the bar is lit —
     a lit row would claim you were on a new note or a chat. */
  expect([...world.container.querySelectorAll('.waka-dock .waka-dock-item--here')].map(n=>n.textContent?.trim()))
    .toEqual(['Home']);
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
/* `requires a visible audience confirmation before publishing and leaves
   cancel private` IS GONE WITH THE TOGGLE (founder, 2026-10-12). It was the
   strictest case in this file and it is worth saying what it held, because
   the standard outlives the control: a destructive or disclosing press had to
   show a VISIBLE confirmation — not a `title` attribute, which it asserted
   was absent on both words, and not a note that was already on screen — and
   cancelling had to leave the state exactly as it was, proven by
   `updateInspiration` not having been called at all rather than by the word
   on screen. It then pressed through and asserted the PATCH went out exactly
   once with `{visibility:'public'}`.

   THE AUDIENCE IT CONFIRMED WAS ROOMS: the sentence it matched was "People in
   your rooms can read it and its attachments". With rooms gone that promise
   is false, which is why the founder removed the control rather than
   reworded it. `updateInspiration` is still imported by this file for the
   editor's own save. */

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
it('a returning visitor is greeted by the creature, and no card opens by itself', async()=>{
  /* Founder, 2026-10-16: "once in a while the inspiration card keeps coming
     up in the main page but dont have that." The greeting used to open the
     newest memory's card for 2.6s; now it only speaks. */
  localStorage.setItem('waka.seen','1');
  vi.mocked(loadInspiration).mockResolvedValue({...detail,id:'loaded'});
  world=await mountWorld(FACTS,{routerTools:<RouterTools/>}); await settle();
  await act(async()=>{await vi.advanceTimersByTimeAsync(1500);}); await settle();
  expect(world.container.querySelector('[aria-label="A saved inspiration"]'), 'the greeting opened a card').toBeNull();
  await act(async()=>{await vi.advanceTimersByTimeAsync(4000);}); await settle();
  expect(world.container.querySelector('[aria-label="A saved inspiration"]'), 'a card opened by itself').toBeNull();
  expect(location.search).not.toContain('inspiration=');
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
  /* A HOP TO ANOTHER WALL STOOD HERE and it was doing two jobs. The first is
     gone with rooms (founder, 2026-10-12: "방 없애"): it navigated to
     `/w/group-id/old-name?view=sky`, whose point was that the URL carries a
     STALE SLUG and the world resolves the ID rather than trusting the words
     in the address — `resolveViewWall` matches `/w/:wall/:label` against your
     own walls, so there is no wall left in this fixture for it to resolve to.
     (An agent's wall still produces and accepts that address; proving the
     stale-slug rule again needs an agent roster here.)

     THE SECOND JOB IS WHAT THIS CASE IS ABOUT and it is kept: a hop AWAY and
     a Back restore the date, the card and its earlier answer, and the field
     is never re-fetched — `loadInspirations` once for the whole walk. The hop
     is up to the sky on your own wall now, which is a different view of the
     same wall rather than a different wall; what it has to be is a second
     history entry that is not the card. */
  await navigate('/?view=sky');
  expect(location.search).toContain('view=sky');
  await navigate(-1);
  expect(location.search).toContain(`at=${date}`); expect(world.container.textContent).toContain('My earlier words');
  expect(world.audit().wallKind).toBe('self');
  await navigate(1); expect(location.search).toContain('view=sky');
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
/* `records actual world travel as a new history entry instead of replacing
   the previous ground` IS GONE WITH THE SECOND WALL IT NEEDED. It descended
   to the ground, travelled to the room, and asserted that Back came home to
   the GROUND rather than to the top — travel must PUSH a history entry, not
   replace the one the descent wrote. The rule is live and the only thing
   missing is a wall to travel to: re-stage it with an agent's wall when this
   file grows an agent roster (founder, 2026-10-12: "방 없애"). */
it('discards a late detail when the person navigates elsewhere', async () => {
  let resolve!: (value: InspirationDetail) => void;
  vi.mocked(loadInspiration).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  world = await mountWorld(FACTS, { routerTools: <RouterTools /> }); await settle();
  /* ELSEWHERE USED TO BE A ROOM — `/w/group-id/renamed-room` — and is the
     ground on your own wall now (founder, 2026-10-12: "방 없애"). The
     property is unchanged and is the one that matters: a detail that lands
     AFTER the person has moved on is dropped rather than painted over
     wherever they now are. */
  await navigate('/inspirations/older'); await navigate('/?view=field');
  await act(async () => resolve(detail)); await settle();
  expect(location.search).toContain('view=field');
  expect(world.container.textContent).not.toContain(detail.text);
});
it('shows an unavailable link without silently opening another room and can return home', async () => {
  world = await mountWorld(FACTS, { initialEntries: ['/w/missing-id/old-name'], routerTools: <RouterTools /> }); await settle();
  expect(world.container.querySelector('[role="alert"]')?.textContent).toContain('isn’t available to this account');
  expect(world.container.querySelector('[role="alert"]')?.textContent).not.toContain('Try again');
  await act(async () => [...world.container.querySelectorAll<HTMLButtonElement>('.jar-navigation-notice button')].find(button => button.textContent === 'Me')!.click()); await settle();
  expect(world.container.querySelector('.jar-navigation-notice')).toBeNull(); expect(world.audit().wallKind).toBe('self');
});
/* The notice's Escape is the notice's only while it is the topmost layer:
   with the settings/info card (or the notepad, review, an overlay) up, that
   Escape is theirs, and the notice stays. */
it("leaves the unavailable-link notice alone on Escape while another layer is open, and closes it otherwise", async () => {
  world = await mountWorld(FACTS, { initialEntries: ['/w/missing-id/old-name'], routerTools: <RouterTools /> }); await settle();
  expect(world.container.querySelector('.jar-navigation-notice')).not.toBeNull();
  /* on window itself, as a key with nothing focused arrives: every window listener hears it */
  const escape = () => act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
  const info = world.container.querySelector<HTMLButtonElement>('.waka-corner--info')!;
  await act(async () => info.click()); await settle();
  expect(info.getAttribute('aria-expanded'), 'the info card did not open').toBe('true');
  await escape(); await settle();
  expect(world.container.querySelector('.jar-navigation-notice'), "the card's Escape also dismissed the notice under it").not.toBeNull();
  if (info.getAttribute('aria-expanded') === 'true') { await act(async () => info.click()); await settle(); }
  await escape(); await settle();
  expect(world.container.querySelector('.jar-navigation-notice'), 'Escape on the notice alone left it up').toBeNull();
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
  vi.mocked(fetchProfiles).mockResolvedValue([
    { id: 'ouroboros-maintainer', type: 'agent', name: 'Ouroboros maintainer', createdAt: '2026-08-01T00:00:00Z' },
    { id: 'course-marketing', type: 'agent', name: 'Course marketing', createdAt: '2026-08-01T00:00:00Z' },
  ] as never);

  world = await mountWorld(FACTS, {routerTools: <RouterTools/>}); await settle();
  expect(world.audit().wallKind).toBe('self');

  const face = (label: string) =>
    [...world.container.querySelectorAll<HTMLButtonElement>('.jar-char-face')]
      .find(button => button.textContent?.trim() === label);
  const toAgent = face('Ouroboros maintainer');
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
 * AND ON THE SURFACE THAT HAS NO OWNER, NEITHER FACE IS LIT.
 *
 * Founder: "When user clicks on chat, don't select any of me nor my agent
 * because here it doesn't matter — what's selected. For inspirations it
 * does, for now it does, but for chats it doesn't, so don't select
 * anything."
 *
 * WHY THIS IS A GATE AND NOT A ONE-LINE FIX LEFT UNWATCHED. The lit face
 * means "this is whose material you are reading" — light is the one channel
 * this product reports with — and chats are not anybody's in that sense:
 * `Home` hands the list and the panel `storageScope.profileId`, the signed-
 * in person's own, on every wall. The switcher was therefore claiming a
 * scope it could not change. The regression that brings it back is not a
 * revert of the fix; it is somebody folding `lit` back into `here`, which
 * looks like a tidy-up and reads correctly on three of the four views.
 *
 * BOTH HALVES, BECAUSE EITHER ALONE PASSES FOR THE WRONG REASON. Hiding the
 * switcher would satisfy "nothing is lit" and is explicitly not what was
 * asked — it is still the way to change form — so its presence is asserted
 * beside the darkness. And the archive is checked in the same test: a fix
 * that darkened the switcher everywhere would pass a test that only looked
 * at chats, and would have deleted a distinction the founder said still
 * matters ("For inspirations it does, for now it does").
 */
it('identifies the owner on the chats page and the archive', async () => {
  vi.mocked(fetchProfiles).mockResolvedValue([
    { id: 'ouroboros-maintainer', type: 'agent', name: 'Ouroboros maintainer', createdAt: '2026-08-01T00:00:00Z' },
    { id: 'course-marketing', type: 'agent', name: 'Course marketing', createdAt: '2026-08-01T00:00:00Z' },
  ] as never);

  const faces = () =>
    [...world!.container.querySelectorAll<HTMLButtonElement>('.jar-char-face')]
      .map(button => ({
        name: button.textContent?.trim(),
        lit: button.getAttribute('aria-pressed') === 'true'
          || button.classList.contains('jar-char-face--standing'),
      }));

  world = await mountWorld(FACTS, { initialEntries: ['/?open=conversations'], routerTools: <RouterTools /> });
  await settle();
  expect(faces(), 'the switcher keeps Me and every agent available').toHaveLength(3);
  expect(faces().filter(face => face.lit).map(face => face.name)).toEqual(['Me']);

  await act(async () => world!.unmount());
  world = await mountWorld(FACTS, { initialEntries: ['/?open=saves'], routerTools: <RouterTools /> });
  await settle();
  /* Whose inspirations these are is a real question with a real answer, and
     the answer is the wall you are standing on. */
  expect(faces().filter(face => face.lit).map(face => face.name)).toEqual(['Me']);
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
 * IT OPENS THE CONVERSATION THROUGH THE DOCK. Since 2026-10-15 that is the
 * bar's own "New chat" row, which makes a NEW chat (founder: "clicking on it
 * leads to new inspiration and new chat"). Pressing the door that exists is
 * the honest setup — a test that reaches a surface by a control nobody else
 * can reach it by proves the surface works and not that anyone can get to it.
 */
async function openANewChat(root: HTMLElement) {
  const chats = [...root.querySelectorAll<HTMLButtonElement>('.waka-dock .waka-dock-item')]
    .find(button => button.textContent?.trim() === 'Chats');
  if (chats) { await act(async () => chats.click()); await settle(); }
  const create = [...root.querySelectorAll<HTMLButtonElement>('.waka-over-new')]
    .find(button => button.textContent?.trim() === 'New chat');
  expect(create, 'the chat list offers no way to start a chat').toBeTruthy();
  await act(async () => create!.click()); await settle();
}

it('closes a conversation from its own X, which the overlay handler could not', async () => {
  world = await mountWorld(FACTS, {routerTools: <RouterTools/>}); await settle();
  await openANewChat(world.container);
  expect(location.pathname.startsWith('/chat/'), 'the conversation never opened').toBe(true);

  /* THE X IS GONE FROM EVERY DESTINATION. Founder: "how do we even need the
     close button for inspiration and chat? There's no reason for there to be
     an X button when we're just moving across the pages." So what this
     presses is the control that replaced it — since 2026-10-15 ("say all
     chats and then close") the word Close, last in the chat's own bar, which
     is visible the whole time a conversation is open and is the way out the
     law is actually satisfied by. Nothing in the bar is lit on a chat: the
     chat is not a list. The assertion is unchanged: an address, not a
     rendered button. */
  expect(world.container.querySelector('.waka-dock .waka-dock-item[aria-current="page"]'),
    'a chat lights a bar row, as if it were the chats list').toBeNull();
  const close = world.container.querySelector<HTMLButtonElement>('.waka-dock button.waka-dock-item--close');
  expect(close?.textContent?.trim(), 'a conversation offers no Close in its bar').toBe('Close');
  await act(async () => close!.click()); await settle();
  expect(location.pathname, 'the dock still does nothing from a conversation').not.toContain('/chat/');
  expect(new URLSearchParams(location.search).get('open'), 'Close on a chat did not go home').toBeNull();
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
it('steps from a new chat to the list of them', async () => {
  world = await mountWorld(FACTS, {routerTools: <RouterTools/>}); await settle();
  await openANewChat(world.container);
  expect(location.pathname.startsWith('/chat/'), 'the conversation never opened').toBe(true);

  /* ═══ THE WAY TO THE LIST IS ON THE NEW CHAT, AND IT IS PRESSED ═══════
     Founder, 2026-10-15: "user can go to inspiration list and chat list
     ONLY from that new page." The bar's word makes a new chat, so the list's
     one door is the new chat's own "All chats", in words.

     WHAT THIS CASE IS FOR DOES NOT CHANGE. Law 8 — "pressed, not counted"
     — is why it exists: the previous one-press return in this product
     rendered, read correctly, was enabled, and did nothing. A different
     control is pressed; the assertion that you end up on the list is the
     same, and it is now covering the control people will actually use.

     ═══ AND THE DOOR MOVED FROM THE CORNER TO THE BAR ═════════════════
     Founder, the same day: "never put something on any corners" — and of a
     chat's bar, "all chats and then ... close." The header above the chat is
     gone; the list's door is the first word of the chat's own bar. */
  expect(world.container.querySelector('header.jar-chat-top, .jar-chat-see-all'),
    'the All chats header came back above the chat').toBeNull();
  const back = [...world.container.querySelectorAll<HTMLButtonElement>('.waka-dock .waka-dock-item, .waka-page-back, .waka-primary-capture, .waka-over-new')]
    .find(node => node.textContent?.trim() === 'All chats');
  expect(back, 'a new chat offers no way to the list of chats').toBeTruthy();
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

/**
 * ═══ THE TWO-WORD BAR, PRESSED (2026-10-15) ═════════════════════════════
 *
 * Founder: "at the bottom bar just keep inspiration and chat and clicking on
 * it leads to new inspiration and new chat, and user can go to inspiration
 * list and chat list ONLY from that new page" — and "principle is sth user
 * can only get by dragging". Each route that ruling made is pressed here and
 * the ADDRESS is asserted — Law 8: pressed, not counted.
 */
const open = () => new URLSearchParams(location.search).get('open');
const lit = () => world.container.querySelector<HTMLButtonElement>('.waka-dock .waka-dock-item[aria-current="page"]');
const row = (name: string) => [...world.container.querySelectorAll<HTMLButtonElement>('.waka-dock .waka-dock-item, .waka-page-back, .waka-primary-capture, .waka-over-new')]
  .find(node => node.textContent?.trim() === name)!;
const key = async (target: EventTarget, name: string) => {
  await act(async () => { target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true })); });
  await settle();
};
const pull = async (node: HTMLElement, dx: number) => {
  const fire = (type: string, x: number) => node.dispatchEvent(new window.PointerEvent(type,
    { bubbles: true, cancelable: true, pointerId: 7, clientX: x, clientY: 300, button: 0, buttons: 1 }));
  await act(async () => { fire('pointerdown', 400); fire('pointermove', 400 + dx / 2); fire('pointerup', 400 + dx); });
  await settle();
};

it('walks to Principles on → from Now, and home again on ←', async () => {
  world = await mountWorld(FACTS, {routerTools: <RouterTools/>}); await settle();
  await key(document.body, 'ArrowRight');
  expect(open(), '→ on Now did not walk to Principles').toBe('principles');
  expect(lit(), 'Principles is walked to, so no bar row may light there').toBeNull();
  await key(document.body, 'ArrowLeft');
  expect(open(), '← on Principles did not walk home').toBeNull();
});

it('walks to Principles when the creature is pulled right, and home when the page is pulled left', async () => {
  world = await mountWorld(FACTS, {routerTools: <RouterTools/>}); await settle();
  const creature = world.container.querySelector<HTMLButtonElement>('.jar-char-press');
  expect(creature, 'the creature is not on Now').toBeTruthy();
  await pull(creature!, 30);
  expect(open(), 'a pull shorter than the threshold walked anyway').toBeNull();
  await pull(creature!, 90);
  expect(open(), 'pulling the creature right did not walk to Principles').toBe('principles');
  const page = world.container.querySelector<HTMLElement>('.waka-over[data-jar-surface]');
  expect(page, 'Principles is not on screen as a page').toBeTruthy();
  await pull(page!, -90);
  expect(open(), 'pulling the Principles page left did not walk home').toBeNull();
});

it('leaves Principles by Escape, and by a bar row in one visible press', async () => {
  world = await mountWorld(FACTS, {routerTools: <RouterTools/>}); await settle();
  await key(document.body, 'ArrowRight'); expect(open()).toBe('principles');
  await key(world.container.querySelector('.waka-over[data-jar-surface]')!, 'Escape');
  expect(open(), 'Escape no longer closes Principles').toBeNull();

  await key(document.body, 'ArrowRight'); expect(open()).toBe('principles');
  await openANewChat(world.container);
  expect(open(), 'Chat on Principles left Principles in place').toBeNull();
  expect(location.pathname, 'Chat on Principles did not open a new chat').toBe('/chat/new');
});

it('does not walk to Principles on → while a field has the key', async () => {
  world = await mountWorld(FACTS, {routerTools: <RouterTools/>}); await settle();
  /* Now holds no field of its own (capture is a door), so the test brings
     one: the guard reads the key's target, whoever rendered it. */
  const box = document.createElement('input');
  box.type = 'text';
  world.container.append(box);
  box.focus();
  await key(box, 'ArrowRight');
  expect(open(), '→ inside a field walked to Principles').toBeNull();
  box.remove();
  /* The same key off the field still walks, so the case above is the guard
     and not a dead listener. */
  await key(document.body, 'ArrowRight');
  expect(open(), '→ on Now stopped walking at all').toBe('principles');
  await key(document.body, 'ArrowLeft');
  /* And a chord is not the walk either — ⌥→ is a word jump everywhere. */
  await act(async () => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, bubbles: true, cancelable: true })); });
  await settle();
  expect(open(), '⌥→ walked to Principles').toBeNull();
});

/* CLOSE IS THE MAKING PAGE'S WAY HOME (2026-10-15): "have Close button and
   then clicking close brings the user back to the main screen." Not the lit
   row any more — a new note lights nothing; the lit row is a LIST's. */
const close = () => world.container.querySelector<HTMLButtonElement>('.waka-dock button.waka-dock-item--close');

it('makes a new note from Inspiration, and its Close goes home with the draft kept', async () => {
  world = await mountWorld(FACTS, {routerTools: <RouterTools/>}); await settle();
  await act(async () => row('New inspiration').click()); await settle();
  const field = world.container.querySelector<HTMLTextAreaElement>('textarea.jar-composer-text');
  expect(field, 'Inspiration did not open a new note').toBeTruthy();
  expect(new URLSearchParams(location.search).get('compose')).toBe('1');
  expect(lit(), 'a new note lights a bar row, as if it were the archive').toBeNull();
  expect(close()?.textContent?.trim(), 'a new note offers no Close in its bar').toBe('Close');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, 'half a thought');
    field!.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await settle();

  await act(async () => close()!.click()); await settle();
  expect(new URLSearchParams(location.search).get('compose'), 'Close did not leave the note').toBeNull();
  expect(open(), 'Close on a note went somewhere other than home').toBeNull();
  expect(world.container.querySelector('textarea.jar-composer-text'), 'the note is still up').toBeNull();
  expect(lit()?.textContent?.trim()).toBe('Home');
  expect(close(), 'home still offers a Close').toBeNull();
  expect(barShape(world.container), 'home is not back to creation and history').toEqual(['Home', 'Inspirations', 'Chats']);

  await act(async () => row('Continue draft').click()); await settle();
  expect(world.container.querySelector<HTMLTextAreaElement>('textarea.jar-composer-text')?.value,
    'going home threw the draft away').toBe('half a thought');
});

it('keeps archive navigation outside the composer, and reaches chat history from a chat', async () => {
  world = await mountWorld(FACTS, {routerTools: <RouterTools/>}); await settle();
  /* ON NOW THE BAR IS THE TWO WORDS AND NOTHING ELSE — no list door, no
     Close, no rule. */
  expect(barShape(world.container), 'Now\'s bar is missing creation or history').toEqual(['Home', 'Inspirations', 'Chats']);

  await act(async () => row('New inspiration').click()); await settle();
  /* NOTHING IN THE CORNER (2026-10-15): the archive's door is the first
     word of the note's own bar, not a word beside its date. */
  expect(world.container.querySelector('.jar-note-see-all, .jar-note-lead'), 'the archive door is back in the note\'s corner').toBeNull();
  expect(pressesInTopRow(world.container), 'something pressable stands beside a new note\'s date').toEqual([]);
  expect(row('All inspirations'), 'archive navigation competes with saving').toBeUndefined();
  await act(async () => close()!.click()); await settle();
  const seeAll = row('Inspirations');
  await act(async () => seeAll!.click()); await settle();
  expect(open(), 'All inspirations did not open the archive').toBe('saves');
  /* ON A LIST THE BAR IS ↩ │ CLOSE (2026-10-15), and Close goes home. */
  expect(barShape(world.container)).toEqual(['Home', 'Inspirations', 'Chats']);
  await act(async () => row('Home').click()); await settle();
  expect(open(), 'Close on the archive did not go home').toBeNull();

  await openANewChat(world.container);
  expect(location.pathname, 'Chat did not open a NEW chat').toBe('/chat/new');
  expect(world.container.querySelector('header.jar-chat-top, .jar-chat-see-all'), 'the All chats header is back above the chat').toBeNull();
  const allChats = row('All chats');
  expect(allChats, 'a new chat offers no way to the chats').toBeTruthy();
  await act(async () => allChats!.click()); await settle();
  expect(open(), 'All chats did not open the chats list').toBe('conversations');
  expect(barShape(world.container)).toEqual(['Home', 'Inspirations', 'Chats']);
  await act(async () => row('Home').click()); await settle();
  expect(open(), 'Close on the chats list did not go home').toBeNull();
  expect(location.pathname, 'Close on the chats list left a chat up').not.toContain('/chat/');
});

/**
 * ═══ ON A LIST, THE BAR IS ↩ │ CLOSE (2026-10-15) ═════════════════════
 *
 * Founder: "from all inspirations, the bottom bar should just be a return
 * icon | close." The same for All chats — one ruling for the class. ↩ steps
 * back where the list was opened from (the new note or chat), or from a
 * saved note open in the archive back to the list; Close goes home. The
 * Inspiration and Chat words are not in the bar on a list, and nothing is
 * lit there any more.
 */
const returnRow = () => world.container.querySelector<HTMLButtonElement>('button.waka-page-back');

it('keeps three stable tabs on both lists and marks the active destination', async () => {
  world = await mountWorld(FACTS, {routerTools: <RouterTools/>}); await settle();
  for (const [list, entry] of [['saves', 'Inspirations'], ['conversations', 'Chats']] as const) {
    await act(async () => row(entry).click()); await settle();
    expect(open()).toBe(list);
    expect(barShape(world.container)).toEqual(['Home', 'Inspirations', 'Chats']);
    expect(lit()?.textContent?.trim()).toBe(entry);
    expect(returnRow()).toBeNull();
    expect(close()).toBeNull();
    const href = location.pathname + location.search;
    await act(async () => row(entry).click()); await settle();
    expect(location.pathname + location.search).toBe(href);
  }
  await act(async () => row('Home').click()); await settle();
  expect(open()).toBeNull();
  expect(lit()?.textContent?.trim()).toBe('Home');
});

it('returns home from chat history without stepping back into a chat', async () => {
  world = await mountWorld(FACTS, {routerTools: <RouterTools/>}); await settle();
  await openANewChat(world.container);
  await act(async () => row('All chats').click()); await settle();
  expect(open()).toBe('conversations');
  await act(async () => row('Home').click()); await settle();
  expect(location.pathname + location.search).toBe('/');
});

it('leaves a directly linked archive through Home', async () => {
  world = await mountWorld(FACTS, {routerTools: <RouterTools/>}); await settle();
  await navigate('/?open=saves');
  await act(async () => row('Home').click()); await settle();
  expect(location.pathname + location.search).toBe('/');
});

it('steps back from a saved note open in the archive to the archive\'s list on ↩, the note\'s tools beside it', async () => {
  world = await mountWorld(FACTS, {routerTools: <RouterTools/>}); await settle();
  await chooseFromMenu(world.container, 'Inspirations'); await settle();
  expect(open()).toBe('saves');
  const saved = world.container.querySelector<HTMLButtonElement>('.waka-list-row');
  expect(saved, 'the archive shows no saved row to open').toBeTruthy();
  await act(async () => saved!.click()); await settle();
  expect(world.container.querySelector('.jar-note-top'), 'the saved note did not open as a note page').toBeTruthy();

  /* ↩ │ THE NOTE'S TOOLS │ CLOSE. The tools ride in the return row's slot. */
  const shape = barShape(world.container);
  const seps = shape.flatMap((part, at) => (part === '│' ? [at] : []));
  expect(seps, 'tools and Close are separate groups').toHaveLength(1);
  expect(returnRow()!.textContent).toBe('All inspirations');
  expect(shape.slice(seps[0]! + 1), 'the last group is not Close alone').toEqual(['Close']);
  const slot = world.container.querySelector('span.waka-dock-slot');
  expect(slot?.querySelector('#waka-note-tools.waka-dock-making[role="group"]'), 'the note\'s tools are not in the return row\'s slot').toBeTruthy();
  expect(shape, 'Inspiration is in the bar on a saved note').not.toContain('New inspiration');
  expect(shape, 'Chat is in the bar on a saved note').not.toContain('New chat');

  await act(async () => returnRow()!.click()); await settle();
  expect(world.container.querySelector('.jar-note-top'), '↩ left the saved note up').toBeNull();
  expect(open(), '↩ from a saved note left the archive').toBe('saves');
  expect(world.container.querySelector('.waka-list-row'), '↩ did not come back to the archive\'s list').toBeTruthy();
  expect(barShape(world.container)).toEqual(['Home', 'Inspirations', 'Chats']);
});

it('gives the saved note in the archive no All inspirations, since it is already there', async () => {
  world = await mountWorld(FACTS, {routerTools: <RouterTools/>}); await settle();
  await chooseFromMenu(world.container, 'Inspirations'); await settle();
  expect(open()).toBe('saves');
  const saved = world.container.querySelector<HTMLButtonElement>('.waka-list-row');
  expect(saved, 'the archive shows no saved row to open').toBeTruthy();
  await act(async () => saved!.click()); await settle();
  expect(world.container.querySelector('.jar-note-top'), 'the saved note did not open as a note page').toBeTruthy();
  expect(pressesInTopRow(world.container), 'something pressable stands beside a saved note\'s date').toEqual([]);
  expect(world.container.querySelector('.jar-note-see-all'), 'a saved note grew a door to the archive it is in').toBeNull();
});

// Save and leaving must read as different actions while composing.
it('gives a new note a labeled Save and separate Close, without archive navigation', async () => {
  /* THE MIC IS OFFERED ONLY WHERE THE BROWSER CAN LISTEN, so the probe is
     given a yes here — the same stand-in `one-dock-two-notes` uses — or the
     row would honestly be one tool short and the order unproven. */
  class StubRecognition { start(): void {} stop(): void {} abort(): void {} }
  (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition = StubRecognition;
  try {
    world = await mountWorld(FACTS, {routerTools: <RouterTools/>}); await settle();
    await act(async () => row('New inspiration').click()); await settle();
    const shape = barShape(world.container);
    expect(shape).toEqual(['Speak', 'Add photo or file', 'Save', '│', 'Close']);
    expect(row('All inspirations')).toBeUndefined();
    const save = world.container.querySelector<HTMLButtonElement>('.waka-dock-save')!;
    expect(save.textContent).toBe('Save');
    expect(save.disabled).toBe(true);
    const field = world.container.querySelector<HTMLTextAreaElement>('textarea.jar-composer-text')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, 'A deliberate save');
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await settle();
    expect(save.disabled).toBe(false);
    const tools = shape.slice(0, 3);
    /* The tools are the making-slot's, and Save is the disk-drawn keep. */
    const making = world.container.querySelector('nav.waka-dock .waka-dock-making');
    expect(making?.querySelector('button.waka-dock-tool--keep [data-home-action-icon="keep"]'), 'Save lost its keep icon').toBeTruthy();
    /* A disk, not a download ("instead of download have a save icon"): the
       disk's label is the one closed shape the tray-and-arrow never had. */
    expect(making?.querySelector('button.waka-dock-tool--keep [data-home-action-icon="keep"] rect'), 'Save is drawn as a download again').toBeTruthy();
    expect(making?.querySelectorAll('button.waka-dock-tool').length, 'a tool in the middle is not a dock tool').toBe(tools.length);
    expect(making?.querySelector('button.waka-dock-tool [data-home-action-icon="record"]'), 'the mic is not drawn as one').toBeTruthy();
    expect(making?.querySelector('button.waka-dock-tool[aria-haspopup="menu"] [data-home-action-icon="plus"]'), 'the ＋ is not drawn as one, or opens no menu').toBeTruthy();
    expect(making?.querySelector('[data-home-action-icon="photo"]'), 'the photo glyph is back in the bar').toBeNull();
    expect(shape, 'Chat is still in the bar while a note is being written').not.toContain('New chat');
    expect(shape, 'the bar still says Inspiration on a new note').not.toContain('New inspiration');
  } finally {
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
  }
});

// Moving the background while a page is open can leave another page entry
// underneath. Close must leave the page in one press, regardless of history.
it('closes the archive to home even when the previous history entry is also the archive', async () => {
  world = await mountWorld(FACTS, { routerTools: <RouterTools/> }); await settle();
  await act(async () => row('Inspirations').click()); await settle();
  await act(async () => go('/?view=sky&open=saves', { state: location.state })); await settle();
  await act(async () => row('Home').click()); await settle();
  expect(location.pathname + location.search).toBe('/');
  expect(world.container.querySelector('.waka-over')).toBeNull();
});

it.each(['/?compose=1', '/?open=saves', '/?open=saves&note=loaded', '/?open=conversations', '/chat/new'])(
  'closes a directly opened %s in one press', async path => {
    world = await mountWorld(FACTS, { initialEntries: [path], routerTools: <RouterTools/> }); await settle();
    const exit = close() ?? row('Home');
    expect(exit).toBeTruthy();
    await act(async () => exit.click()); await settle();
    expect(location.pathname + location.search).toBe('/');
    expect(close()).toBeNull();
    expect(world.container.querySelector('.jar-inspiration-composer, .waka-over')).toBeNull();
  },
);


it('starts a capture directly from a populated archive and names a retained draft', async () => {
  world = await mountWorld(FACTS, { initialEntries: ['/?open=saves'], routerTools: <RouterTools/> }); await settle();
  const action = () => world.container.querySelector<HTMLButtonElement>('.waka-over-head .waka-over-new')!;
  expect(action().textContent?.trim()).toBe('New inspiration');
  await act(async () => action().click()); await settle();
  expect(new URLSearchParams(location.search).get('open')).toBeNull();
  expect(new URLSearchParams(location.search).get('compose')).toBe('1');
  const field = world.container.querySelector<HTMLTextAreaElement>('textarea.jar-composer-text')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, 'A draft from the archive');
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }); await settle();
  await act(async () => close()!.click()); await settle();
  await act(async () => row('Inspirations').click()); await settle();
  expect(action().textContent?.trim()).toBe('Continue draft');
  await act(async () => action().click()); await settle();
  expect(world.container.querySelector<HTMLTextAreaElement>('textarea.jar-composer-text')?.value).toBe('A draft from the archive');
});

it('shows only owned profiles when a signed-in account has no agents', async () => {
  world = await mountWorld(FACTS, { routerTools: <RouterTools/> }); await settle();
  expect([...world.container.querySelectorAll('.jar-char-face')].map(node => node.textContent?.trim())).toEqual([]);
  expect(world.container.textContent).not.toMatch(/Ouroboros maintainer|Course marketing/);
});
