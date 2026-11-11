// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY (gate G6): `lib/data` and `lib/api` supply profile-scoped synthetic reads; `lib/auth-context` supplies the human identity. `helpers/canvas-stub` and `helpers/render-home` replace canvas, viewport, clock and randomness. The real Home, router, draft scopes and shared simulation run. */
/** The real Home/router/simulation must never select or read retained agent stacks. */
import {act} from 'react';import {useLocation} from 'react-router-dom';
import {afterEach,beforeAll,beforeEach,expect,it,vi} from 'vitest';
import {installCanvasStub,setViewport} from './helpers/canvas-stub';
import {mountWorld,dataMockFrom,apiMockFrom,VIEWER_ID,type MountedWorld} from './helpers/render-home';
import {loadInspirations,loadTopOfMind,loadSignals} from '../src/lib/data';
import {fetchProfiles} from '../src/lib/api';
const facts=vi.hoisted(()=>({inspirations:[{id:'owned-note',text:'My unchanged words',daysAgo:1}]}));
const legacy=vi.hoisted(()=>({count:0}));
vi.mock('../src/lib/data',async original=>({...await original<typeof import('../src/lib/data')>(),...Object.fromEntries(Object.entries(dataMockFrom(facts)).map(([key,value])=>[key,vi.fn(value)]))}));
vi.mock('../src/lib/api',async original=>({...await original<typeof import('../src/lib/api')>(),...apiMockFrom(facts),fetchProfiles:vi.fn(async()=>Array.from({length:legacy.count},(_,i)=>({id:`agent-${i}`,type:'agent',name:`Legacy ${i}`})))}));
vi.mock('../src/lib/auth-context',async original=>{const session={account:{id:'account-1',email:'local@example.test'},profile:{id:VIEWER_ID,accountId:'account-1',type:'human',name:'Owner',preferredLocale:'en-US'},updateProfile:vi.fn(),updatePreferredLocale:vi.fn(),logout:vi.fn()};return {...await original<typeof import('../src/lib/auth-context')>(),useOptionalAuth:()=>session,useAuth:()=>session};});
let world:MountedWorld;
function Address(){const l=useLocation();return <output data-address>{l.pathname+l.search}</output>;}
beforeAll(()=>{globalThis.IS_REACT_ACT_ENVIRONMENT=true;installCanvasStub();setViewport(390,844);});
beforeEach(()=>{localStorage.clear();vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});});
afterEach(()=>{world?.unmount();vi.useRealTimers();vi.clearAllMocks();});
async function settle(){for(let i=0;i<12;i++){await world.step(100);await act(async()=>vi.advanceTimersByTimeAsync(100));}}
it.each([0,1,3])('shows one WAKA Home with %i retained legacy stacks',async count=>{
 legacy.count=count;world=await mountWorld(facts);await settle();expect(fetchProfiles).not.toHaveBeenCalled();expect(world.container.querySelector('[aria-haspopup="menu"]')).toBeNull();expect(world.container.textContent).not.toMatch(/Legacy|Switch between|Connect this agent/);
 for(const call of [...vi.mocked(loadInspirations).mock.calls,...vi.mocked(loadTopOfMind).mock.calls,...vi.mocked(loadSignals).mock.calls])expect(call[0]??VIEWER_ID).toBe(VIEWER_ID);
});
it.each(['/w/agent-0?compose=1','/chat/new?profile=agent-1','/principles/old?profile=agent-2'])('returns a retired profile link to human Home: %s',async address=>{
 legacy.count=3;world=await mountWorld(facts,{initialEntries:[address],routerTools:<Address/>});await settle();expect(world.container.querySelector('[data-address]')?.textContent).toBe('/');expect(world.container.querySelector('.jar-composer-text')).toBeNull();expect(fetchProfiles).not.toHaveBeenCalled();
 for(const call of [...vi.mocked(loadInspirations).mock.calls,...vi.mocked(loadTopOfMind).mock.calls])expect(call[0]??VIEWER_ID).toBe(VIEWER_ID);
});
