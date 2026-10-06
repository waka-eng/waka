// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY: nothing. Real rendering tests date disclosure,
 * not a claim about when a belief or the person's identity changed. */
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {expect,it} from 'vitest';
import {ConversationSourceDate} from '../src/components/ConversationSourceDate';
it('distinguishes an earlier record from current content without inventing a missing date',async()=>{
  (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  const host=document.createElement('div'),root=createRoot(host);
  try{
    await act(async()=>root.render(<ConversationSourceDate locale="en-US" historical={false} recordedAt="2026-09-01T12:00:00Z"/>));expect(host.textContent).toBe('');
    await act(async()=>root.render(<ConversationSourceDate locale="en-US" historical recordedAt="2026-09-01T12:00:00Z"/>));expect(host.textContent).toContain('Earlier reading · Sep 1, 2026');
    await act(async()=>root.render(<ConversationSourceDate locale="en-US" historical recordedAt="2026-09-01T00:00:00Z"/>));expect(host.textContent).toContain('Earlier reading · Sep 1, 2026');
    await act(async()=>root.render(<ConversationSourceDate locale="ko-KR" historical/>));expect(host.textContent).toBe('이전의 읽기');
  }finally{await act(async()=>root.unmount());}
});
