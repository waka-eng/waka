/** WHAT THIS MOCKS, AND WHY (gate G6): nothing. Source checks pin the motion
 * safety contract; actual focus/layout/computed styles are checked in browser. */
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
const css=readFileSync(new URL('../src/styles/chrome.css',import.meta.url),'utf8');

it('uses short one-shot effects rather than continuous motion or a delayed action',()=>{
  const effects=[...css.matchAll(/animation:jar-capture-\w+ (\d+)ms ([^;]+);/g)];
  expect(effects).toHaveLength(3);
  for(const effect of effects){expect(Number(effect[1])).toBeLessThanOrEqual(700);expect(effect[2]).not.toContain('infinite');}
  expect(css).toContain('.jar .jar-capture-shortcut { inset:auto; transform:none; }');
});
it('leaves a static spark when reduced motion is requested',()=>{
  const guard=css.match(/@media \(prefers-reduced-motion:reduce\) \{([\s\S]*?)\n\}/)?.[1]??'';
  expect(guard).toContain('.jar-spark-core');expect(guard).toContain('.jar-composer-spark::before');
  expect(guard).toContain('animation:none !important');expect(guard).toContain('transition:none !important');expect(guard).toContain('transform:none !important');
});
