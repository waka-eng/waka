// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY: `lib/api` supplies current wording, version
 * conflicts and lost responses. The editor, confirmation and journals run. */
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {ConversationPrincipleEdit} from '../src/components/ConversationPrincipleEdit';
import {ApiError,fetchPrinciples,updatePrinciple,type ApiPrinciple} from '../src/lib/api';
vi.mock('../src/lib/api',async original=>({...await original<typeof import('../src/lib/api')>(),fetchPrinciples:vi.fn(),updatePrinciple:vi.fn()}));
const scope={accountId:'a',profileId:'p'},updated=vi.fn();let root:Root,host:HTMLDivElement,row:ApiPrinciple;
beforeEach(()=>{vi.resetAllMocks();localStorage.clear();(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;host=document.createElement('div');document.body.append(host);root=createRoot(host);
  row={id:'principle',statement:'Protect every morning.',statementRevision:'1',type:'maxim',state:'held',origin:'minted',rank:0,locked:false,heldSince:null,conflictsWithId:null,citedSignals:[],createdAt:'2026-10-03T00:00:00Z'};
  vi.mocked(fetchPrinciples).mockImplementation(async()=>[structuredClone(row)]);
  vi.mocked(updatePrinciple).mockImplementation(async(_id,statement,options)=>{if(options?.expectedStatementRevision!==row.statementRevision)throw new ApiError({status:409,message:'Changed'});row={...row,statement,statementRevision:String(Number(row.statementRevision)+1),locked:true};return structuredClone(row);});
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();});
const mount=(owner=scope)=>act(async()=>root.render(<ConversationPrincipleEdit key={owner.accountId} scope={owner} contextId="conversation:message" locale="en-US" onUpdated={updated}/>));
const button=(text:string)=>[...host.querySelectorAll('button')].find(item=>item.textContent===text)!;
const click=(text:string)=>act(async()=>button(text).click());
const choose=()=>act(async()=>{const select=host.querySelector('select')!;select.value=row.id;select.dispatchEvent(new Event('change',{bubbles:true}));});
const type=(value:string)=>act(async()=>{const field=host.querySelector('textarea')!;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(field,value);field.dispatchEvent(new Event('input',{bubbles:true}));});
const confirm=()=>act(async()=>host.querySelector<HTMLInputElement>('input[type=checkbox]')!.click());
it('writes only after explicit confirmation of the selected wording and observed version',async()=>{
  await mount();await click('Update a principle');await choose();await type('Leave one morning free.');expect(updatePrinciple).not.toHaveBeenCalled();expect(button('Confirm update').disabled).toBe(true);
  await confirm();await click('Confirm update');expect(updatePrinciple).toHaveBeenCalledWith('principle','Leave one morning free.',{profile:'p',expectedStatementRevision:'1',signal:expect.any(AbortSignal)});expect(host.textContent).toContain('Principle updated');expect(updated).toHaveBeenCalledOnce();expect(Object.keys(localStorage)).toHaveLength(0);
});
it('cancel does not change the principle',async()=>{await mount();await click('Update a principle');await choose();await type('Maybe a change');await click('Cancel');expect(updatePrinciple).not.toHaveBeenCalled();expect(Object.keys(localStorage)).toHaveLength(0);});
it('keeps a conflicted draft, shows current wording and requires reconfirmation',async()=>{
  await mount();await click('Update a principle');await choose();await type('My draft');row={...row,statement:'Newer elsewhere.',statementRevision:'2'};await confirm();await click('Confirm update');
  expect(host.querySelector('textarea')!.value).toBe('My draft');expect(host.textContent).toContain('This principle changed.');await click('Review latest wording');expect(host.textContent).toContain('Newer elsewhere.');expect(button('Confirm update').disabled).toBe(true);
  await confirm();await click('Confirm update');expect(row.statement).toBe('My draft');expect(vi.mocked(updatePrinciple).mock.calls[1][2]?.expectedStatementRevision).toBe('2');
});
it('reconciles a committed lost response with GET after reload without duplicating an edit',async()=>{
  const write=vi.mocked(updatePrinciple).getMockImplementation()!;vi.mocked(updatePrinciple).mockImplementationOnce(async(...args)=>{await write(...args);throw new Error('Response lost');});
  await mount();await click('Update a principle');await choose();await type('My confirmed wording.');await confirm();await click('Confirm update');expect(host.textContent).toContain('Couldn’t confirm');
  await act(async()=>root.unmount());root=createRoot(host);await mount();expect(updatePrinciple).toHaveBeenCalledOnce();expect(updated).toHaveBeenCalledOnce();expect(row.statementRevision).toBe('2');expect(host.textContent).toContain('Principle updated');
});
it('restores unsent wording without saving or carrying it to another account',async()=>{
  await mount();await click('Update a principle');await choose();await type('Unsent');await act(async()=>root.unmount());root=createRoot(host);await mount();expect(host.querySelector('textarea')!.value).toBe('Unsent');expect(updatePrinciple).not.toHaveBeenCalled();await mount({...scope,accountId:'b'});expect(host.querySelector('textarea')).toBeNull();
});
it('never writes if its draft cannot be retained',async()=>{await mount();await click('Update a principle');vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('Full');});await choose();await type('Kept visibly');await confirm();expect(button('Confirm update').disabled).toBe(true);expect(updatePrinciple).not.toHaveBeenCalled();});
it('lets the user cancel a refused edit after its principle was deleted, retaining words until that choice',async()=>{
  await mount();await click('Update a principle');await choose();await type('My unsaved words');vi.mocked(updatePrinciple).mockRejectedValue(new ApiError({status:404,message:'Removed'}));await confirm();await click('Confirm update');
  expect(host.querySelector('textarea')!.value).toBe('My unsaved words');expect(button('Cancel').disabled).toBe(false);expect(button('Confirm update').disabled).toBe(true);await click('Cancel');expect(host.querySelector('textarea')).toBeNull();
});
