// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY (gate G6): `lib/api` supplies owned principles;
 * `lib/principle-artifact` controls image timing, `URL` supplies local blob
 * handles, `HTMLAnchorElement.click` controls download handoff, and
 * `navigator` supplies a cancelable native share sheet.
 * `Storage.setItem` simulates one quota failure; otherwise real editing,
 * private-field projection, draft storage and recovery run. */
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {PrincipleShare} from '../src/components/PrincipleShare';
import {fetchPrinciples,fetchPrincipleStatements,updatePrinciple,reorderPrinciples,type ApiPrinciple} from '../src/lib/api';
import {ArtifactLayoutError,renderShareCard} from '../src/lib/principle-artifact';
import {readPrincipleArtifactDrafts} from '../src/lib/principle-artifact-drafts';
vi.mock('../src/lib/api',async original=>({...await original<typeof import('../src/lib/api')>(),fetchPrinciples:vi.fn(),fetchPrincipleStatements:vi.fn(),updatePrinciple:vi.fn(),reorderPrinciples:vi.fn()}));
vi.mock('../src/lib/principle-artifact',async original=>({...await original<typeof import('../src/lib/principle-artifact')>(),renderShareCard:vi.fn()}));
const id='11111111-1111-4111-8111-111111111111',scope={accountId:'owner',profileId:'human'};
const source:ApiPrinciple={id,statement:'Leave room to reconsider.',type:'maxim',state:'held',origin:'minted',rank:0,locked:false,heldSince:null,conflictsWithId:null,createdAt:'2026-10-03T00:00:00Z',
  citedSignals:[{id:'signal',statement:'PRIVATE_SENTINEL',examples:[{text:'PRIVATE_SENTINEL',createdAt:'2026-10-03T00:00:00Z'}]}]};
const nativeShare=vi.fn(),nativeCanShare=vi.fn(),close=vi.fn();
const priorShare=Object.getOwnPropertyDescriptor(navigator,'share'),priorCanShare=Object.getOwnPropertyDescriptor(navigator,'canShare');
let root:Root,host:HTMLDivElement;
beforeEach(()=>{
  vi.resetAllMocks();vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});localStorage.clear();sessionStorage.clear();
  (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  vi.mocked(fetchPrinciples).mockResolvedValue([structuredClone(source)]);
  vi.mocked(renderShareCard).mockImplementation(async content=>({blob:new Blob([content.items.map(item=>item.text).join('\n')],{type:'image/png'}),width:1080,height:1080,fallbackFont:false}));
  const BaseURL=URL;vi.stubGlobal('URL',class extends BaseURL{static createObjectURL=vi.fn(()=>`blob:fixture-${crypto.randomUUID()}`);static revokeObjectURL=vi.fn();});
  Object.defineProperty(navigator,'share',{configurable:true,value:nativeShare});Object.defineProperty(navigator,'canShare',{configurable:true,value:nativeCanShare});nativeCanShare.mockReturnValue(false);
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{
  await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();vi.useRealTimers();
  vi.restoreAllMocks();
  if(priorShare)Object.defineProperty(navigator,'share',priorShare);else Reflect.deleteProperty(navigator,'share');
  if(priorCanShare)Object.defineProperty(navigator,'canShare',priorCanShare);else Reflect.deleteProperty(navigator,'canShare');
});
const mount=()=>act(async()=>root.render(<PrincipleShare scope={scope} id={id} name="Agi" locale="en-US" onClose={close} onChoose={()=>{}}/>));
const settle=()=>act(async()=>vi.advanceTimersByTimeAsync(200));
const button=(text:string)=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(row=>row.textContent===text)!;
const type=(text:string)=>act(async()=>{const area=host.querySelector('textarea')!;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(area,text);area.dispatchEvent(new Event('input',{bubbles:true}));});
const changeMode=()=>act(async()=>{const select=[...host.querySelectorAll('select')].find(row=>[...row.options].some(option=>option.value==='change'))!;select.value='change';select.dispatchEvent(new Event('change',{bubbles:true}));});
it('starts with an exportable preview and keeps editing and customization optional',async()=>{
  await mount();await settle();
  expect(host.querySelector('img')?.alt).toBe(source.statement);
  expect(button('Save image').disabled).toBe(false);
  const words=host.querySelector<HTMLDetailsElement>('.jar-share-word-editor')!,customize=host.querySelector<HTMLDetailsElement>('.jar-share-customize')!;
  expect(words.open).toBe(false);expect(customize.open).toBe(false);
  expect(words.querySelector('summary')?.textContent).toBe('Edit wording');
  await act(async()=>words.querySelector('summary')!.click());expect(words.open).toBe(true);
  expect(host.textContent).toContain('Edits here change the card only.');
});
it('edits only the card and never renders private evidence or the hidden name',async()=>{
  await mount();await settle();await type('My card words');await settle();
  expect(renderShareCard).toHaveBeenLastCalledWith({items:[{text:'My card words'}],name:'',appearance:'dark',format:'square'});
  expect(host.textContent).not.toContain('PRIVATE_SENTINEL');expect(updatePrinciple).not.toHaveBeenCalled();expect(reorderPrinciples).not.toHaveBeenCalled();
  expect(readPrincipleArtifactDrafts(scope,id)[0].value.entries[0].originalStatement).toBe(source.statement);
});
it('restores a closed draft and forks its next edit without overwriting the earlier writer',async()=>{
  /* the earlier writer is ANOTHER TAB: another `sessionStorage`, where the
     writer id lives (`lib/tab-writer`) */
  await mount();await type('Keep these card words');await act(async()=>root.unmount());sessionStorage.clear();root=createRoot(host);await mount();
  expect(host.querySelector('textarea')!.value).toBe('Keep these card words');await type('A new draft of these words');
  expect(readPrincipleArtifactDrafts(scope,id).map(row=>row.value.entries[0].text).sort()).toEqual(['A new draft of these words','Keep these card words']);
});
it('does not restore a discarded card on the next reload',async()=>{
  /* A reload is the SAME tab, so it keeps writing its own draft in place.
     It used to fork it under a new key, and discarding the fork left the
     earlier revision on disk for the next open to restore. */
  await mount();await type('Keep these card words');await act(async()=>root.unmount());root=createRoot(host);await mount();
  await type('A new draft of these words');
  vi.spyOn(window,'confirm').mockReturnValue(true);
  await act(async()=>button('Discard draft').click());
  expect(readPrincipleArtifactDrafts(scope,id),'the reloaded draft is still on disk').toEqual([]);
  await act(async()=>root.unmount());root=createRoot(host);await mount();
  expect(host.querySelector('textarea')!.value).toBe(source.statement);
});
it('leaves another open tab’s card draft alone when this tab discards',async()=>{
  await mount();await type('Card words in the other tab');await act(async()=>root.unmount());sessionStorage.clear();root=createRoot(host);await mount();
  await type('Card words in this tab');
  vi.spyOn(window,'confirm').mockReturnValue(true);
  await act(async()=>button('Discard draft').click());
  expect(readPrincipleArtifactDrafts(scope,id).map(row=>row.value.entries[0].text)).toEqual(['Card words in the other tab']);
});
it('forks to a writer of its own when a duplicated tab writes the same card draft',async()=>{
  await mount();await type('Card words in the original');
  const [row]=readPrincipleArtifactDrafts(scope,id);
  const sharedWriter=sessionStorage.getItem('waka:draftWriter');
  localStorage.setItem(row!.key,JSON.stringify({...row!.value,entries:row!.value.entries.map(entry=>({...entry,text:'Card words in the duplicate'})),updatedAt:row!.value.updatedAt+1}));
  await type('Card words in the original, more');
  expect(host.textContent,'the conflict was reported as broken storage').not.toContain('couldn’t keep the draft');
  expect(sessionStorage.getItem('waka:draftWriter')).not.toBe(sharedWriter);
  expect(readPrincipleArtifactDrafts(scope,id).map(item=>item.value.entries[0].text).sort()).toEqual(['Card words in the duplicate','Card words in the original, more']);
});
it('never enables export from a late preview of earlier wording',async()=>{
  let resolve!:(value:Awaited<ReturnType<typeof renderShareCard>>)=>void;
  vi.mocked(renderShareCard).mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));await mount();await settle();
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
it('hides an obsolete preview after a render failure and retries without changing the draft',async()=>{
  await mount();await settle();
  vi.mocked(renderShareCard).mockRejectedValueOnce(new ArtifactLayoutError('unavailable'));
  await type('Keep these words after an image failure');await settle();
  expect(button('Save image').disabled).toBe(true);expect(host.querySelector('img')).toBeNull();
  expect(host.querySelector('textarea')!.value).toBe('Keep these words after an image failure');
  await act(async()=>button('Try again').click());await settle();
  expect(button('Save image').disabled).toBe(false);expect(host.querySelector('img')!.alt).toBe('Keep these words after an image failure');
});
it('exports the preview blob and preserves the draft when download handoff fails',async()=>{
  await mount();await type('My export, not private evidence');await settle();
  const previewBlob=vi.mocked(URL.createObjectURL).mock.calls.at(-1)![0];
  const click=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementationOnce(()=>{throw new Error('Download refused');});
  await act(async()=>button('Save image').click());
  expect(host.textContent).toContain('Couldn’t start the download.');expect(host.textContent).not.toContain('Image download started.');
  expect(host.querySelector('textarea')!.value).toBe('My export, not private evidence');expect(document.querySelector('a[download]')).toBeNull();
  click.mockImplementation(()=>{});await act(async()=>button('Save image').click());
  expect(URL.createObjectURL).toHaveBeenLastCalledWith(previewBlob);expect(host.textContent).toContain('Image download started.');
  expect(readPrincipleArtifactDrafts(scope,id)[0].value.entries[0].text).toBe('My export, not private evidence');
});
it('falls back to download after native sharing fails and sends only the preview image',async()=>{
  nativeCanShare.mockReturnValue(true);nativeShare.mockRejectedValueOnce(new DOMException('Unavailable','NotAllowedError'));
  await mount();await settle();await act(async()=>button('Share image').click());
  expect(host.textContent).toContain('You can save the image instead.');expect(button('Save image').disabled).toBe(false);
  const payload=nativeShare.mock.calls[0][0];expect(Object.keys(payload)).toEqual(['files']);
  expect(payload.files).toHaveLength(1);expect(payload.files[0].type).toBe('image/png');
  expect(host.querySelector('textarea')!.value).toBe(source.statement);
});
it('recovers a failed source read without creating a draft or an export from missing data',async()=>{
  vi.mocked(fetchPrinciples).mockRejectedValueOnce(new Error('Offline'));
  await mount();expect(host.querySelector('textarea')).toBeNull();expect(renderShareCard).not.toHaveBeenCalled();
  await act(async()=>button('Try again').click());await settle();
  expect(host.querySelector('textarea')!.value).toBe(source.statement);expect(button('Save image').disabled).toBe(false);
});
it.each(['empty','too_long'] as const)('keeps unrenderable %s wording editable and disables export',async code=>{
  await mount();await settle();vi.mocked(renderShareCard).mockRejectedValueOnce(new ArtifactLayoutError(code));
  const words=code==='empty'?'   ':'Long wording '.repeat(100);await type(words);await settle();
  expect(host.querySelector('textarea')!.value).toBe(words);expect(button('Save image').disabled).toBe(true);expect(host.querySelector('img')).toBeNull();
  await type('Fits again');await settle();expect(button('Save image').disabled).toBe(false);
  expect(host.querySelector<HTMLDetailsElement>('.jar-share-word-editor')!.open).toBe(true);
});
it('keeps visible words after storage failure and saves them on explicit retry',async()=>{
  await mount();vi.spyOn(Storage.prototype,'setItem').mockImplementationOnce(()=>{throw new DOMException('Full','QuotaExceededError');});
  await type('Keep me even if storage fills up');await settle();
  expect(host.textContent).toContain('This device couldn’t keep the draft.');
  expect(host.querySelector('textarea')!.value).toBe('Keep me even if storage fills up');
  await act(async()=>button('Try saving draft').click());
  expect(host.textContent).not.toContain('This device couldn’t keep the draft.');
  expect(readPrincipleArtifactDrafts(scope,id)[0].value.entries[0].text).toBe('Keep me even if storage fills up');
});
it('does not restore or export a local draft if the source is no longer accessible',async()=>{
  await mount();await type('Private draft');await act(async()=>root.unmount());root=createRoot(host);
  vi.mocked(fetchPrinciples).mockResolvedValue([]);vi.mocked(renderShareCard).mockClear();await mount();await settle();
  expect(host.querySelector('textarea')).toBeNull();expect(host.textContent).not.toContain('Private draft');
  expect(renderShareCard).not.toHaveBeenCalled();expect(host.querySelector('footer')).toBeNull();
});
it('builds change cards from recorded words and dates with no editable invented past',async()=>{
  const beforeId='22222222-2222-4222-8222-222222222222',afterId='33333333-3333-4333-8333-333333333333';
  vi.mocked(fetchPrincipleStatements).mockResolvedValue({profileId:scope.profileId,principleId:id,currentStatementId:afterId,statements:[
    {id:afterId,statement:'Current saved wording.',createdAt:'2026-10-03T12:00:00Z'},
    {id:beforeId,statement:'Earlier saved wording.',createdAt:'2026-10-01T12:00:00Z'}]});
  await mount();await changeMode();await settle();
  expect(host.querySelector('textarea')).toBeNull();expect(renderShareCard).toHaveBeenLastCalledWith({name:'',appearance:'dark',format:'square',items:[
    {text:'Earlier saved wording.',label:'Earlier wording',date:new Date('2026-10-01T12:00:00Z').toLocaleDateString('en-US',{dateStyle:'medium'})},
    {text:'Current saved wording.',label:'Current wording',date:new Date('2026-10-03T12:00:00Z').toLocaleDateString('en-US',{dateStyle:'medium'})}]});
  expect(readPrincipleArtifactDrafts(scope,id)[0].value.beforeStatementId).toBe(beforeId);
});
it('does not fabricate a change card when the principle has no saved earlier wording',async()=>{
  vi.mocked(fetchPrincipleStatements).mockResolvedValue({profileId:scope.profileId,principleId:id,currentStatementId:null,statements:[]});
  await mount();await changeMode();await settle();expect(host.textContent).toContain('needs two saved wordings');expect(button('Save image').disabled).toBe(true);
});
/* THE SET ARRIVES COMPLETE, so this no longer presses "Add another
   principle" to build one — there is nothing to add. Founder: "how we can
   make the principal page something that people would want to like share on
   their social media and stuff." One principle posted alone is a fortune
   cookie a stranger cannot tell from something typed that morning; three are
   a portrait, and they invite the comparison that is the whole mechanism of
   anything people post about themselves. What this case protects is
   unchanged and is all still here: the pressed principle leads, the cap is
   three, an edit touches one entry only, removing takes the chosen one, and
   nothing about the card writes back to the principles themselves. */
it('opens with the set, led by the pressed one, capped at three and edited separately',async()=>{
  const extra={...source,id:'22222222-2222-4222-8222-222222222222',statement:'두 번째 원칙.'},third={...source,id:'33333333-3333-4333-8333-333333333333',statement:'Third principle.'},
    fourth={...source,id:'44444444-4444-4444-8444-444444444444',statement:'Fourth principle.'};
  /* `source` is not first in the reading's order, so "led by the pressed one"
     is a real assertion rather than one the fixture satisfies by accident. */
  vi.mocked(fetchPrinciples).mockResolvedValue([extra,source,third,fourth]);await mount();
  await type('Only my card edit');await settle();
  expect(renderShareCard).toHaveBeenLastCalledWith(expect.objectContaining({name:'',appearance:'dark',format:'square',
    items:[{text:'Only my card edit'},{text:extra.statement},{text:third.statement}]}));
  /* The cap holds and the fourth never arrives, so there is nothing left to
     add — which is why the control that used to build this is absent. */
  expect(host.textContent).not.toContain('Add another principle');
  /* On the CARD, not on the page: the fourth is still offered by the
     "choose a principle" selector, which swaps which one leads rather than
     adding a fourth. Asserting its absence from the whole document would be
     asserting that control away too. */
  expect([...host.querySelectorAll('textarea')].map(node=>node.value)).toEqual(
    ['Only my card edit',extra.statement,third.statement]);
  expect(updatePrinciple).not.toHaveBeenCalled();expect(reorderPrinciples).not.toHaveBeenCalled();
  await act(async()=>[...host.querySelectorAll('button')].find(row=>row.textContent==='Remove from card')!.click());await settle();
  expect(host.querySelectorAll('textarea')).toHaveLength(2);expect(host.querySelectorAll('textarea')[1].value).toBe(third.statement);
});
it('puts the proof on the card, counting each save once across the set',async()=>{
  /* THE HEADLINE, AND THE ONE NUMBER A STRANGER CANNOT CHECK. The postable
     fact is not the sentiment but that it was earned, so the card carries the
     saves and the span. Two principles standing on the SAME evidence must not
     let it count twice: the one figure nobody can verify is the one the card
     must never inflate. */
  const shared={text:'A save behind both.',createdAt:'2026-04-01T12:00:00Z'};
  const held='2026-04-01T12:00:00Z';
  const a={...source,heldSince:held,citedSignals:[{id:'s1',statement:'x',examples:[shared,{text:'Only mine.',createdAt:'2026-05-01T12:00:00Z'}]}]};
  const b={...source,id:'22222222-2222-4222-8222-222222222222',statement:'Second.',heldSince:held,
    citedSignals:[{id:'s2',statement:'y',examples:[shared]}]};
  vi.mocked(fetchPrinciples).mockResolvedValue([a,b]);await mount();await settle();
  const last=vi.mocked(renderShareCard).mock.calls.at(-1)![0];
  expect(last.proof,'the card carries no proof, so it is a sentiment with nothing behind it').toBeTruthy();
  /* Two distinct saves, not three: the shared one is counted once. */
  expect(last.proof).toContain('2 things I kept');
});

it('retries a failed history read without showing the previous regular-card preview',async()=>{
  await mount();await settle();vi.mocked(fetchPrincipleStatements).mockRejectedValueOnce(new Error('No access'));
  await changeMode();await settle();expect(host.querySelector('img')).toBeNull();expect(button('Save image').disabled).toBe(true);
  vi.mocked(fetchPrincipleStatements).mockResolvedValueOnce({profileId:scope.profileId,principleId:id,currentStatementId:null,statements:[]});
  await act(async()=>button('Try again').click());await settle();expect(host.textContent).toContain('needs two saved wordings');
});
it('preserves exact selected history and offers feasible options for an overlong change card',async()=>{
  const old='22222222-2222-4222-8222-222222222222',recent='33333333-3333-4333-8333-333333333333',currentId='44444444-4444-4444-8444-444444444444';
  vi.mocked(fetchPrincipleStatements).mockResolvedValue({profileId:scope.profileId,principleId:id,currentStatementId:currentId,previousStatementId:recent,statements:[
    {id:currentId,statement:'Today.',createdAt:'2026-10-03T12:00:00Z'},
    {id:old,statement:'First.',createdAt:'2026-10-01T12:00:00Z'},
    {id:recent,statement:'Previous.',createdAt:'2026-10-02T12:00:00Z'}]});
  await mount();await changeMode();await settle();expect(readPrincipleArtifactDrafts(scope,id)[0].value.beforeStatementId).toBe(recent);
  vi.mocked(renderShareCard).mockRejectedValueOnce(new ArtifactLayoutError('too_long'));
  await act(async()=>{const select=[...host.querySelectorAll('select')].find(row=>[...row.options].some(option=>option.value===old))!;select.value=old;select.dispatchEvent(new Event('change',{bubbles:true}));});await settle();
  expect(host.textContent).toContain('These recorded words don’t fit.');expect(host.textContent).not.toContain('Shorten the text');
  expect(host.querySelector('textarea')).toBeNull();expect(button('Save image').disabled).toBe(true);
  await act(async()=>root.unmount());root=createRoot(host);await mount();await settle();
  expect(renderShareCard).toHaveBeenLastCalledWith(expect.objectContaining({items:[expect.objectContaining({text:'First.'}),expect.objectContaining({text:'Today.'})]}));
});
