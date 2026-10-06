// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY: nothing. A real label is rendered inside a real
 * button; source data is passed as props. No backend or generation is used. */
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {expect,it} from 'vitest';
import {PrinciplesShortcutLabel} from '../src/components/PrinciplesShortcutLabel';
it('names the destination and distinguishes unknown, zero, and available counts',async()=>{
  (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  const host=document.createElement('div'),root=createRoot(host);
  try{
    await act(async()=>root.render(<button><PrinciplesShortcutLabel locale="en-US" count={null}/></button>));
    expect(host.textContent).toBe('Principles');expect(host.querySelector('.jar-values-count')).toBeNull();
    await act(async()=>root.render(<button><PrinciplesShortcutLabel locale="en-US" count={3}/></button>));
    expect(host.querySelector('.sr-only')?.textContent).toBe('3 available');expect(host.querySelector('.jar-values-count')?.getAttribute('aria-hidden')).toBe('true');
    await act(async()=>root.render(<button><PrinciplesShortcutLabel locale="ko-KR" count={0}/></button>));
    expect(host.textContent).toContain('원칙');expect(host.querySelector('.jar-values-count')?.textContent).toBe('0');
  }finally{await act(async()=>root.unmount());}
});
