/** WHAT THIS MOCKS, AND WHY (gate G6): nothing. Synthetic vectors isolate
 * rank arithmetic; they do not establish real embedding retrieval quality. */
import {expect,it} from 'vitest';
import {rankConversationCandidates} from './conversation-retrieval.js';
it('combines exact and semantic matches without duplicate sources',()=>{
  const selected=rankConversationCandidates(['exact','both'],[{id:'both',similarity:.9,vector:[1,0]},{id:'paraphrase',similarity:.8,vector:[0,1]}]);
  expect(selected[0]).toBe('both');expect(new Set(selected).size).toBe(selected.length);expect(selected).toContain('exact');expect(selected).toContain('paraphrase');
});
it('keeps a lexical fallback and caps the final source list',()=>{
  expect(rankConversationCandidates(['a','b'],[])).toEqual(['a','b']);
  expect(rankConversationCandidates(Array.from({length:30},(_,i)=>String(i)),[])).toHaveLength(6);
});
it('prefers a diverse candidate to a near duplicate at similar rank',()=>{
  const result=rankConversationCandidates([],[{id:'first',similarity:.95,vector:[1,0]},{id:'duplicate',similarity:.94,vector:[1,0]},{id:'different',similarity:.9,vector:[0,1]}]);
  expect(result.slice(0,2)).toEqual(['first','different']);
});
it('does not inject a semantic candidate below the existing recall floor',()=>{
  expect(rankConversationCandidates([],[{id:'irrelevant',similarity:.2,vector:[1,0]}])).toEqual([]);
});
it('does not fill spare slots with weak semantic neighbors or contradicted keyword matches',()=>{
  const result=rankConversationCandidates(['weak','unindexed'],[{id:'strong',similarity:.72,vector:[1,0]},{id:'weak',similarity:.62,vector:[0,1]}],new Map([['strong',.72],['weak',.62]]));
  expect(result).toContain('strong');expect(result).toContain('unindexed');expect(result).not.toContain('weak');
});
it('abstains on weak semantic-only overlap while preserving keyword-corroborated matches',()=>{
  const weak=[{id:'note',similarity:.62,vector:[1,0]}];
  expect(rankConversationCandidates([],weak)).toEqual([]);
  expect(rankConversationCandidates(['note'],weak)).toEqual(['note']);
});
