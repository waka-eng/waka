// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY (gate G6): nothing. React renders real prose,
 * lists and emphasis; untrusted model markup never enters an HTML sink. */
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {expect,it} from 'vitest';
import {ConversationText} from '../src/components/ConversationText';
it('formats short lists and emphasis while leaving HTML and unsafe links inert',async()=>{
  (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  const host=document.createElement('div'),root=createRoot(host);
  await act(async()=>root.render(<ConversationText text={'**A choice**\n\n- One option\n- `Another` option\n\n<img src=x onerror=alert(1)> [link](javascript:alert(1))'}/>));
  expect(host.querySelector('strong')?.textContent).toBe('A choice');expect(host.querySelectorAll('li')).toHaveLength(2);
  expect(host.querySelector('code')?.textContent).toBe('Another');expect(host.querySelector('img,a,script')).toBeNull();
  expect(host.textContent).toContain('<img');await act(async()=>root.unmount());
});
