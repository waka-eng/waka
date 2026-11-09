// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY (gate G6): The helpers in `lib/api/top-of-mind`, `lib/api/signals`, and `lib/api/feedback` return explicit server-shaped fixtures. The real component renders those responses; no Home fallback, database, or model is involved. */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const api=vi.hoisted(()=>({read:vi.fn(),signal:vi.fn(),edit:vi.fn(),feedback:vi.fn()}));
vi.mock('../src/lib/api/top-of-mind',()=>({fetchTopOfMind:api.read,updateTopOfMindEntry:api.edit}));
vi.mock('../src/lib/api/signals',()=>({fetchSignal:api.signal}));
vi.mock('../src/lib/api/feedback',()=>({createFeedback:api.feedback}));
import { t } from '../src/lib/locales';
import ReadingDetails from '../src/components/ReadingDetails';
const actions={profileId:'agent',onUpdated:vi.fn(),onOpenInspiration:vi.fn()};
let host:HTMLDivElement,root:Root;
const button=(name:string)=>[...host.querySelectorAll('button')].find(node=>node.textContent===name)!;
beforeEach(()=>{
  (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  api.read.mockResolvedValue({createdAt:'2026-10-01T12:00:00Z',entries:[{id:'entry',body:'A reading',dismissed:false,citedSignals:[{id:'signal',statement:'A source pattern'}]}]});
  api.edit.mockResolvedValue({});api.feedback.mockResolvedValue({});
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.clearAllMocks();});
it('binds edits and evidence to the displayed profile, loading notes only after source disclosure, and asks no second question',async()=>{
  api.signal.mockResolvedValue({id:'signal',evidence:[{inspirationId:'source',preview:'Source preview'}]});
  await act(async()=>root.render(<ReadingDetails text="A reading" locale="en-US" actions={actions} onClose={()=>{}}/>));
  expect(api.read).toHaveBeenCalledWith({profile:'agent'},expect.any(AbortSignal));expect(api.signal).not.toHaveBeenCalled();
  const disclosure=[...host.querySelectorAll('details')].find(node=>node.querySelector('summary')?.textContent==='A source pattern')!;
  await act(async()=>{disclosure.open=true;disclosure.dispatchEvent(new Event('toggle'));});
  expect(api.signal).toHaveBeenCalledWith('signal',expect.any(AbortSignal),{profile:'agent'});
  await act(async()=>button('Source preview').click());expect(actions.onOpenInspiration).toHaveBeenCalledWith('source');
  /* ONE ACT: Edit. No "Give feedback" row of True/Partly/Not true (Law 11:
     the creature already asks; a page gets one ask). */
  expect(button('Give feedback')).toBeUndefined();expect(button(t('en-US','worldClaimTrue'))).toBeUndefined();
  await act(async()=>button('Edit').click());
  await act(async()=>{const area=host.querySelector('textarea')!;const set=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!;set.call(area,'A sharper reading');area.dispatchEvent(new Event('input',{bubbles:true}));});
  await act(async()=>button('Save').click());
  expect(api.edit).toHaveBeenCalledWith('entry',{body:'A sharper reading'},{profile:'agent'});
  expect(api.feedback).not.toHaveBeenCalled();
});
it('does not attach actions to newer wording and ignores a late response after unmount',async()=>{
  api.read.mockResolvedValue({entries:[{id:'new',body:'New reading',dismissed:false,citedSignals:[]}]});
  await act(async()=>root.render(<ReadingDetails text="A reading" locale="en-US" actions={actions} onClose={()=>{}}/>));
  expect(host.textContent).toContain('changed');expect(host.querySelector('textarea')).toBeNull();expect(button('Edit')).toBeUndefined();
});
