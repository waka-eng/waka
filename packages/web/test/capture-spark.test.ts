/** WHAT THIS MOCKS, AND WHY (gate G6): nothing. Source checks pin the motion
 * safety contract; actual focus/layout/computed styles are checked in browser. */
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
const read=(name:string)=>readFileSync(new URL(`../src/styles/${name}`,import.meta.url),'utf8');
const css=read('chrome.css');
const blank=(s:string)=>s.replace(/\/\*[\s\S]*?\*\//g,'');
/** Every innermost `selector { body }` rule, inside or outside an at-rule. */
const rules=(s:string)=>[...blank(s).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m=>({selector:m[1]!.trim(),body:m[2]!}));
const SPARK=/jar-capture-shortcut|jar-spark-(core|rays)|jar-mouth-rest/;

/* The composer's own spark and its three one-shot keyframes went with the
   heading row that wore it (2026-10-17). What is left — the capture shortcut,
   the mouth at rest and the spark glyph inside them — moves only by
   transition, on a press or a hover. No keyframe animation runs on them at
   all, so nothing can loop and nothing can fire late; this fails the day one
   is added without coming back here. */
it('runs no keyframe animation on the capture shortcut or its spark',()=>{
  const spark=[...rules(css),...rules(read('home.css'))].filter(r=>SPARK.test(r.selector));
  expect(spark.length).toBeGreaterThan(5);
  const animated=spark.filter(r=>/(^|[;\s])animation(-name)?\s*:\s*(?!none)/.test(r.body)).map(r=>r.selector);
  expect(animated).toEqual([]);
  expect(css).toContain('.jar .jar-capture-shortcut { inset:auto; transform:none; }');
});
it('leaves a static spark when reduced motion is requested',()=>{
  const guard=css.match(/@media \(prefers-reduced-motion:reduce\) \{([\s\S]*?)\n\}/)?.[1]??'';
  expect(guard).toContain('.jar-spark-core');expect(guard).toContain('.jar-spark-rays');
  expect(guard).toContain('.jar .jar-capture-shortcut::before');
  expect(guard).toContain('animation:none !important');expect(guard).toContain('transition:none !important');expect(guard).toContain('transform:none !important');
});
