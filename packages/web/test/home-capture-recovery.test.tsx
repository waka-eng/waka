// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY (gate G6): `lib/api` is the save transport;
 * `lib/data` supplies an empty owned archive; `lib/auth-context` identifies
 * the viewer. `lib/inspiration-draft-store` only pauses settlement before
 * calling the real store, exposing asynchronous storage boundaries.
 * fake-indexeddb replaces `indexedDB`; `Blob` uses cloneable Node bytes.
 * `helpers/canvas-stub` and
 * `helpers/render-home` replace drawing/time, not saving or draft recovery. */
import {act} from 'react';
import {Blob} from 'node:buffer';
import {IDBFactory} from 'fake-indexeddb';
import {afterEach,beforeAll,beforeEach,expect,it,vi} from 'vitest';
import {installCanvasStub,setViewport} from './helpers/canvas-stub';
import {apiMockFrom,dataMockFrom,mountWorld,VIEWER_ID,type MountedWorld} from './helpers/render-home';
import {ApiError,createInspiration,fetchInspiration,fetchInspirationSaveRequest,presignAttachment,uploadToPresignedUrl,type ApiInspiration} from '../src/lib/api';
import {loadInspirationDraft,newInspirationDraft,writeInspirationDraft} from '../src/lib/inspiration-draft-store';
import {profileStorageKey} from '../src/lib/profile-storage';

const facts=vi.hoisted(()=>({inspirations:[]}));
const storage=vi.hoisted(()=>({hold:null as Promise<void>|null,entered:false,writeHold:null as Promise<void>|null,writeEntered:false}));
vi.mock('../src/lib/data',async original=>({...await original<typeof import('../src/lib/data')>(),...dataMockFrom(facts)}));
vi.mock('../src/lib/api',async original=>({...await original<typeof import('../src/lib/api')>(),...apiMockFrom(facts),
  fetchInspirationSaveRequest:vi.fn(async()=>{throw new ApiError({status:404,code:'save_not_found',message:'No committed save'});}),
  createInspiration:vi.fn(),fetchInspiration:vi.fn(),presignAttachment:vi.fn(),uploadToPresignedUrl:vi.fn(),fetchPrincipleStatus:vi.fn(async()=>({phase:'ready',eligible:false,signalCount:0,topOfMindCount:0,readingPaused:false})),
}));
vi.mock('../src/lib/auth-context',async original=>{
  const session={status:'authenticated',account:{id:'capture-owner',email:'capture@example.test'},
    profile:{id:VIEWER_ID,name:'Owner',type:'human'},profiles:[],refresh:async()=>{},signOut:async()=>{}};
  return {...await original<typeof import('../src/lib/auth-context')>(),useOptionalAuth:()=>session,useAuth:()=>session};
});
vi.mock('../src/lib/inspiration-draft-store',async original=>{
  const actual=await original<typeof import('../src/lib/inspiration-draft-store')>();
  return {...actual,writeInspirationDraft:async(...args:Parameters<typeof actual.writeInspirationDraft>)=>{
    storage.writeEntered=true;await storage.writeHold;return actual.writeInspirationDraft(...args);
  },settleInspirationMediaDraft:async(...args:Parameters<typeof actual.settleInspirationMediaDraft>)=>{
    storage.entered=true;await storage.hold;return actual.settleInspirationMediaDraft(...args);
  }};
});
const scope={accountId:'capture-owner',profileId:VIEWER_ID};
let world:MountedWorld|undefined;
const field=()=>world!.container.querySelector<HTMLTextAreaElement>('textarea.jar-composer-text')!;
const save=()=>document.querySelector<HTMLButtonElement>('[aria-label="Save inspiration"]')!;
const journals=()=>Object.keys(localStorage).filter(key=>key.includes(':pendingSave:'));
async function type(text:string){await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(field(),text);field().dispatchEvent(new Event('input',{bubbles:true}));});}
beforeAll(()=>{installCanvasStub();setViewport(1280,900);(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;});
beforeEach(()=>{
  vi.stubGlobal('indexedDB',new IDBFactory());vi.stubGlobal('Blob',Blob);localStorage.clear();sessionStorage.clear();storage.hold=null;storage.entered=false;storage.writeHold=null;storage.writeEntered=false;
  vi.mocked(presignAttachment).mockReset().mockImplementation(async input=>({profileId:VIEWER_ID,key:`objects/${input.filename}`,uploadUrl:'https://objects.test/upload',expiresAt:'',headers:{'Content-Type':input.contentType,'Content-Length':String(input.size)}}));
  vi.mocked(uploadToPresignedUrl).mockReset().mockResolvedValue(undefined);
  vi.mocked(fetchInspirationSaveRequest).mockReset().mockRejectedValue(new ApiError({status:404,code:'save_not_found',message:'No committed save'}));
  vi.mocked(createInspiration).mockReset().mockImplementation(async input=>({id:'saved-one',profileId:VIEWER_ID,text:input.text,
    kind:'note',source:'app',visibility:'private',category:null,experienceId:null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),attachments:[],reflections:[]} as ApiInspiration));
  vi.mocked(fetchInspiration).mockReset().mockResolvedValue({id:'saved-one',profileId:VIEWER_ID,text:'A deliberate capture.',kind:'note',source:'app',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),attachments:[],reflections:[]});
});
afterEach(()=>{world?.unmount();world=undefined;vi.unstubAllGlobals();vi.useRealTimers();});
async function open(text:string){
  world=await mountWorld(facts,{initialEntries:['/?compose=1']});
  await vi.waitFor(async()=>{await act(async()=>{});expect(field()).toBeTruthy();});
  await type(text);
  await vi.waitFor(async()=>{await act(async()=>{});expect(save()?.disabled).toBe(false);});
}

async function seedFile(uploaded=false){
  const draft={...newInspirationDraft(),revision:1,media:[{id:'source-file',type:'file' as const,name:'source.pdf',blob:new Blob(['source'],{type:'application/pdf'}),
    ...(uploaded?{uploaded:{key:'objects/source.pdf',contentType:'application/pdf',size:6}}:{})}]};
  await writeInspirationDraft(scope,draft,0);
}

it('settles a normal file save after making its upload receipt durable',async()=>{
  await seedFile();await open('A deliberate capture.');
  await act(async()=>save().click());
  await vi.waitFor(async()=>{await act(async()=>{});expect(createInspiration).toHaveBeenCalledOnce();expect(journals()).toHaveLength(0);});
  expect(vi.mocked(createInspiration).mock.calls[0]?.[0]).toMatchObject({text:'A deliberate capture.',attachments:[{type:'file',key:'objects/source.pdf',name:'source.pdf'}]});
  expect(await loadInspirationDraft(scope)).toBeNull();expect(uploadToPresignedUrl).toHaveBeenCalledOnce();
});

it('keeps newer identical words edited during upload, without retaining an already-saved object in the next draft',async()=>{
  let finish!:()=>void;vi.mocked(uploadToPresignedUrl).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  await seedFile();await open('A deliberate capture.');await act(async()=>save().click());
  await vi.waitFor(()=>expect(uploadToPresignedUrl).toHaveBeenCalledOnce());
  await type('A newer version.');await type('A deliberate capture.');
  await act(async()=>finish());
  await vi.waitFor(async()=>{await act(async()=>{});expect(createInspiration).toHaveBeenCalledOnce();expect(journals()).toHaveLength(0);});
  expect(field()?.value).toBe('A deliberate capture.');
  expect(await loadInspirationDraft(scope)).toMatchObject({text:'A deliberate capture.',media:[]});
});

it('removes only confirmed uploaded objects from newer words edited while the save response is pending',async()=>{
  let finish!:(value:ApiInspiration)=>void;vi.mocked(createInspiration).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  await seedFile(true);await open('A deliberate capture.');await act(async()=>save().click());
  await vi.waitFor(()=>expect(createInspiration).toHaveBeenCalledOnce());await type('The next inspiration.');
  await act(async()=>finish({id:'saved-one',profileId:VIEWER_ID,text:'A deliberate capture.',kind:'note',source:'app',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),attachments:[],reflections:[]}));
  await vi.waitFor(async()=>{await act(async()=>{});expect(journals()).toHaveLength(0);});
  expect(field()?.value).toBe('The next inspiration.');
  expect(await loadInspirationDraft(scope)).toMatchObject({text:'The next inspiration.',media:[]});
  expect(uploadToPresignedUrl).not.toHaveBeenCalled();
});

it('also removes consumed file receipts when newer words arrive during asynchronous cleanup',async()=>{
  let release!:()=>void;storage.hold=new Promise(resolve=>{release=resolve;});
  await seedFile(true);await open('A deliberate capture.');await act(async()=>save().click());
  await vi.waitFor(()=>expect(storage.entered).toBe(true));await type('Words written during cleanup.');
  await act(async()=>release());
  await vi.waitFor(async()=>{await act(async()=>{});expect(journals()).toHaveLength(0);});
  expect(await loadInspirationDraft(scope)).toMatchObject({text:'Words written during cleanup.',media:[]});
});

it('recovers a partial upload after remount and retries a lost save response with the same complete manifest',async()=>{
  const draft={...newInspirationDraft(),revision:1,media:['one','two'].map(id=>({id,type:'file' as const,name:`${id}.pdf`,blob:new Blob([id],{type:'application/pdf'})}))};
  await writeInspirationDraft(scope,draft,0);
  vi.mocked(uploadToPresignedUrl).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Offline'));
  await open('Both sources belong together.');await act(async()=>save().click());
  await vi.waitFor(async()=>expect((await loadInspirationDraft(scope))?.media[1]?.uploadError).toBeTruthy());
  const recovered=await loadInspirationDraft(scope);
  expect(recovered?.media[0]?.uploaded?.key).toBe('objects/one.pdf');
  expect(await recovered?.media[1]?.blob?.text()).toBe('two');expect(createInspiration).not.toHaveBeenCalled();
  world!.unmount();world=undefined;
  vi.mocked(createInspiration).mockRejectedValueOnce(new Error('Lost save response'));
  await open('Both sources belong together.');await act(async()=>save().click());
  await vi.waitFor(()=>expect([...document.querySelectorAll('button')].some(button=>button.textContent==='Try again')).toBe(true));
  expect(journals()).toHaveLength(1);
  await act(async()=>[...document.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent==='Try again')!.click());
  await vi.waitFor(async()=>{await act(async()=>{});expect(createInspiration).toHaveBeenCalledTimes(2);expect(journals()).toHaveLength(0);});
  expect(vi.mocked(presignAttachment).mock.calls.map(call=>call[0].filename)).toEqual(['one.pdf','two.pdf','two.pdf']);
  const [first,second]=vi.mocked(createInspiration).mock.calls;
  expect(first?.[0]).toMatchObject({attachments:[{key:'objects/one.pdf'},{key:'objects/two.pdf'}]});
  expect(second?.[0]).toEqual(first?.[0]);
  expect(second?.[1]).toMatchObject({profile:VIEWER_ID,requestId:first?.[1]?.requestId});
  expect(await loadInspirationDraft(scope)).toBeNull();
});

it.each([true,false])('a rapid double press saves once and settles the submitted draft (IndexedDB: %s)',async available=>{
  if(!available)vi.stubGlobal('indexedDB',undefined);
  await open('A deliberate capture.');
  await act(async()=>{save().click();save().click();});
  await vi.waitFor(async()=>{await act(async()=>{});expect(createInspiration).toHaveBeenCalledOnce();expect(journals()).toHaveLength(0);});
  expect(vi.mocked(createInspiration).mock.calls[0]).toMatchObject([{text:'A deliberate capture.'},{profile:VIEWER_ID,requestId:expect.any(String)}]);
  if(available)expect(await loadInspirationDraft(scope)).toBeNull();
  expect(localStorage.getItem(profileStorageKey(scope,'draft')!)).toBeNull();
});

it('retains a newer draft with identical words when it is edited during save cleanup',async()=>{
  let release!:()=>void;storage.hold=new Promise(resolve=>{release=resolve;});
  await open('A deliberate capture.');
  await act(async()=>save().click());
  await vi.waitFor(()=>expect(storage.entered).toBe(true));
  await type('A newer version of that thought.');await type('A deliberate capture.');
  await vi.waitFor(async()=>expect((await loadInspirationDraft(scope))?.revision).toBeGreaterThan(2));
  await act(async()=>release());
  await vi.waitFor(async()=>{await act(async()=>{});expect(journals()).toHaveLength(0);});
  expect(field()?.value).toBe('A deliberate capture.');
  expect((await loadInspirationDraft(scope))?.text).toBe('A deliberate capture.');
  expect(createInspiration).toHaveBeenCalledOnce();
});

it('binds a text save to the draft revision at the press, not a newer revision flushed during preparation',async()=>{
  let release!:()=>void;storage.writeHold=new Promise(resolve=>{release=resolve;});
  await open('A deliberate capture.');
  await act(async()=>save().click());
  await vi.waitFor(()=>expect(storage.writeEntered).toBe(true));
  expect(createInspiration).not.toHaveBeenCalled();
  await type('A newer version of that thought.');await type('A deliberate capture.');
  await act(async()=>release());
  await vi.waitFor(async()=>{await act(async()=>{});expect(createInspiration).toHaveBeenCalledOnce();expect(journals()).toHaveLength(0);});
  expect(field()?.value).toBe('A deliberate capture.');
  expect((await loadInspirationDraft(scope))?.text).toBe('A deliberate capture.');
});

it('preserves a newer identical text draft when IndexedDB is unavailable',async()=>{
  vi.stubGlobal('indexedDB',undefined);
  let finish!:(value:ApiInspiration)=>void;
  vi.mocked(createInspiration).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  await open('A deliberate capture.');await act(async()=>save().click());
  await vi.waitFor(()=>expect(createInspiration).toHaveBeenCalledOnce());
  await type('A newer version of that thought.');await type('A deliberate capture.');
  await act(async()=>finish({id:'saved-one',profileId:VIEWER_ID,text:'A deliberate capture.',kind:'note',source:'app',
    createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),attachments:[],reflections:[]}));
  await vi.waitFor(async()=>{await act(async()=>{});expect(journals()).toHaveLength(0);});
  expect(field()?.value).toBe('A deliberate capture.');
  expect(createInspiration).toHaveBeenCalledOnce();
});

it('does not clear a newer identical draft when an older pending save was deleted on the server',async()=>{
  vi.mocked(createInspiration).mockRejectedValueOnce(new Error('Lost response'));
  await open('A deliberate capture.');await act(async()=>save().click());
  await vi.waitFor(()=>expect([...document.querySelectorAll('button')].some(button=>button.textContent==='Try again')).toBe(true));
  expect(journals()).toHaveLength(1);
  const intent=JSON.parse(localStorage.getItem(journals()[0]!)!);
  expect(intent.input.text).toBe('A deliberate capture.');
  expect(intent.draft).toMatchObject({id:expect.any(String),revision:expect.any(Number)});
  await type('A newer version of that thought.');await type('A deliberate capture.');
  await vi.waitFor(async()=>expect((await loadInspirationDraft(scope))?.revision).toBeGreaterThan(intent.draft.revision));
  vi.mocked(fetchInspirationSaveRequest).mockRejectedValue(new ApiError({status:410,code:'saved_item_removed',message:'Removed'}));
  let release!:()=>void;storage.hold=new Promise(resolve=>{release=resolve;});
  try {
    await act(async()=>[...document.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent==='Try again')!.click());
    await vi.waitFor(()=>expect(storage.entered).toBe(true));
    expect(journals()).toHaveLength(1);
  } finally {await act(async()=>{release();await loadInspirationDraft(scope);});}
  await vi.waitFor(async()=>{await act(async()=>{});expect(journals()).toHaveLength(0);});
  expect(storage.entered).toBe(true);
  expect(field()?.value).toBe('A deliberate capture.');
  expect((await loadInspirationDraft(scope))?.text).toBe('A deliberate capture.');
  expect(createInspiration).toHaveBeenCalledOnce();
});

it('times out slow cleanup without letting its late completion replace a newer draft after retry',async()=>{
  let release!:()=>void;storage.hold=new Promise(resolve=>{release=resolve;});
  await open('A deliberate capture.');vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});
  await act(async()=>save().click());
  await vi.waitFor(()=>expect(storage.entered).toBe(true));
  await act(async()=>vi.advanceTimersByTimeAsync(15_000));
  expect(journals()).toHaveLength(1);
  await type('A newer thought must survive.');storage.hold=null;
  await act(async()=>[...document.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent==='Try again')!.click());
  await vi.waitFor(async()=>{await act(async()=>{});expect(journals()).toHaveLength(0);});
  await act(async()=>{release();await loadInspirationDraft(scope);});
  expect(field()?.value).toBe('A newer thought must survive.');
  expect((await loadInspirationDraft(scope))?.text).toBe('A newer thought must survive.');
  expect(createInspiration).toHaveBeenCalledOnce();
});
