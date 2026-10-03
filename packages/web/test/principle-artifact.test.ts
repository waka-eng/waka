/** WHAT THIS MOCKS, AND WHY (gate G6): nothing. Wrapping is exercised with
 * an explicit deterministic width function; real canvas output is checked
 * in the browser. No source or network state is replaced. */
import {expect,it} from 'vitest';
import {wrapArtifactText} from '../src/lib/principle-artifact';
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
