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
const facts={inspirations:Array.from({length:40},(_,i)=>({id:`source-${i}`,text:`Synthetic source ${i}`,daysAgo:i})),groups:Array.from({length:12},(_,i)=>({id:`room-${i}`,name:`Synthetic room ${i}`,memberCount:1}))};
const detail=vi.fn(),signalDetail=vi.fn(),wall=vi.fn(async()=>[]),proposals=vi.fn(async()=>[]);
vi.mock('../src/lib/api',async original=>({...await original<typeof import('../src/lib/api')>(),...apiMockFrom(facts),fetchGroupWall:wall,fetchGroupProposals:proposals}));
vi.mock('../src/lib/auth-context',async original=>({...await original<typeof import('../src/lib/auth-context')>(),useOptionalAuth:()=>({status:'authenticated',account:{id:'owner',email:'owner@example.test'},profile:{id:VIEWER_ID,name:'Owner',type:'human'},profiles:[]})}));
vi.mock('../src/lib/data',async original=>({...await original<typeof import('../src/lib/data')>(),...dataMockFrom(facts),
  loadSignals:async()=>Array.from({length:64},(_,i)=>({id:`signal-${i}`,inspirationIds:['source-0'],statement:`Synthetic pattern ${i}`,status:'active',confidence:50,evidenceCount:1,lastEvidenceMs:1,createdMs:1,locked:false,unsupported:false,sharedGroupIds:[]})),
  loadSignal:signalDetail,loadInspiration:detail,
}));
let world:MountedWorld;
beforeAll(()=>{installCanvasStub();setViewport(1280,900);(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;});
beforeEach(()=>vi.useFakeTimers({toFake:['Date','setTimeout','clearTimeout']}));
afterEach(async()=>{await world?.unmount();vi.useRealTimers();vi.clearAllMocks();});
it('does not warm all originals, unrelated signals or room contents just by opening Home',async()=>{
  world=await mountWorld(facts);await act(async()=>vi.advanceTimersByTimeAsync(5000));
  expect(detail).not.toHaveBeenCalled();expect(signalDetail).not.toHaveBeenCalled();expect(wall).not.toHaveBeenCalled();expect(proposals).not.toHaveBeenCalled();
  expect(world.container.querySelector('.waka-corners')).not.toBeNull();
});
