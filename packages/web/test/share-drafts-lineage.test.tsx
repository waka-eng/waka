// @vitest-environment jsdom
/**
 * DISCARD CLEARS THE CARD ON SCREEN, AND ONLY THAT ONE (L10).
 *
 * Every mount is a new draft writer, so a restored card O forks into F on
 * its first change. Unlike a chat draft, O stays visible: the Drafts picker
 * lists it as its own choice, which the person may be keeping on purpose. So
 * the per-tab lineage that clears a sent chat message's original
 * (`lib/draft-lineage.ts`) is NOT applied to cards: discarding F leaves O.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): `lib/api` supplies owned principles
 * and their recorded wordings, `lib/principle-artifact` the image, `URL` the
 * blob handles and `window.confirm` the Discard confirmation. The real
 * card and draft storage run.
 */
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {PrincipleShare} from '../src/components/PrincipleShare';
import {fetchPrinciples,type ApiPrinciple} from '../src/lib/api';
import {renderShareCard} from '../src/lib/principle-artifact';
import {readPrincipleArtifactDrafts} from '../src/lib/principle-artifact-drafts';
vi.mock('../src/lib/api',async original=>({...await original<typeof import('../src/lib/api')>(),fetchPrinciples:vi.fn()}));
vi.mock('../src/lib/principle-artifact',async original=>({...await original<typeof import('../src/lib/principle-artifact')>(),renderShareCard:vi.fn()}));
const id='11111111-1111-4111-8111-111111111111',scope={accountId:'owner',profileId:'human'};
const principle=(key:string,statement:string):ApiPrinciple=>({id:key,statement,type:'maxim',state:'held',origin:'minted',rank:0,locked:false,heldSince:null,conflictsWithId:null,createdAt:'2026-10-03T00:00:00Z',citedSignals:[]});
const source=principle(id,'Leave room to reconsider.');
let root:Root,host:HTMLDivElement;
beforeEach(()=>{
  vi.resetAllMocks();vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});localStorage.clear();sessionStorage.clear();
  (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  vi.mocked(fetchPrinciples).mockResolvedValue([structuredClone(source)]);
  vi.mocked(renderShareCard).mockImplementation(async content=>({blob:new Blob([content.items.map(item=>item.text).join('\n')],{type:'image/png'}),width:1080,height:1080,fallbackFont:false}));
  const BaseURL=URL;vi.stubGlobal('URL',class extends BaseURL{static createObjectURL=vi.fn(()=>`blob:fixture-${crypto.randomUUID()}`);static revokeObjectURL=vi.fn();});
  vi.spyOn(window,'confirm').mockReturnValue(true);
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();vi.useRealTimers();vi.restoreAllMocks();});
const settle=()=>act(async()=>vi.advanceTimersByTimeAsync(200));
const mount=async()=>{await act(async()=>root.render(<PrincipleShare scope={scope} id={id} name="Agi" locale="en-US" onClose={()=>{}} onChoose={()=>{}}/>));await settle();};
const remount=async()=>{await act(async()=>root.unmount());root=createRoot(host);await mount();};
const button=(text:string)=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(row=>row.textContent===text)!;
const type=(text:string)=>act(async()=>{const area=host.querySelector('textarea')!;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(area,text);area.dispatchEvent(new Event('input',{bubbles:true}));});
const discard=async()=>{await act(async()=>button('Discard draft').click());await settle();};
const texts=()=>readPrincipleArtifactDrafts(scope,id).map(row=>row.value.entries[0].text);
const picker=()=>[...host.querySelectorAll('select')].find(row=>[...row.options].some(option=>/^\d+\. /.test(option.textContent??'')));

it('keeps the restored card in the picker when its fork is discarded',async()=>{
  await mount();await type('The card I kept');await remount();
  await type('A version I will throw away');
  expect([...picker()!.options].map(option=>option.textContent),'the picker does not offer the kept card').toContain('2. The card I kept');
  await discard();
  expect(texts(),'Discard took the kept card too').toEqual(['The card I kept']);
  await type('A fresh card');
  expect([...picker()!.options].map(option=>option.textContent?.replace(/^\d+\. /,'')).sort()).toEqual(['A fresh card','The card I kept']);
  expect(sessionStorage.getItem('waka:draftLineage:own'),'a card fork was recorded for clearing').toBeNull();
});
