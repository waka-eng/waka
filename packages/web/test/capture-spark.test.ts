/** WHAT THIS MOCKS, AND WHY (gate G6): nothing. Source checks pin the motion
 * safety contract; actual focus/layout/computed styles are checked in browser. */
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
const css=readFileSync(new URL('../src/styles/chrome.css',import.meta.url),'utf8');

/* The composer's own spark and its three one-shot keyframes went with the
   heading row that wore it (2026-10-17); what is left is the shortcut. */
it('uses no continuous motion and parks the capture shortcut',()=>{
  expect(css).not.toMatch(/animation:jar-capture-[^;]*infinite/);
  expect(css).toContain('.jar .jar-capture-shortcut { inset:auto; transform:none; }');
});
it('leaves a static spark when reduced motion is requested',()=>{
  const guard=css.match(/@media \(prefers-reduced-motion:reduce\) \{([\s\S]*?)\n\}/)?.[1]??'';
  expect(guard).toContain('.jar-spark-core');
  expect(guard).toContain('animation:none !important');expect(guard).toContain('transition:none !important');expect(guard).toContain('transform:none !important');
});
