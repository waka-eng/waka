/** WHAT THIS MOCKS, AND WHY (gate G6): nothing. Fixed labels are data; these
 * assertions protect their integrity, not semantic model quality. */
import {expect,it} from 'vitest';
import {retrievalSources,retrievalCases,retrievalHoldoutCases,retrievalValidationCases,retrievalGate} from '../../../tools/e2e/conversation-retrieval-cases.js';
it('keeps the original comparison, rejected holdout and fresh validation distinct',()=>{
  expect(retrievalCases).toHaveLength(24);expect(retrievalHoldoutCases).toHaveLength(8);expect(retrievalValidationCases).toHaveLength(8);
  const all=[...retrievalCases,...retrievalHoldoutCases,...retrievalValidationCases];
  expect(new Set(all.map(row=>row.id)).size).toBe(40);
  const known=new Set(retrievalSources.filter(row=>!row.foreign).map(row=>row.id));
  for(const row of all){for(const id of [...row.required,...row.allowed])expect(known.has(id)).toBe(true);for(const id of row.required)expect(row.allowed).toContain(id);}
});
it('keeps no-output controls and the predeclared quality gate',()=>{
  expect(retrievalCases.filter(row=>row.required.length===0)).toHaveLength(3);
  expect(retrievalValidationCases.filter(row=>row.required.length===0)).toHaveLength(2);
  expect(retrievalGate).toEqual({minimumRecall:.9,minimumSemanticGain:3,maximumNegativeMatches:0,unexpectedMatchesMustNotIncrease:true});
});
