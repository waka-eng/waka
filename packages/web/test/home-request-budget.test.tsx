// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY: `lib/api` supplies fixture room/roster reads,
 * `lib/data` supplies synthetic summaries and `lib/auth-context` the principal.
 * Real Home loading, scene and click behavior run through `helpers/render-home`
 * and `helpers/canvas-stub`; the latter
 * replace drawing/time, not request scheduling or source dependencies. */
import {act} from 'react';
import {afterEach,beforeAll,beforeEach,expect,it,vi} from 'vitest';
import {installCanvasStub,setViewport} from './helpers/canvas-stub';
import {apiMockFrom,dataMockFrom,mountWorld,VIEWER_ID,type MountedWorld} from './helpers/render-home';
const facts={inspirations:Array.from({length:40},(_,i)=>({id:`source-${i}`,text:`Synthetic source ${i}`,daysAgo:i}))};
/* `wall` AND `proposals` WENT (2026-10-15). They stubbed `fetchGroupWall`
   and `fetchGroupProposals`, which no longer exist, so the mock replaced
   nothing and the two `not.toHaveBeenCalled()` assertions below could not
   fail. `tsconfig` omits `test/`, which is why nothing flagged a mock key
   naming a deleted export. */
const detail=vi.fn(),signalDetail=vi.fn();
vi.mock('../src/lib/api',async original=>({...await original<typeof import('../src/lib/api')>(),...apiMockFrom(facts)}));
vi.mock('../src/lib/auth-context',async original=>({...await original<typeof import('../src/lib/auth-context')>(),useOptionalAuth:()=>({status:'authenticated',account:{id:'owner',email:'owner@example.test'},profile:{id:VIEWER_ID,name:'Owner',type:'human'},profiles:[]})}));
vi.mock('../src/lib/data',async original=>({...await original<typeof import('../src/lib/data')>(),...dataMockFrom(facts),
  loadSignals:async()=>Array.from({length:64},(_,i)=>({id:`signal-${i}`,inspirationIds:['source-0'],statement:`Synthetic pattern ${i}`,status:'active',confidence:50,evidenceCount:1,lastEvidenceMs:1,createdMs:1,locked:false,unsupported:false})),
  loadSignal:signalDetail,loadInspiration:detail,
}));
let world:MountedWorld;
beforeAll(()=>{installCanvasStub();setViewport(1280,900);(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;});
beforeEach(()=>vi.useFakeTimers({toFake:['Date','setTimeout','clearTimeout']}));
afterEach(async()=>{await world?.unmount();vi.useRealTimers();vi.clearAllMocks();});
it('does not warm all originals or unrelated signals just by opening Home',async()=>{
  world=await mountWorld(facts);await act(async()=>vi.advanceTimersByTimeAsync(5000));
  expect(detail).not.toHaveBeenCalled();expect(signalDetail).not.toHaveBeenCalled();
  expect(world.container.querySelector('.waka-corners')).not.toBeNull();
});
