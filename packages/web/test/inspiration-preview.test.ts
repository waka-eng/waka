/** WHAT THIS MOCKS, AND WHY (gate G6): nothing. The same label builder is
 * used by the ground, newly saved detail and search results. */
import { expect, it } from 'vitest';
import { inspirationPreview } from '../src/lib/inspiration-preview';
it('preserves authored text rather than replacing it with a model reading',()=>{
  expect(inspirationPreview('My own words',[{type:'image',label:'private-file.png'}])).toBe('My own words');
});
it('summarizes media counts without showing filenames or object identifiers',()=>{
  expect(inspirationPreview('',Array.from({length:3},()=>({type:'image' as const,label:'object-key'})))).toBe('3 photos');
  expect(inspirationPreview('',[{type:'audio',label:'abcd.webm'},{type:'image',label:'abcd.png'}])).toBe('Photo · Recording');
});
it('uses a link title or hostname and never leaves an empty capture label',()=>{
  expect(inspirationPreview('',[{type:'link',label:'A place to think'}])).toBe('A place to think');
  expect(inspirationPreview('',[{type:'link',label:'https://example.test/long/path'}])).toBe('example.test');
  expect(inspirationPreview('',[])).toBe('Saved inspiration');
});
