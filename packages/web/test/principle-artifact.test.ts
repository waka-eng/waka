/** WHAT THIS MOCKS, AND WHY (gate G6): nothing. Wrapping is exercised with
 * an explicit deterministic width function; real canvas output is checked
 * in the browser. No source or network state is replaced. */
import {expect,it} from 'vitest';
import {fitSizes,wrapArtifactText} from '../src/lib/principle-artifact';
it('preserves Korean, explicit paragraphs and complete emoji graphemes',()=>{
  const segmenter=new Intl.Segmenter(undefined,{granularity:'grapheme'});
  const measure=(value:string)=>Array.from(segmenter.segment(value)).length;
  const input='천천히 생각하고 함께 결정해요\n\n👨‍👩‍👧‍👦 가족과 시간을 보내요';
  const lines=wrapArtifactText(input,8,measure);
  expect(lines.join('').replace(/\s/g,'')).toBe(input.replace(/\s/g,''));
  expect(lines).toContain('');expect(lines.some(line=>line.includes('👨‍👩‍👧‍👦'))).toBe(true);
  expect(lines.every(line=>measure(line)<=8)).toBe(true);
});
it('breaks a long word without silently dropping any characters',()=>{
  const value='a'.repeat(300);const lines=wrapArtifactText(value,20,text=>text.length);
  expect(lines.join('')).toBe(value);expect(lines.every(line=>line.length<=20)).toBe(true);
});
/* THE BUMP NEVER RAISES A FLOOR (founder, 2026-10-18, "very slightly bigger"):
   the fits start ~6% higher and still reach the floors they reached before,
   so nothing that fitted stops fitting. */
it('starts the fits higher and still ends them on the old floors',()=>{
  const principle=fitSizes('principle'),held=fitSizes('held');
  expect(principle[0]).toBe(70);expect(principle.at(-1)).toBe(36);expect(principle).toContain(66);
  expect(held[0]).toBe(51);expect(held.at(-1)).toBe(28);
  for(const sizes of [principle,held]){
    expect([...sizes].sort((a,b)=>b-a)).toEqual(sizes);
    for(let i=1;i<sizes.length;i++)expect(sizes[i-1]!-sizes[i]!).toBeLessThanOrEqual(2);
  }
});
