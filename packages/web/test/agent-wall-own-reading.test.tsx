// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY (gate G6): `lib/data` supplies the three layers,
 * and `loadTopOfMind` answers by PROFILE — the owner has one top of mind and
 * their agent another, which is the whole point: the bug only shows when both
 * exist and differ. `lib/api` supplies the boot reads, `lib/api/principles`
 * principle reads, `lib/api/profiles` the Settings roster mutations,
 * `lib/api/conversations` profile-owned chat storage, and
 * `lib/auth-context` the session. `helpers/render-home` and
 * `helpers/canvas-stub` replace canvas/viewport/clock/randomness; the real
 * world, the real form switch and the real agent bundle loader all run.
 * Appearance/SQL are not claimed.
 *
 * ═══ AN AGENT'S WALL SAYS ITS OWN TOP OF MIND ═══════════════════════════════
 *
 * Screenshot check, 2026-10-16: on "My agent" the bubble said "I haven't
 * formed anything yet" over a reading the server had returned. The bubble only
 * ever held YOUR reading — rightly scoped off the agent's wall — and nothing
 * took its place. It now holds the agent's own, in the agent's first person.
 */
import { act } from 'react';
import { useLocation } from 'react-router-dom';
import type { ApiOwnedProfile } from '../src/lib/api/profiles';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { installCanvasStub, setViewport } from './helpers/canvas-stub';
import { mountWorld, dataMockFrom, apiMockFrom, chooseFromMenu, pressDockRow, closeOverlay, VIEWER_ID, type MountedWorld } from './helpers/render-home';
import { ApiError, createInspiration, fetchPrinciples, updatePrinciple } from '../src/lib/api';
import { fetchPrincipleRead } from '../src/lib/api/principles';
import { loadInspirations, loadSignals, loadTopOfMind } from '../src/lib/data';
import { listConversations, createConversation, type ApiConversation } from '../src/lib/api/conversations';

const FACTS = vi.hoisted(() => ({
  inspirations: [{ id: 'kept', text: 'Something I kept', daysAgo: 1 }],
  groups: [] as never[],
}));
const CAPTURES = vi.hoisted(() => ({ rows: [] as Array<{id:string;profileId:string;text:string}> }));
const CHATS = vi.hoisted(() => ({ rows: [] as ApiConversation[] }));
const PROFILES = vi.hoisted(() => ({ rows: null as ApiOwnedProfile[] | null }));
const ARCHIVE = vi.hoisted(() => ({ holdFor: '', release: null as (() => void) | null }));
const NOAH_SAYS = vi.hoisted(() => 'I remember the decisions Noah made.');
const ANOTHER_SAYS = vi.hoisted(() => 'I remember the decisions Another made.');
const OWNER_SAYS = vi.hoisted(() => 'The owner keeps returning to slow mornings.');
const AGENT_SAYS = vi.hoisted(() => 'I keep the version that survives the runtime.');
/* NEWER, UNPINNED, AND FIRST IN THE LIST — the entry a "newest by date" or
   "first served" reading would pick. The agent's lead is the PINNED one, by
   the same rule as your own bubble's `lead`. */
const AGENT_NEWER = vi.hoisted(() => 'A later thought the agent has not pinned.');
/* A REAL AGENT ('agent-held') for the cases that need its reading to be
   pending, to fail, or to be honestly empty — and the reader's language. */
const HOLD = vi.hoisted(() => ({
  on: false, reading: 'hang' as 'hang' | 'fail' | 'empty' | 'board' | 'defer', locale: 'en-US' as 'en-US' | 'ko-KR',
  /* 'defer': the reading waits until the test says so, through this */
  release: null as null | (() => void),
  /* what a deferred reading's pinned lead says when it is released */
  deferSays: '' as string,
}));

vi.mock('../src/lib/api/principles', async original => ({
  ...await original<typeof import('../src/lib/api/principles')>(),
  fetchPrincipleRead: vi.fn(async () => ({ principles: [], status: { phase: 'ready', eligible: false } })),
}));
vi.mock('../src/lib/data', async original => {
  const entry = (id: string, body: string, pinned: boolean, daysAgo: number) => ({
    id, type: 'hypothesis' as const, body, belief: null, prompt: null,
    locked: false, pinned, dismissed: false, sortOrder: 0, citedSignals: [],
    createdMs: Date.UTC(2026, 7, 16, 12) - daysAgo * 86_400_000,
  });
  const board = (entries: ReturnType<typeof entry>[]) => ({
    id: `tom-${entries[0]!.id}`, version: 1, reason: 'initial' as const, createdMs: Date.UTC(2026, 7, 14, 12), entries,
  });
  return {
    ...await original<typeof import('../src/lib/data')>(), ...dataMockFrom(FACTS),
    loadInspirations: vi.fn(async (profile?: string) => {
      const field = await dataMockFrom({inspirations:[
      ...(PROFILES.rows && profile?.startsWith('agent-') ? [{id:`${profile}-note`,text:`Only ${profile} kept this`,daysAgo:1}] : FACTS.inspirations),
      ...CAPTURES.rows.filter(row=>row.profileId===(profile??VIEWER_ID)).map(row=>({...row,daysAgo:0})),
      ]}).loadInspirations();
      if (profile && profile === ARCHIVE.holdFor) await new Promise<void>(resolve => { ARCHIVE.release = resolve; });
      return field;
    }),
    loadSignals: vi.fn(async () => []),
    /* yours when no profile (or yours) is named; the agent's otherwise */
    loadTopOfMind: vi.fn(async (profile?: string) =>
      profile === 'agent-noah' ? board([entry('noah-lead', NOAH_SAYS, true, 1)])
      : profile === 'agent-another' ? board([entry('another-lead', ANOTHER_SAYS, true, 1)])
      : HOLD.on && profile === 'agent-held'
        ? HOLD.reading === 'hang' ? new Promise<never>(() => {})
          : HOLD.reading === 'defer'
            ? new Promise<ReturnType<typeof board>>((resolve) => {
                HOLD.release = () => resolve(board([entry('agent-newer', AGENT_NEWER, false, 1), entry('agent-lead', HOLD.deferSays || AGENT_SAYS, true, 3)]));
              })
          : HOLD.reading === 'fail' ? Promise.reject(new Error('reading unavailable'))
          : HOLD.reading === 'empty' ? null
          : board([entry('agent-newer', AGENT_NEWER, false, 1), entry('agent-lead', AGENT_SAYS, true, 3)])
      : profile && profile !== VIEWER_ID
        ? board([entry('agent-newer', AGENT_NEWER, false, 1), entry('agent-lead', AGENT_SAYS, true, 3)])
        : board([entry('owner-lead', OWNER_SAYS, false, 2)])),
  };
});
vi.mock('../src/lib/api', async original => ({
  ...await original<typeof import('../src/lib/api')>(), ...apiMockFrom(FACTS),
  createInspiration: vi.fn(async (input:{text:string}, options:{profile:string}) => {
    const row={id:crypto.randomUUID(),profileId:options.profile,text:input.text};CAPTURES.rows.push(row);
    return {...row,kind:'note',source:'app',visibility:'private',attachments:[],reflections:[],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
  }),
  fetchInspirationSaveRequest: vi.fn(async()=>{throw new ApiError({status:404,code:'save_not_found',message:'Not saved yet'});}),
  fetchPrinciples: vi.fn(async () => []),
  updatePrinciple: vi.fn(),
  fetchTheWeather: vi.fn(async () => ({ told: null, antechamber: [], days: [] })),
  fetchProfiles: vi.fn(async () => PROFILES.rows ?? (HOLD.on
    ? [{ id: 'agent-held', name: 'Held agent', type: 'agent', createdAt: '2026-08-01T00:00:00.000Z' }]
    : [])),
}));
vi.mock('../src/lib/api/profiles', async original => ({
  ...await original<typeof import('../src/lib/api/profiles')>(),
  fetchProfiles: vi.fn(async () => PROFILES.rows ?? []),
  createProfile: vi.fn(async (name: string) => {
    const profile: ApiOwnedProfile = { id: 'agent-new', accountId: 'account-1', name, type: 'agent', avatarUrl: null, preferredLocale: 'en-US', createdAt: '2026-10-22T00:00:00Z' };
    PROFILES.rows = [...(PROFILES.rows ?? []), profile];
    return profile;
  }),
  renameProfile: vi.fn(async (id: string, name: string) => {
    PROFILES.rows = (PROFILES.rows ?? []).map(profile => profile.id === id ? { ...profile, name } : profile);
    return PROFILES.rows.find(profile => profile.id === id)!;
  }),
  deleteProfile: vi.fn(async (id: string) => { PROFILES.rows = (PROFILES.rows ?? []).filter(profile => profile.id !== id); }),
}));

vi.mock('../src/lib/api/conversations', async original => ({
  ...await original<typeof import('../src/lib/api/conversations')>(),
  listConversations: vi.fn(async (profileId: string) => ({profileId, conversations:CHATS.rows.filter(row=>row.profileId===profileId).map(row=>({id:row.id,profileId,revision:row.revision,preview:row.messages[0]?.content??'',updatedAt:row.updatedAt})),generationEnabled:false})),
  createConversation: vi.fn(async (profileId: string, id: string, _signal:unknown, _principle:unknown, first:{id:string;content:string}) => {
    const row:ApiConversation={id,profileId,revision:1,generationEnabled:false,createdAt:'2026-10-22T00:00:00Z',updatedAt:'2026-10-22T00:00:00Z',messages:[{id:first.id,profileId,conversationId:id,role:'user',position:1,content:first.content,createdAt:'2026-10-22T00:00:00Z'}]};
    CHATS.rows.push(row); return row;
  }),
  fetchConversation: vi.fn(async (profileId:string,id:string) => {
    const row=CHATS.rows.find(row=>row.profileId===profileId&&row.id===id);if(!row)throw new Error('Wrong profile');return row;
  }),
}));
vi.mock('../src/lib/auth-context', async original => {
  const session = { status: 'authenticated', account: { id: 'account-1', email: 'you@example.test' },
    profile: { id: VIEWER_ID, name: 'You', type: 'human', get preferredLocale() { return HOLD.locale; } }, profiles: [], refresh: async () => undefined, signOut: async () => undefined };
  return { ...await original<typeof import('../src/lib/auth-context')>(), useOptionalAuth: () => session, useAuth: () => session };
});

let world: MountedWorld;
beforeAll(() => { installCanvasStub(); setViewport(1280, 900); (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => { localStorage.clear(); vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); });
afterEach(() => { PROFILES.rows = null; CHATS.rows = []; CAPTURES.rows = []; vi.mocked(createInspiration).mockClear(); vi.mocked(listConversations).mockClear(); vi.mocked(createConversation).mockClear(); world?.unmount(); vi.useRealTimers(); Object.assign(HOLD, { on: false, reading: 'hang', locale: 'en-US', release: null, deferSays: '' }); ARCHIVE.holdFor = ''; ARCHIVE.release = null; vi.mocked(loadInspirations).mockClear(); vi.mocked(loadTopOfMind).mockClear(); vi.mocked(loadSignals).mockClear(); });

async function settle() {
  for (let turn = 0; turn < 12; turn += 1) { await world.step(100); await act(async () => { await vi.advanceTimersByTimeAsync(100); }); }
}
const face = (label: string) =>
  [...world.container.querySelectorAll<HTMLButtonElement>('.jar-char-face')]
    .find(button => button.textContent?.trim() === label);
const bubble = () => world.container.querySelector('.jar-char-bubble:not(.jar-char-bubble--review)');

function twoAgents() {
  PROFILES.rows = ['noah', 'another'].map(name => ({ id: `agent-${name}`, accountId: 'account-1', name,
    type: 'agent', avatarUrl: null, preferredLocale: 'en-US', createdAt: '2026-08-01T00:00:00Z' }));
}

it('opens history directly for the standing agent without starting a note or conversation', async () => {
  twoAgents();
  world = await mountWorld(FACTS); await settle();
  const dock = (label: string) => [...world.container.querySelectorAll<HTMLButtonElement>('.waka-dock button')]
    .find(button => button.textContent?.trim() === label)!;
  const close = async () => { await act(async () => dock('Home').click()); await settle(); };
  for (const name of ['noah', 'another']) {
    await act(async () => face(name)!.click()); await settle();
    await act(async () => dock('Inspirations').click()); await settle();
    const archive = world.container.querySelector('.waka-over[data-jar-surface]')!;
    expect(archive.textContent).toContain(`Only agent-${name} kept this`);
    expect(world.container.querySelector('textarea.jar-composer-text')).toBeNull();
    await close();
    await act(async () => dock('Chats').click()); await settle();
    expect(vi.mocked(listConversations).mock.lastCall?.[0]).toBe(`agent-${name}`);
    expect(createConversation).not.toHaveBeenCalled();
    await close();
  }
});

it('shows the agent reading without fetching its archive, then loads the archive when opened', async () => {
  twoAgents(); ARCHIVE.holdFor = 'agent-noah';
  world = await mountWorld(FACTS); await settle();
  await act(async () => face('noah')!.click()); await settle();
  expect(reading()).toBe(NOAH_SAYS);
  expect(vi.mocked(loadInspirations).mock.calls.filter(([id]) => id === 'agent-noah')).toHaveLength(0);
  expect(world.container.querySelector('.jar-wall-empty'), 'an unread archive must not be called empty').toBeNull();
  await chooseFromMenu(world.container, 'Inspirations'); await settle();
  expect(vi.mocked(loadInspirations).mock.calls.filter(([id]) => id === 'agent-noah')).toHaveLength(1);
  expect(ARCHIVE.release).not.toBeNull();
  await act(async () => ARCHIVE.release!()); await settle();
  const archive = world.container.querySelector('.waka-over[data-jar-surface]')!;
  expect(archive.textContent).toContain('Only agent-noah kept this');
  expect(archive.textContent).not.toContain('Only agent-another kept this');
});

it('loads the canvas field on entry and keeps it through a reading refresh', async () => {
  twoAgents();
  world = await mountWorld(FACTS); await settle();
  await act(async () => face('noah')!.click()); await settle();
  await world.toField(); await settle();
  expect(world.audit().present).toBe(1);
  expect(vi.mocked(loadInspirations).mock.calls.filter(([id]) => id === 'agent-noah')).toHaveLength(1);
  await act(async () => simNow().toTop()); await settle();
  await act(async () => face('Me')!.click()); await settle();
  const clock = Date.now;
  try {
    Date.now = () => clock() + 61_000;
    await act(async () => face('noah')!.click()); await settle();
    expect(reading()).toBe(NOAH_SAYS);
    expect(vi.mocked(loadInspirations).mock.calls.filter(([id]) => id === 'agent-noah')).toHaveLength(1);
    expect(world.audit().present).toBe(1);
  } finally { Date.now = clock; }
});

it('aborts a delayed field read when leaving its agent and ignores its late response', async () => {
  twoAgents(); ARCHIVE.holdFor = 'agent-noah';
  world = await mountWorld(FACTS); await settle();
  await act(async () => face('noah')!.click()); await settle();
  await world.toField(); await settle();
  const signal = vi.mocked(loadInspirations).mock.calls.find(([id]) => id === 'agent-noah')?.[1]?.signal;
  expect(signal?.aborted).toBe(false);
  await act(async () => face('another')!.click()); await settle();
  expect(signal?.aborted).toBe(true);
  await act(async () => ARCHIVE.release!()); await settle();
  expect(world.audit().wallId).toBe('agent-another');
  await act(async () => simNow().toTop()); await settle();
  expect(reading()).toBe(ANOTHER_SAYS);
  expect(world.container.querySelector('.jar-reach')?.textContent ?? '').not.toContain('agent-noah');
});

it.each(['another', 'Me'])('refreshes only the active profile (%s) after returning to the tab', async active => {
  twoAgents();
  world = await mountWorld(FACTS); await settle();
  for (const name of ['noah', 'another']) {
    await act(async () => face(name)!.click()); await settle();
  }
  if (active === 'Me') { await act(async () => face('Me')!.click()); await settle(); }
  else {
    const next = (await loadTopOfMind('agent-another'))!;
    vi.mocked(loadTopOfMind).mockResolvedValueOnce({ ...next, entries: next.entries.map(entry => ({ ...entry, body: 'A refreshed agent reading.' })) });
  }
  vi.mocked(loadInspirations).mockClear(); vi.mocked(loadTopOfMind).mockClear(); vi.mocked(loadSignals).mockClear();
  let visibility: DocumentVisibilityState = 'hidden';
  const spy = vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  const clock = Date.now;
  try {
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    Date.now = () => clock() + 45_000; visibility = 'visible';
    await act(async () => document.dispatchEvent(new Event('visibilitychange'))); await settle();
    if (active === 'another') {
      expect(vi.mocked(loadTopOfMind).mock.calls.map(([id]) => id)).toEqual(['agent-another']);
      expect(vi.mocked(loadSignals).mock.calls.map(([id]) => id)).toEqual(['agent-another']);
      expect(loadInspirations).not.toHaveBeenCalled();
      expect(reading()).toBe('A refreshed agent reading.');
    } else {
      expect(loadInspirations).toHaveBeenCalledTimes(1);
      expect(loadSignals).toHaveBeenCalledTimes(1);
      for (const load of [loadInspirations, loadSignals, loadTopOfMind]) {
        expect(vi.mocked(load).mock.calls.every(([id]) => !id || id === VIEWER_ID)).toBe(true);
      }
      expect(reading()).toBe(OWNER_SAYS);
    }
  } finally { Date.now = clock; spy.mockRestore(); }
});

it("holds up the agent's own reading on its wall, never the owner's", async () => {
  /* a REAL agent, so its bundle is a first load from these mocks — the dev
     fixture's agents arrive preloaded, and a refresh lands only at arrival */
  Object.assign(HOLD, { on: true, reading: 'board' });
  world = await mountWorld(FACTS); await settle();
  expect(bubble()?.textContent, 'the owner wall should say the owner\'s top of mind').toContain(OWNER_SAYS);

  const toAgent = face('Held agent');
  expect(toAgent, 'the creature offers no way to take its agent form').toBeTruthy();
  /* NO RENDER IN BETWEEN MAY PUT YOUR SENTENCE IN ITS FRAME. `chrome` is
     written in an effect after the wall changes, so a bubble that read it
     showed the owner's line under the agent's "on my mind" for a frame. The
     switch is watched in small steps, and every one of them is checked.
     A LIMIT, MEASURED: `act` flushes the effect in the same turn as the
     render it follows, so that one stale commit never reaches the DOM here —
     pointing `agentSays` back at `chrome` still passes. The guard against it
     is structural (`agentSays` reads the agent bundle's `direction.current` in render);
     these checks hold the observable half: no settled step mislabels. */
  const mislabelled = () => {
    const b = bubble();
    return b?.querySelector('.jar-char-bubble-of')?.textContent?.trim() === 'This is what’s on my mind right now.'
      && (b.textContent ?? '').includes(OWNER_SAYS);
  };
  await act(async () => { toAgent!.click(); });
  expect(mislabelled(), 'the switch rendered the owner\'s sentence in the agent\'s frame').toBe(false);
  for (let turn = 0; turn < 60; turn += 1) {
    await world.step(5); await act(async () => { await vi.advanceTimersByTimeAsync(20); });
    expect(mislabelled(), `the owner's sentence sat in the agent's frame at step ${turn}`).toBe(false);
  }
  await settle();
  expect(world.audit().wallKind).toBe('agent');

  const said = bubble();
  expect(said?.textContent ?? '', 'the owner\'s sentence leaked onto the agent\'s wall').not.toContain(OWNER_SAYS);
  expect(said?.querySelector('.jar-char-bubble-reading')?.textContent?.trim(),
    'the agent wall fell through to the resting line over a reading it holds').toBe(AGENT_SAYS);
  expect(said?.querySelector('.jar-char-bubble-of')?.textContent?.trim()).toBe('This is what’s on my mind right now.');
  expect(said?.textContent ?? '', 'the bubble held the newest entry rather than the pinned lead').not.toContain(AGENT_NEWER);
});

/* ═══ NO BUBBLE WHILE THE AGENT'S BUNDLE HAS NOT ARRIVED ═══════════════════
   Its first load is still out, so the app does not know whether the agent
   has formed anything; "nothing adopted yet" there would be a claim about it.
   Founder: "no bubble at all while there is nothing true to put in it"
   (code review round 3, 2026-10-16). */
it("says nothing on an agent's wall whose first load is still pending", async () => {
  HOLD.on = true;
  world = await mountWorld(FACTS); await settle();
  const toAgent = face('Held agent');
  expect(toAgent, 'the creature offers no way to take its agent form').toBeTruthy();
  await act(async () => { toAgent!.click(); });
  await settle();
  expect(world.audit().wallKind).toBe('agent');
  expect(bubble(), 'a bubble spoke for an agent whose bundle has not arrived').toBeNull();
});

/* ═══ A READING THAT COULD NOT BE READ IS NOT "NOTHING FORMED" ═════════════
   The first load forgives a failed top-of-mind read as an empty board, so
   the wall would say "I haven't formed anything yet" over a reading that
   exists. It says nothing instead (final review, 2026-10-16). */
it("says nothing on an agent's wall whose reading failed to load", async () => {
  Object.assign(HOLD, { on: true, reading: 'fail' });
  world = await mountWorld(FACTS); await settle();
  await act(async () => { face('Held agent')!.click(); });
  await settle();
  expect(world.audit().wallKind).toBe('agent');
  expect(bubble(), 'a failed read was told as "nothing formed"').toBeNull();
});

/* ═══ AND THE RESTING LINE IS IN THE READER'S LANGUAGE ═════════════════════
   `wallChromeNow` derived the agent's chrome without a locale, so a Korean
   reader's agent said its resting line in English (final review,
   2026-10-16). */
it("says an empty agent's resting line in Korean to a Korean reader", async () => {
  Object.assign(HOLD, { on: true, reading: 'empty', locale: 'ko-KR' });
  world = await mountWorld(FACTS); await settle();
  const toAgent = face('Held agent');
  expect(toAgent, 'the creature offers no way to take its agent form').toBeTruthy();
  await act(async () => { toAgent!.click(); });
  await settle();
  expect(world.audit().wallKind).toBe('agent');
  expect(bubble()?.querySelector('.jar-char-bubble-reading')?.textContent?.trim()).toBe('아직 아무것도 만들어 내지 못했어요');
});

/* ═══ A FIRST LOAD THAT FINISHES MID-AIM LANDS WHEN THE AIM ENDS ═══════════
   Landing waits for rest, and the only rest it used to hear about was an
   ARRIVAL. Aiming down to the ground and back up stops on the same wall, so
   `atWall` never changes: the reading that came back mid-aim sat pending and
   the wall stayed silent over it (retro review of #436, 2026-10-17). */
type Sim = { toGround(): void; toTop(): void; isResting(): boolean };
const simNow = () => (window as unknown as { wakaSim: () => Sim | null }).wakaSim()!;
/** Let every promise the release set off run to the end, WITHOUT a frame:
    frames only advance through `world.step`, so the camera holds still. */
const flushFetch = async () => {
  await act(async () => { for (let i = 0; i < 20; i += 1) await Promise.resolve(); await vi.advanceTimersByTimeAsync(0); });
};
const reading = () => bubble()?.querySelector('.jar-char-bubble-reading')?.textContent?.trim();
async function standOnHeldAgent() {
  Object.assign(HOLD, { on: true, reading: 'defer' });
  world = await mountWorld(FACTS); await settle();
  await act(async () => { face('Held agent')!.click(); });
  await settle();
  expect(world.audit().wallKind).toBe('agent');
  expect(bubble(), 'the reading was released before the test released it').toBeNull();
  expect(HOLD.release, 'the agent\'s reading was never asked for').toBeTruthy();
}

it("lands an agent's first load that finished while the camera was aiming", async () => {
  await standOnHeldAgent();
  /* `simNow()` at every use, never a held handle: a landing REBUILDS the
     loop, and a handle from before it answers for a world that is gone */
  await act(async () => { simNow().toGround(); });
  await world.step(2);
  expect(simNow().isResting(), 'the aim had already ended — this would test arrival, not rest').toBe(false);
  /* THE FETCH FINISHES MID-AIM, and is seen to: everything it set off has
     run, the camera is still aiming, and the reading is NOT on the wall —
     so what lands it below can only be the aim ending, never the
     fetch-completion path. */
  HOLD.release!();
  await flushFetch();
  expect(simNow().isResting(), 'the aim ended while the fetch was settling').toBe(false);
  expect(reading(), 'the bundle landed mid-aim, rebuilding a moving world').toBeUndefined();
  await settle();
  await act(async () => { simNow().toTop(); });
  await settle();
  expect(world.audit().wallKind, 'the aim crossed walls — this would test arrival, not rest').toBe('agent');
  expect(reading(), 'a first load that finished mid-aim never landed on the wall it was standing on').toBe(AGENT_SAYS);
});

/* ═══ AND A ONE-MILLISECOND AIM STILL ENDS IN A REST ═══════════════════════
   Under reduced motion an aim lasts 1ms: it starts and commits between two
   frames, so a frame-to-frame "was moving, now still" comparison never saw
   it move — and never said it stopped. The latch does. */
it("lands a first load released inside a reduced-motion aim", async () => {
  const original = window.matchMedia;
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: (query: string) => ({
    ...original(query), matches: /prefers-reduced-motion:\s*reduce/.test(query),
  }) });
  try {
    await standOnHeldAgent();
    await act(async () => { simNow().toGround(); });
    expect(simNow().isResting(), 'toGround did not start an aim').toBe(false);
    HOLD.release!();
    await flushFetch();
    expect(reading(), 'the bundle landed before the aim ended').toBeUndefined();
    await world.step(1);
    expect(simNow().isResting(), 'a reduced-motion aim outlived one frame').toBe(true);
    await settle();
    await act(async () => { simNow().toTop(); });
    await world.step(3);
    expect(reading(), 'a 1ms aim never reported its rest').toBe(AGENT_SAYS);
  } finally {
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: original });
  }
});

/* ═══ A HELD FINGER IS NOT REST ════════════════════════════════════════════
   Landing rebuilds the whole simulation, so a first load that came back
   under a held press landed out from under the finger. It waits for the
   release (retro review, 2026-10-17). */
it("holds a first load that finished under a held press until the release", async () => {
  await standOnHeldAgent();
  const canvas = world.container.querySelector('canvas')!;
  const fire = (type: string) => canvas.dispatchEvent(new window.PointerEvent(type,
    { bubbles: true, cancelable: true, pointerId: 9, clientX: 640, clientY: 300, button: 0, buttons: 1 }));
  await act(async () => { fire('pointerdown'); });
  await world.step(2);
  expect(simNow().isResting(), 'the press did not register as held').toBe(false);
  HOLD.release!();
  await flushFetch();
  await world.step(10);
  expect(reading(), 'the bundle landed under a held finger').toBeUndefined();
  await act(async () => { fire('pointercancel'); });
  await settle();
  expect(reading(), 'the first load never landed once the press let go').toBe(AGENT_SAYS);
});

/* ═══ A REFRESH STILL WAITS FOR AN ARRIVAL ═════════════════════════════════
   Only a FIRST load lands at rest. An agent already on its wall has a
   reading to stand on, and a refresh landing at every stop would rebuild
   the world each time you looked down and back. */
it("never lands a refresh at rest, only at the next arrival", async () => {
  Object.assign(HOLD, { on: true, reading: 'board' });
  world = await mountWorld(FACTS); await settle();
  await world.travelTo(/agent-held/);
  await settle();
  expect(reading(), 'the first load did not land').toBe(AGENT_SAYS);
  const LATER = 'A refreshed thought that must wait for an arrival.';
  Object.assign(HOLD, { reading: 'defer', deferSays: LATER, release: null });
  await world.travelTo(/Me/);
  /* past the refresh throttle, so the next approach refetches */
  const clockNow = Date.now;
  Date.now = () => clockNow() + 61_000;
  try {
    await world.travelTo(/agent-held/);
    await settle();
    expect(HOLD.release, 'the approach did not refresh the agent').toBeTruthy();
    HOLD.release!();
    await flushFetch();
    await act(async () => { simNow().toGround(); });
    await settle();
    await act(async () => { simNow().toTop(); });
    await settle();
    expect(world.audit().wallKind).toBe('agent');
    expect(reading(), 'a refresh landed at rest rather than at arrival').toBe(AGENT_SAYS);
  } finally {
    Date.now = clockNow;
  }
});

/* ═══ A PRESS ENDS ON THE PLATFORM'S WORD, NEVER ON A CLOCK ═══════════════
   A pointerup the browser swallowed left `down` true, nothing could ever be
   at rest, and the first load waited under it for the whole session. A
   timeout fixed that and broke a still hold — a finger held ten seconds had
   the world snapped out from under it. So a press ends only on evidence it
   is gone: a lost capture, or a mouse moving with no button held (retro
   review, 2026-10-17). */
/** The world's root — the element that holds the pointer capture. */
const worldRoot = () => world.container.querySelector<HTMLElement>('.jar')!;
const press = (type: string, init: PointerEventInit = {}, at?: Element) => {
  const target = at ?? world.container.querySelector('canvas')!;
  target.dispatchEvent(new window.PointerEvent(type,
    { bubbles: true, cancelable: true, pointerId: 11, pointerType: 'mouse', clientX: 640, clientY: 300, button: 0, buttons: 1, ...init }));
};
async function heldWithReadingBack() {
  await standOnHeldAgent();
  await act(async () => { press('pointerdown'); });
  HOLD.release!();
  await flushFetch();
  await world.step(60);
  expect(reading(), 'the bundle landed under a held press').toBeUndefined();
}

it("keeps a still hold of fifteen seconds held — no drop, no snap, no landing", async () => {
  await heldWithReadingBack();
  const camY = world.audit().camY;
  await world.step(Math.ceil(15_000 / 16.7));
  expect(simNow().isResting(), 'a genuine still hold was dropped on a clock').toBe(false);
  expect(world.audit().camY, 'the world moved under a held finger').toBe(camY);
  expect(reading(), 'the bundle landed under a held press').toBeUndefined();
  await act(async () => { press('pointerup', { buttons: 0 }); });
  await settle();
  expect(reading(), 'the release did not land the first load').toBe(AGENT_SAYS);
});

it("ends a press whose capture was lost, and lands what waited under it", async () => {
  await heldWithReadingBack();
  await act(async () => { press('lostpointercapture', { buttons: 0 }, worldRoot()); });
  await settle();
  expect(simNow().isResting(), 'a lost capture left the press held').toBe(true);
  expect(reading(), 'a lost capture stranded the first load').toBe(AGENT_SAYS);
});

/* ═══ BUT ONLY THE WORLD'S OWN CAPTURE ═════════════════════════════════════
   `lostpointercapture` bubbles. A control inside the world letting go of a
   pointer it captured is not the world losing its press. */
it("keeps the press held when a descendant, not the root, loses a capture", async () => {
  await heldWithReadingBack();
  await act(async () => { press('lostpointercapture', { buttons: 0 }); });
  await world.step(30);
  expect(simNow().isResting(), 'a descendant\'s lost capture dropped the world\'s press').toBe(false);
  expect(reading(), 'the bundle landed under a held press').toBeUndefined();
});

it("ends a mouse press whose button is already up when it moves", async () => {
  await heldWithReadingBack();
  await act(async () => { press('pointermove', { buttons: 0, clientX: 700 }); });
  await settle();
  expect(simNow().isResting(), 'a buttonless hover kept the press held').toBe(true);
  expect(reading(), 'a lost mouseup stranded the first load').toBe(AGENT_SAYS);
});

/* ═══ A REBUILD DOES NOT INHERIT A PRESS ═══════════════════════════════════
   A held press used to be carried into the next build. When a build in
   between returned early, the finger's pointerup reached no listener, and
   the next build restored `down` and an owner that never let go: every new
   touch was refused as a second finger and nothing was at rest again (code
   review, 2026-10-17). Here a rebuild lands under a held touch whose
   release never comes; the next touch must still be the world's. */
it("starts a rebuild with no press held, so the next touch is accepted and rest returns", async () => {
  Object.assign(HOLD, { on: true, reading: 'board' });
  world = await mountWorld(FACTS); await settle();
  const touch = (type: string, pointerId: number) => act(async () => {
    world.container.querySelector('canvas')!.dispatchEvent(new window.PointerEvent(type,
      { bubbles: true, cancelable: true, pointerId, pointerType: 'touch', clientX: 640, clientY: 300, button: 0, buttons: type === 'pointerup' ? 0 : 1 }));
  });
  await touch('pointerdown', 21);
  expect(simNow().isResting(), 'the first touch did not register as held').toBe(false);
  const before = simNow();
  /* the arrival lands the agent's first load, and landing rebuilds the loop
     — under a touch whose pointerup never arrives */
  await world.travelTo(/agent-held/);
  await settle();
  expect(reading(), 'the first load did not land, so nothing was rebuilt').toBe(AGENT_SAYS);
  expect(simNow(), 'the loop was not rebuilt').not.toBe(before);
  expect(simNow().isResting(), 'the rebuilt loop inherited a press nobody can release').toBe(true);
  await touch('pointerdown', 22);
  expect(simNow().isResting(), 'a new touch was refused as a second finger').toBe(false);
  await touch('pointerup', 22);
  await settle();
  expect(simNow().isResting(), 'rest never came back after the new touch').toBe(true);
});


it('shows every named agent, keeps their memory separate, and syncs Settings changes without reloading', async () => {
  PROFILES.rows = ['noah', 'another'].map((name, i) => ({
    id: `agent-${name}`, accountId: 'account-1', name, type: 'agent', avatarUrl: null,
    preferredLocale: 'en-US', createdAt: `2026-10-0${i + 1}T00:00:00Z`,
  }));
  world = await mountWorld(FACTS); await settle();
  expect([...world.container.querySelectorAll('.jar-char-face')].map(node => node.textContent)).toEqual(['Me', 'noah', 'another']);
  for (const [name, says] of [['noah', NOAH_SAYS], ['another', ANOTHER_SAYS]]) {
    await act(async () => { face(name)!.click(); }); await settle();
    expect(world.audit().wallId).toBe(`agent-${name}`);
    expect(face(name)?.getAttribute('aria-pressed')).toBe('true');
    expect(face(name === 'noah' ? 'another' : 'noah')?.getAttribute('aria-pressed')).toBe('false');
    expect(reading()).toBe(says);
    expect(bubble()?.textContent).not.toContain(OWNER_SAYS);
  }

  await act(async () => { world.container.querySelector<HTMLButtonElement>('.waka-corner--settings')!.click(); });
  await act(async () => { world.container.querySelector<HTMLButtonElement>('[data-settings-target="agents"]')!.click(); });
  const type = (input: HTMLInputElement, value: string) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  await act(async () => { type(world.container.querySelector<HTMLInputElement>('.waka-settings-add input')!, 'third'); });
  await act(async () => { world.container.querySelector<HTMLButtonElement>('.waka-settings-add button')!.click(); });
  await settle();
  expect(face('third')).toBeTruthy();
  expect(world.audit().wallId).toBe('agent-another');

  expect(world.container.querySelector('.waka-settings-heading h2')?.textContent).toBe('third');
  await act(async () => world.container.querySelector<HTMLButtonElement>('[aria-label="Back to agent profiles"]')!.click());
  await act(async () => world.container.querySelector<HTMLButtonElement>('[data-agent-id="agent-another"]')!.click());
  const another = world.container.querySelector<HTMLInputElement>('.waka-agent-details input')!;
  await act(async () => { another.focus(); type(another, 'renamed'); another.blur(); });
  await settle();
  expect(face('another')).toBeUndefined();
  expect(face('renamed')?.getAttribute('aria-pressed')).toBe('true');
  expect(world.audit().wallId).toBe('agent-another');

  await act(async () => world.container.querySelector<HTMLButtonElement>('[aria-label="Back to agent profiles"]')!.click());
  const erase = async (name: string) => {
    await act(async () => world.container.querySelector<HTMLButtonElement>(`[aria-label="Settings for ${name}"]`)!.click());
    const button = world.container.querySelector<HTMLButtonElement>('[data-agent-delete]')!;
    await act(async () => { button.click(); });
    const confirm = [...world.container.querySelectorAll<HTMLButtonElement>('.waka-settings-danger button')].find(node => node.textContent === 'Delete profile and memory')!;
    await act(async () => { confirm.click(); });
    await settle();
  };
  await erase('noah');
  expect(face('noah')).toBeUndefined();
  expect(world.audit().wallId, 'deleting another profile must not switch the selected agent when columns move').toBe('agent-another');
  expect(reading()).toBe(ANOTHER_SAYS);
  await erase('renamed');
  expect(face('renamed')).toBeUndefined();
  expect(world.audit().wallKind).toBe('self');
  expect(face('Me')?.getAttribute('aria-pressed')).toBe('true');
  expect(reading()).toBe(OWNER_SAYS);
});


it('isolates each agent’s inspirations, chat list, transcript, and chat URL', async () => {
  PROFILES.rows = ['noah','another'].map((name,i)=>({id:`agent-${name}`,accountId:'account-1',name,type:'agent',avatarUrl:null,preferredLocale:'en-US',createdAt:`2026-10-0${i+1}T00:00:00Z`}));
  let location:ReturnType<typeof useLocation>;
  function LocationProbe(){location=useLocation();return null;}
  world = await mountWorld(FACTS,{routerTools:<LocationProbe/>}); await settle();
  const type=(field:HTMLTextAreaElement,value:string)=>{
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(field,value);
    field.dispatchEvent(new Event('input',{bubbles:true}));
  };
  for(const name of ['noah','another']){
    await act(async()=>face(name)!.click()); await settle();
    await chooseFromMenu(world.container,'Inspirations'); await settle();
    const archive=world.container.querySelector('.waka-over[data-jar-surface]')!;
    expect(archive.textContent).toContain(`Only agent-${name} kept this`);
    expect(archive.textContent).not.toContain(`Only agent-${name==='noah'?'another':'noah'} kept this`);
    await closeOverlay(world.container); await settle();
    expect(world.audit().wallId, 'closing inspirations must preserve its agent').toBe(`agent-${name}`);
    await pressDockRow(world.container, 'New chat'); await settle();
    expect(new URLSearchParams(location!.search).get('profile')).toBe(`agent-${name}`);
    expect(world.container.querySelector('.chat-profile')?.textContent).toContain(name);
    expect(world.container.querySelector('.chat-with')).toBeNull();
    expect(listConversations).toHaveBeenLastCalledWith(`agent-${name}`,expect.any(AbortSignal));
    expect(world.container.querySelector('.chat-transcript')?.textContent).not.toContain('Only noah chat');
    await act(async()=>type(world.container.querySelector('.chat-input-label textarea')!,'Only '+name+' chat'));
    await act(async()=>world.container.querySelector<HTMLButtonElement>('.chat-send')!.click()); await settle();
    expect(vi.mocked(createConversation).mock.calls.at(-1)?.[0]).toBe(`agent-${name}`);
    expect(world.container.querySelector('.chat-transcript')?.textContent).toContain('Only '+name+' chat');
    expect(new URLSearchParams(location!.search).get('profile')).toBe(`agent-${name}`);
    await pressDockRow(world.container, 'All chats'); await settle();
    expect(listConversations).toHaveBeenLastCalledWith(`agent-${name}`,expect.any(AbortSignal));
    const list=world.container.querySelector('.waka-over[data-jar-surface]')!;
    expect(list.textContent).toContain('Only '+name+' chat');
    expect(list.textContent).not.toContain('Only '+(name==='noah'?'another':'noah')+' chat');
    await closeOverlay(world.container); await settle();
  }
  expect(CHATS.rows.map(row=>({profile:row.profileId,text:row.messages[0].content}))).toEqual([
    {profile:'agent-noah',text:'Only noah chat'}, {profile:'agent-another',text:'Only another chat'},
  ]);
  world.unmount(); vi.mocked(listConversations).mockClear();
  world=await mountWorld(FACTS,{initialEntries:[`/chat/${CHATS.rows[0].id}?profile=agent-noah`]}); await settle();
  expect(world.audit().wallId).toBe('agent-noah');
  expect(world.container.querySelector('.chat-transcript')?.textContent).toContain('Only noah chat');
  expect(world.container.querySelector('.chat-transcript')?.textContent).not.toContain('Only another chat');
  expect(vi.mocked(listConversations).mock.calls.every(([profile])=>profile==='agent-noah')).toBe(true);

});

it('saves a capture into the selected agent without adding it to the human or another agent', async () => {
  PROFILES.rows = ['noah','another'].map((name,i)=>({id:`agent-${name}`,accountId:'account-1',name,type:'agent',avatarUrl:null,preferredLocale:'en-US',createdAt:`2026-10-0${i+1}T00:00:00Z`}));
  world=await mountWorld(FACTS); await settle();
  await act(async()=>face('noah')!.click()); await settle();
  await pressDockRow(world.container,'Inspirations'); await settle();
  const newNote=world.container.querySelector<HTMLButtonElement>('.waka-over-head .waka-over-new')!;
  expect(newNote.textContent).toBe('New inspiration');
  await act(async()=>newNote.click()); await settle();
  const area=world.container.querySelector<HTMLTextAreaElement>('textarea.jar-composer-text')!;
  await act(async()=>{
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(area,'A new Noah observation');
    area.dispatchEvent(new Event('input',{bubbles:true}));
  });
  await act(async()=>world.container.querySelector<HTMLButtonElement>('button[aria-label="Save inspiration"]')!.click()); await settle();
  expect(createInspiration).toHaveBeenCalledWith(expect.objectContaining({text:'A new Noah observation'}),expect.objectContaining({profile:'agent-noah'}));
  expect(CAPTURES.rows.map(row=>row.profileId)).toEqual(['agent-noah']);
  await chooseFromMenu(world.container,'Inspirations'); await settle();
  expect(world.container.querySelector('.waka-over[data-jar-surface]')?.textContent).toContain('A new Noah observation');
  await closeOverlay(world.container); await settle();
  for(const name of ['another','Me']){
    await act(async()=>face(name)!.click()); await settle();
    await chooseFromMenu(world.container,'Inspirations'); await settle();
    expect(world.container.querySelector('.waka-over[data-jar-surface]')?.textContent).not.toContain('A new Noah observation');
    await closeOverlay(world.container); await settle();
  }
});


it('keeps agent principle detail, curation, and share cards bound to their profile', async () => {
  PROFILES.rows = ['noah','another'].map((name,i)=>({id:`agent-${name}`,accountId:'account-1',name,type:'agent',avatarUrl:null,preferredLocale:'en-US',createdAt:`2026-10-0${i+1}T00:00:00Z`}));
  const rows = ['first','second'].map((id,rank)=>({id,statement:`Noah principle ${id}`,statementRevision:'1',type:'maxim' as const,state:'held' as const,origin:'minted' as const,rank,locked:false,heldSince:null,conflictsWithId:null,citedSignals:[],createdAt:'2026-10-22T00:00:00Z'}));
  vi.mocked(fetchPrincipleRead).mockImplementation(async profile=>({principles:profile==='agent-noah'?rows:[],status:{phase:'ready',eligible:false,signalCount:0,topOfMindCount:0}}));
  vi.mocked(fetchPrinciples).mockImplementation(async options=>options?.profile==='agent-noah'?rows:[]);
  vi.mocked(updatePrinciple).mockImplementation(async(id,statement)=>{const row=rows.find(row=>row.id===id)!;Object.assign(row,{statement,locked:true});return row;});
  let location:ReturnType<typeof useLocation>;
  function LocationProbe(){location=useLocation();return null;}
  world=await mountWorld(FACTS,{initialEntries:['/principles/first?profile=agent-noah'],routerTools:<LocationProbe/>});await settle();
  expect(location!.pathname).toBe('/principles/first');
  expect(new URLSearchParams(location!.search).get('profile')).toBe('agent-noah');
  expect(world.container.querySelector('.jar-principles-list')?.textContent).toContain('Noah principle first');
  const edit=world.container.querySelector<HTMLButtonElement>('button[aria-label="Edit wording"]')!;
  await act(async()=>edit.click());
  await act(async()=>{
    const area=world.container.querySelector<HTMLTextAreaElement>('textarea[aria-label="This principle in your own words"]')!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(area,'Noah corrected words');
    area.dispatchEvent(new Event('input',{bubbles:true}));
  });
  await act(async()=>[...world.container.querySelectorAll<HTMLButtonElement>('.jar-ask button')].find(button=>button.textContent==='Save')!.click());await settle();
  expect(updatePrinciple).toHaveBeenLastCalledWith('first','Noah corrected words',expect.objectContaining({profile:'agent-noah',expectedStatementRevision:'1'}));
  await act(async()=>[...world.container.querySelectorAll<HTMLButtonElement>('.jar-principle-actions button')].find(button=>button.textContent==='Make a share card')!.click());await settle();
  expect(location!.pathname).toBe('/principles/first/share');
  expect(world.container.querySelector('.jar-share-name')?.textContent).toContain('noah');
  expect(world.container.querySelector('.jar-share-name')?.textContent).not.toContain('You');
  const choose=[...world.container.querySelectorAll<HTMLSelectElement>('select')].find(select=>[...select.options].some(option=>option.value==='second'))!;
  await act(async()=>{choose.value='second';choose.dispatchEvent(new Event('change',{bubbles:true}));});await settle();
  expect(location!.pathname).toBe('/principles/second/share');
  expect(new URLSearchParams(location!.search).get('profile')).toBe('agent-noah');
  expect(world.container.querySelector('.jar-share-name')?.textContent).toContain('noah');
  world.unmount();
  world=await mountWorld(FACTS,{initialEntries:['/chat/new?profile=agent-noah&principle=first'],routerTools:<LocationProbe/>});await settle();
  expect(location!.pathname).toBe('/chat/new');
  expect(new URLSearchParams(location!.search).get('profile')).toBe('agent-noah');
  expect(new URLSearchParams(location!.search).get('principle')).toBe('first');
  vi.mocked(fetchPrincipleRead).mockResolvedValue({principles:[],status:{phase:'ready',eligible:false,signalCount:0,topOfMindCount:0}});
  vi.mocked(fetchPrinciples).mockResolvedValue([]);
});
