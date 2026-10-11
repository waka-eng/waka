/** WHAT THIS MOCKS, AND WHY (gate G6): nothing. Real components render
 * synthetic owned API rows; persistence and ownership have SQL coverage. */
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import {ReviewEvidence} from '../src/components/ReviewEvidence';
import {PrincipleEvidence} from '../src/components/PrincipleEvidence';
const row={answerId:'answer-1',sessionId:'session-1',preview:'I do not agree. (I also see a reason to reconsider.)',createdAt:'2026-10-03T00:00:00Z'};
/* THE LINK ASSERTION BECAME ITS OPPOSITE (2026-10-10), deliberately. Each
   quote used to carry `Read your thought ↗`, addressed at
   `/review/:session?thought=:answer`. That route is deleted with the review
   flow, so the link would have rendered, read correctly and gone nowhere —
   `docs/six-laws.md` Law 8, which is the one failure shape this codebase has
   met most often. Asserting its ABSENCE is what now protects the invariant
   the old assertion protected: every control on this block leads somewhere.
   Everything else here is unchanged, because the words themselves are
   unchanged — the quote, its label, the de-duplication across signals, and
   the escaping all still have to hold. */
it('labels human review words, preserves negation and quotes one saved thought once',()=>{
  const html=renderToStaticMarkup(<ReviewEvidence rows={[row,row]} locale="en-US"/>);
  expect(html).toContain(row.preview);expect(html).toContain('From your review');expect(html.match(/<blockquote/g)).toHaveLength(1);
  expect(html).not.toContain('/review/');expect(html).not.toContain('<a ');
});
it('shows review-only principle support without pretending it was an inspiration',()=>{
  const html=renderToStaticMarkup(<PrincipleEvidence signals={[{id:'signal-1',statement:'A pattern',examples:[],reviewExamples:[row]},{id:'signal-2',statement:'Another pattern',reviewExamples:[row]}]} locale="en-US"/>);
  expect(html.match(/From your review/g)).toHaveLength(1);expect(html).not.toContain('Saved inspiration');expect(html).toContain(row.preview);
});
it('escapes authored text and marks long excerpts without exposing raw ids as prose',()=>{
  const html=renderToStaticMarkup(<ReviewEvidence rows={[{...row,preview:'<script>alert(1)</script> '+ 'Words '.repeat(60)}]} locale="en-US"/>);
  expect(html).not.toContain('<script>');expect(html).toContain('&lt;script&gt;');expect(html).toContain('…');expect(html).not.toContain('>answer-1<');
});
