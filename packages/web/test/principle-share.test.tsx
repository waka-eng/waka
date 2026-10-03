// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY (gate G6): `lib/api` supplies owned principles;
 * `lib/principle-artifact` controls image timing, `URL` supplies local blob
 * handles, and `navigator` supplies a cancelable native share sheet.
 * Real editing, private-field projection, draft storage and recovery run. */
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {PrincipleShare} from '../src/components/PrincipleShare';
import {fetchPrinciples,fetchPrincipleStatements,updatePrinciple,reorderPrinciples,type ApiPrinciple} from '../src/lib/api';
import {renderPrincipleArtifact} from '../src/lib/principle-artifact';
import {readPrincipleArtifactDrafts} from '../src/lib/principle-artifact-drafts';
vi.mock('../src/lib/api',async original=>({...await original<typeof import('../src/lib/api')>(),fetchPrinciples:vi.fn(),fetchPrincipleStatements:vi.fn(),updatePrinciple:vi.fn(),reorderPrinciples:vi.fn()}));
vi.mock('../src/lib/principle-artifact',async original=>({...await original<typeof import('../src/lib/principle-artifact')>(),renderPrincipleArtifact:vi.fn()}));
const id='11111111-1111-4111-8111-111111111111',scope={accountId:'owner',profileId:'human'};
const source:ApiPrinciple={id,statement:'Leave room to reconsider.',type:'maxim',state:'held',origin:'minted',rank:0,locked:false,heldSince:null,conflictsWithId:null,createdAt:'2026-10-03T00:00:00Z',
  citedSignals:[{id:'signal',statement:'PRIVATE_SENTINEL',examples:[{text:'PRIVATE_SENTINEL',createdAt:'2026-10-03T00:00:00Z'}]}]};
const nativeShare=vi.fn(),nativeCanShare=vi.fn(),close=vi.fn();
const priorShare=Object.getOwnPropertyDescriptor(navigator,'share'),priorCanShare=Object.getOwnPropertyDescriptor(navigator,'canShare');
let root:Root,host:HTMLDivElement;
beforeEach(()=>{
  vi.resetAllMocks();vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});localStorage.clear();
  (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  vi.mocked(fetchPrinciples).mockResolvedValue([structuredClone(source)]);
  vi.mocked(renderPrincipleArtifact).mockImplementation(async content=>({blob:new Blob([content.items.map(item=>item.text).join('\n')],{type:'image/png'}),width:1080,height:1080,fallbackFont:false}));
  const BaseURL=URL;vi.stubGlobal('URL',class extends BaseURL{static createObjectURL=vi.fn(()=>`blob:fixture-${crypto.randomUUID()}`);static revokeObjectURL=vi.fn();});
  Object.defineProperty(navigator,'share',{configurable:true,value:nativeShare});Object.defineProperty(navigator,'canShare',{configurable:true,value:nativeCanShare});nativeCanShare.mockReturnValue(false);
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{
  await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();vi.useRealTimers();
  if(priorShare)Object.defineProperty(navigator,'share',priorShare);else Reflect.deleteProperty(navigator,'share');
  if(priorCanShare)Object.defineProperty(navigator,'canShare',priorCanShare);else Reflect.deleteProperty(navigator,'canShare');
});
const mount=()=>act(async()=>root.render(<PrincipleShare scope={scope} id={id} name="Agi" locale="en-US" onClose={close} onChoose={()=>{}}/>));
const settle=()=>act(async()=>vi.advanceTimersByTimeAsync(200));
const button=(text:string)=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(row=>row.textContent===text)!;
const type=(text:string)=>act(async()=>{const area=host.querySelector('textarea')!;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(area,text);area.dispatchEvent(new Event('input',{bubbles:true}));});
const changeMode=()=>act(async()=>{const select=[...host.querySelectorAll('select')].find(row=>[...row.options].some(option=>option.value==='change'))!;select.value='change';select.dispatchEvent(new Event('change',{bubbles:true}));});
it('edits only the card and never renders private evidence or the hidden name',async()=>{
  await mount();await settle();await type('My card words');await settle();
  expect(renderPrincipleArtifact).toHaveBeenLastCalledWith({items:[{text:'My card words'}],name:'',appearance:'dark',format:'square'});
  expect(host.textContent).not.toContain('PRIVATE_SENTINEL');expect(updatePrinciple).not.toHaveBeenCalled();expect(reorderPrinciples).not.toHaveBeenCalled();
  expect(readPrincipleArtifactDrafts(scope,id)[0].value.entries[0].originalStatement).toBe(source.statement);
});
it('restores a closed draft and forks its next edit without overwriting the earlier writer',async()=>{
  await mount();await type('Keep these card words');await act(async()=>root.unmount());root=createRoot(host);await mount();
  expect(host.querySelector('textarea')!.value).toBe('Keep these card words');await type('A new draft of these words');
  expect(readPrincipleArtifactDrafts(scope,id).map(row=>row.value.entries[0].text).sort()).toEqual(['A new draft of these words','Keep these card words']);
});
it('never enables export from a late preview of earlier wording',async()=>{
  let resolve!:(value:Awaited<ReturnType<typeof renderPrincipleArtifact>>)=>void;
  vi.mocked(renderPrincipleArtifact).mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));await mount();await settle();
  await type('Changed while the image was rendering');
  await act(async()=>resolve({blob:new Blob(['old']),width:1080,height:1080,fallbackFont:false}));expect(button('Save image').disabled).toBe(true);
  await settle();expect(button('Save image').disabled).toBe(false);expect(host.querySelector('img')!.alt).toBe('Changed while the image was rendering');
});
it('keeps wording after native cancellation and never claims it was published',async()=>{
  nativeCanShare.mockReturnValue(true);nativeShare.mockRejectedValueOnce(new DOMException('Canceled','AbortError'));
  await mount();await type('Words I chose for the card');await settle();await act(async()=>button('Share image').click());
  expect(host.querySelector('textarea')!.value).toBe('Words I chose for the card');expect(host.textContent).not.toMatch(/published|posted|Share sheet closed/);
  nativeShare.mockResolvedValueOnce(undefined);await act(async()=>button('Share image').click());expect(nativeShare).toHaveBeenCalledTimes(2);expect(host.textContent).toContain('Share sheet closed.');
});
it('builds change cards from recorded words and dates with no editable invented past',async()=>{
  const beforeId='22222222-2222-4222-8222-222222222222',afterId='33333333-3333-4333-8333-333333333333';
  vi.mocked(fetchPrincipleStatements).mockResolvedValue({profileId:scope.profileId,principleId:id,currentStatementId:afterId,statements:[
    {id:afterId,statement:'Current saved wording.',createdAt:'2026-10-03T12:00:00Z'},
    {id:beforeId,statement:'Earlier saved wording.',createdAt:'2026-10-01T12:00:00Z'}]});
  await mount();await changeMode();await settle();
  expect(host.querySelector('textarea')).toBeNull();expect(renderPrincipleArtifact).toHaveBeenLastCalledWith({name:'',appearance:'dark',format:'square',items:[
    {text:'Earlier saved wording.',label:'Earlier wording',date:new Date('2026-10-01T12:00:00Z').toLocaleDateString('en-US',{dateStyle:'medium'})},
    {text:'Current saved wording.',label:'Current wording',date:new Date('2026-10-03T12:00:00Z').toLocaleDateString('en-US',{dateStyle:'medium'})}]});
  expect(readPrincipleArtifactDrafts(scope,id)[0].value.beforeStatementId).toBe(beforeId);
});
it('does not fabricate a change card when the principle has no saved earlier wording',async()=>{
  vi.mocked(fetchPrincipleStatements).mockResolvedValue({profileId:scope.profileId,principleId:id,currentStatementId:null,statements:[]});
  await mount();await changeMode();await settle();expect(host.textContent).toContain('needs two saved wordings');expect(button('Save image').disabled).toBe(true);
});
