/** WHAT THIS MOCKS, AND WHY (gate G6): nothing. Fixed synthetic evaluation
 * inputs are data; importing them must not create a provider or contact a DB.
 * These structural assertions do not claim model quality. */
import {describe,expect,it} from 'vitest';
import {conversationQualityCases} from '../../../tools/e2e/conversation-quality-cases.js';
import {conversationDirectAnswerCases} from '../../../tools/e2e/conversation-direct-answer-cases.js';

describe('predeclared chat polish matrix',()=>{
  it('preserves the original 18 safety cases and adds six distinct direct-answer cases',()=>{
    expect(conversationQualityCases).toHaveLength(18);
    expect(conversationDirectAnswerCases).toHaveLength(6);
    const all=[...conversationQualityCases,...conversationDirectAnswerCases];
    expect(new Set(all.map(item=>item.name)).size).toBe(24);
    for(const item of all){
      expect(item.expectation.length).toBeGreaterThan(40);
      expect(item.input.history.at(-1)?.role).toBe('user');
    }
  });
  it('balances added English and Korean cases and explicitly tests optional memory',()=>{
    expect(conversationDirectAnswerCases.filter(item=>item.input.preferredLocale==='en-US')).toHaveLength(3);
    expect(conversationDirectAnswerCases.filter(item=>item.input.preferredLocale==='ko-KR')).toHaveLength(3);
    const unrelated=conversationDirectAnswerCases.find(item=>item.name==='irrelevant-memory-ko')!;
    expect(unrelated.input.sources).toHaveLength(1);
    expect(unrelated.expectation).toContain('Do not force');
    expect(conversationDirectAnswerCases.find(item=>item.name==='requested-question-list-en')?.expectation).toContain('followUpQuestion is null');
  });
});
