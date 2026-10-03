/** WHAT THIS MOCKS, AND WHY (gate G6): nothing. Real components render
 * synthetic owned API rows; persistence and ownership have SQL coverage. */
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import {ReviewEvidence} from '../src/components/ReviewEvidence';
import {PrincipleEvidence} from '../src/components/PrincipleEvidence';
const row={answerId:'answer-1',sessionId:'session-1',preview:'I do not agree. (I also see a reason to reconsider.)',createdAt:'2026-10-03T00:00:00Z'};
it('labels human review words, preserves negation and links to the exact saved thought once',()=>{
  const html=renderToStaticMarkup(<ReviewEvidence rows={[row,row]} locale="en-US"/>);
  expect(html).toContain(row.preview);expect(html).toContain('From your review');expect(html).toContain('/review/session-1?thought=answer-1');expect(html.match(/<blockquote/g)).toHaveLength(1);
});
it('shows review-only principle support without pretending it was an inspiration',()=>{
  const html=renderToStaticMarkup(<PrincipleEvidence signals={[{id:'signal-1',statement:'A pattern',examples:[],reviewExamples:[row]},{id:'signal-2',statement:'Another pattern',reviewExamples:[row]}]} locale="en-US"/>);
  expect(html.match(/Read your thought/g)).toHaveLength(1);expect(html).not.toContain('Saved inspiration');expect(html).toContain(row.preview);
});
it('escapes authored text and marks long excerpts without exposing raw ids as prose',()=>{
  const html=renderToStaticMarkup(<ReviewEvidence rows={[{...row,preview:'<script>alert(1)</script> '+ 'Words '.repeat(60)}]} locale="en-US"/>);
  expect(html).not.toContain('<script>');expect(html).toContain('&lt;script&gt;');expect(html).toContain('…');expect(html).not.toContain('>answer-1<');
});
