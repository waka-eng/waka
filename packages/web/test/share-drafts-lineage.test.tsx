// @vitest-environment jsdom
/**
 * A DISCARDED SHARE CARD NEVER COMES BACK ON THE NEXT MOUNT (L10).
 *
 * Every mount is a new draft writer, so a restored card forks on its first
 * change — a setting, the change-mode mount filling an empty earlier
 * wording, or "Keep draft" after a failed write. Discarding the fork used to
 * clear the fork alone and the restored card came back. This tab now records
 * each fork (`lib/draft-lineage.ts`) and Discard clears the line.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): `lib/api` supplies owned principles
 * and their recorded wordings, `lib/principle-artifact` the image, `URL` the
 * blob handles, `window.confirm` the Discard confirmation and
 * `Storage.setItem` one quota failure. The real card, draft storage and
 * per-tab lineage run.
 */
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {PrincipleShare} from '../src/components/PrincipleShare';
import {fetchPrinciples,fetchPrincipleStatements,type ApiPrinciple} from '../src/lib/api';
import {renderShareCard} from '../src/lib/principle-artifact';
import {readPrincipleArtifactDrafts,storePrincipleArtifactDraft} from '../src/lib/principle-artifact-drafts';
vi.mock('../src/lib/api',async original=>({...await original<typeof import('../src/lib/api')>(),fetchPrinciples:vi.fn(),fetchPrincipleStatements:vi.fn()}));
vi.mock('../src/lib/principle-artifact',async original=>({...await original<typeof import('../src/lib/principle-artifact')>(),renderShareCard:vi.fn()}));
const id='11111111-1111-4111-8111-111111111111',other='55555555-5555-4555-8555-555555555555',scope={accountId:'owner',profileId:'human'};
const otherWriter='6c1d0e9f-8a7b-4c6d-8e9f-0a1b2c3d4e5f';
const principle=(key:string,statement:string):ApiPrinciple=>({id:key,statement,type:'maxim',state:'held',origin:'minted',rank:0,locked:false,heldSince:null,conflictsWithId:null,createdAt:'2026-10-03T00:00:00Z',citedSignals:[]});
const source=principle(id,'Leave room to reconsider.');
let root:Root,host:HTMLDivElement;
beforeEach(()=>{
  vi.resetAllMocks();vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});localStorage.clear();sessionStorage.clear();
  (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  vi.mocked(fetchPrinciples).mockResolvedValue([structuredClone(source),principle(other,'Another principle.')]);
  vi.mocked(renderShareCard).mockImplementation(async content=>({blob:new Blob([content.items.map(item=>item.text).join('\n')],{type:'image/png'}),width:1080,height:1080,fallbackFont:false}));
  const BaseURL=URL;vi.stubGlobal('URL',class extends BaseURL{static createObjectURL=vi.fn(()=>`blob:fixture-${crypto.randomUUID()}`);static revokeObjectURL=vi.fn();});
  vi.spyOn(window,'confirm').mockReturnValue(true);
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();vi.useRealTimers();vi.restoreAllMocks();});
const settle=()=>act(async()=>vi.advanceTimersByTimeAsync(200));
const mount=async(principleId=id)=>{await act(async()=>root.render(<PrincipleShare key={principleId} scope={scope} id={principleId} name="Agi" locale="en-US" onClose={()=>{}} onChoose={()=>{}}/>));await settle();};
const remount=async(principleId=id)=>{await act(async()=>root.unmount());root=createRoot(host);await mount(principleId);};
const button=(text:string)=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(row=>row.textContent===text)!;
const type=(text:string)=>act(async()=>{const area=host.querySelector('textarea')!;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(area,text);area.dispatchEvent(new Event('input',{bubbles:true}));});
const showName=()=>act(async()=>host.querySelector<HTMLInputElement>('.jar-share-name input')!.click());
const discard=async()=>{await act(async()=>button('Discard draft').click());await settle();};
const texts=(principleId=id)=>readPrincipleArtifactDrafts(scope,principleId).map(row=>row.value.entries[0].text);

it('discards the restored card with the fork a changed setting made',async()=>{
  await mount();await type('My card words');await remount();
  expect(host.querySelector('textarea')!.value).toBe('My card words');
  await showName();
  expect(readPrincipleArtifactDrafts(scope,id),'the setting did not fork').toHaveLength(2);
  await discard();
  expect(readPrincipleArtifactDrafts(scope,id),'the restored card outlived Discard').toEqual([]);
  await remount();expect(host.querySelector('textarea')!.value).toBe(source.statement);
});

it('discards a change card that forked on mount with no edit at all',async()=>{
  const before='22222222-2222-4222-8222-222222222222',after='33333333-3333-4333-8333-333333333333';
  vi.mocked(fetchPrincipleStatements).mockResolvedValue({profileId:scope.profileId,principleId:id,currentStatementId:after,statements:[
    {id:after,statement:'Current saved wording.',createdAt:'2026-10-03T12:00:00Z'},{id:before,statement:'Earlier saved wording.',createdAt:'2026-10-01T12:00:00Z'}]});
  /* A change card kept by an earlier mount before its earlier wording was known. */
  storePrincipleArtifactDraft(scope,id,{id:'7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',writer:otherWriter,updatedAt:1,appearance:'dark',format:'square',showName:false,mode:'change',beforeStatementId:null,
    entries:[{principleId:id,text:source.statement,originalStatement:source.statement}]});
  await mount();await settle();
  expect(readPrincipleArtifactDrafts(scope,id).map(row=>row.value.beforeStatementId).sort(),'the mount did not fill the earlier wording').toEqual([before,null].sort());
  await discard();
  expect(readPrincipleArtifactDrafts(scope,id),'the change card came back after Discard').toEqual([]);
});

it('discards the restored card when "Keep draft" after a failed write was what forked it',async()=>{
  await mount();await type('Kept card words');await remount();
  vi.spyOn(Storage.prototype,'setItem').mockImplementationOnce(()=>{throw new DOMException('Full','QuotaExceededError');});
  await type('A new version');
  expect(host.textContent).toContain('This device couldn’t keep the draft.');
  await act(async()=>button('Try saving draft').click());
  expect(texts().sort()).toEqual(['A new version','Kept card words']);
  await discard();
  expect(readPrincipleArtifactDrafts(scope,id),'the card from before the failed write came back').toEqual([]);
});

it('never discards another tab’s card that this tab did not fork from',async()=>{
  await mount();await type('Mine');
  storePrincipleArtifactDraft(scope,id,{id:'8b1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',writer:otherWriter,updatedAt:1,appearance:'light',format:'square',showName:false,mode:'card',beforeStatementId:null,
    entries:[{principleId:id,text:'Another tab, still choosing',originalStatement:source.statement}]});
  storePrincipleArtifactDraft(scope,other,{id:'9c1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',writer:otherWriter,updatedAt:1,appearance:'light',format:'square',showName:false,mode:'card',beforeStatementId:null,
    entries:[{principleId:other,text:'Another card',originalStatement:'Another principle.'}]});
  await remount();expect(host.querySelector('textarea')!.value).toBe('Mine');
  await type('Mine, edited');await discard();
  expect(texts()).toEqual(['Another tab, still choosing']);
  expect(texts(other)).toEqual(['Another card']);
});
