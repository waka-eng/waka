// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY (gate G6): nothing. Callback spies observe which
 * destination the real buttons choose; no backend or generation is involved. */
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {HomeActivities} from '../src/components/HomeActivities';
let host:HTMLDivElement,root:Root;const review=vi.fn(),chat=vi.fn();
beforeEach(()=>{vi.clearAllMocks();(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
const mount=(resuming=false,hasInspirations=true)=>act(async()=>root.render(<HomeActivities locale="en-US" reviewLabel={resuming?'Resume review · 3 selected':'Review your inspirations'} resuming={resuming} hasInspirations={hasInspirations} onReview={review} onChat={chat}/>));
it('gives review and chat their own named activity cards and distinct destinations',async()=>{
  await mount();const buttons=host.querySelectorAll('button');expect(buttons).toHaveLength(2);
  for(const button of buttons){expect(document.getElementById(button.getAttribute('aria-labelledby')!)).not.toBeNull();expect(document.getElementById(button.getAttribute('aria-describedby')!)).not.toBeNull();}
  expect(review).not.toHaveBeenCalled();expect(chat).not.toHaveBeenCalled();
  await act(async()=>buttons[0].click());expect(review).toHaveBeenCalledOnce();expect(chat).not.toHaveBeenCalled();
  await act(async()=>buttons[1].click());expect(chat).toHaveBeenCalledOnce();
});
it('shows resume state without implying a new review, and leaves empty review understandable',async()=>{
  await mount(true);expect(host.textContent).toContain('Resume review · 3 selected');expect(host.textContent).toContain('Continue where you left off.');
  await mount(false,false);expect(host.textContent).toContain('Save an inspiration to begin.');expect(host.querySelector('button')!.disabled).toBe(false);
});
