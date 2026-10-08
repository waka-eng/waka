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
  expect(buttons[0].querySelector('[data-home-action-icon="review"]')).not.toBeNull();
  expect(buttons[1].querySelector('[data-home-action-icon="chat"]')).not.toBeNull();
  for(const icon of host.querySelectorAll('svg')){expect(icon.getAttribute('aria-hidden')).toBe('true');expect(icon.getAttribute('focusable')).toBe('false');}
  expect(host.textContent).not.toContain('↗');expect(host.textContent).toContain('Revisit saved ideas.');expect(host.textContent).toContain('Think through a choice.');
  expect(review).not.toHaveBeenCalled();expect(chat).not.toHaveBeenCalled();
  await act(async()=>buttons[0].click());expect(review).toHaveBeenCalledOnce();expect(chat).not.toHaveBeenCalled();
  await act(async()=>buttons[1].click());expect(chat).toHaveBeenCalledOnce();
});
it('shows resume state without implying a new review, and leaves empty review understandable',async()=>{
  await mount(true);expect(host.textContent).toContain('Resume review · 3 selected');expect(host.textContent).toContain('Continue where you left off.');
  await mount(false,false);expect(host.querySelectorAll('button')).toHaveLength(1);expect(host.textContent).toContain('Talk with WAKA');expect(host.textContent).not.toContain('Review your inspirations');
});
it('keeps visual cues decorative and the Korean action names explicit',async()=>{
  await act(async()=>root.render(<HomeActivities locale="ko-KR" reviewLabel="영감 돌아보기" resuming={false} hasInspirations onReview={review} onChat={chat}/>));
  const titles=[...host.querySelectorAll('.jar-activity-title')].map(element=>element.textContent);
  expect(titles).toEqual(['영감 돌아보기','WAKA와 대화']);
  expect(host.textContent).toContain('저장한 영감을 다시 봐요.');expect(host.textContent).toContain('함께 선택을 생각해 봐요.');
  expect(host.querySelectorAll('[data-home-action-icon]')).toHaveLength(2);
});
it('keeps routine hints accessible without adding a second visible line, retaining the empty-state guidance',async()=>{
  await mount();expect(host.querySelectorAll('.jar-activity-hint.sr-only')).toHaveLength(2);
  await mount(true);expect(host.querySelectorAll('.jar-activity-hint.sr-only')).toHaveLength(2);
  await mount(false,false);expect(host.querySelectorAll('.jar-activity-hint.sr-only')).toHaveLength(1);expect(host.textContent).toContain('Think through a choice.');
  for(const button of host.querySelectorAll('button'))expect(document.getElementById(button.getAttribute('aria-describedby')!)?.textContent).toBeTruthy();
});
