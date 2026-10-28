// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY (gate G6): nothing. Real Actions navigation,
 * focus and locale behavior prove only user destinations remain in the menu. */
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {HomeActions} from '../src/components/HomeActions';
let host:HTMLDivElement,root:Root;
const button=(text:string)=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(node=>node.textContent===text)!;
beforeEach(()=>{(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.clearAllMocks();});
it('keeps principles and review in Actions without a processing queue',async()=>{
  const principles=vi.fn(),review=vi.fn();
  await act(async()=>root.render(<HomeActions locale="en-US" onPrinciples={principles} onReview={review}/>));
  await act(async()=>button('Actions').click());
  expect(host.textContent).not.toContain('Saved inspiration progress');
  await act(async()=>button('View principles').click());
  expect(principles).toHaveBeenCalledOnce();expect(button('Actions').getAttribute('aria-expanded')).toBe('false');
  await act(async()=>button('Actions').click());
  await act(async()=>button('Review suggestions').click());
  expect(review).toHaveBeenCalledOnce();expect(button('Actions').getAttribute('aria-expanded')).toBe('false');
});
it('closes Actions with Escape and restores focus',async()=>{
  await act(async()=>root.render(<HomeActions locale="en-US" onPrinciples={()=>{}}/>));
  await act(async()=>button('Actions').click());
  await act(async()=>button('View principles').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
  expect(button('Actions').getAttribute('aria-expanded')).toBe('false');expect(document.activeElement).toBe(button('Actions'));
});
