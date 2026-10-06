/** WHAT THIS MOCKS, AND WHY: nothing. One pure routing policy governs owned
 * source selection and provider/decoder behavior, not source authorization. */
import {expect,it} from 'vitest';
import {conversationUsesSavedSources} from './conversation-corrections.js';
it.each(['No, I enjoyed it. This month only I want a slower pace.','아니요. 일은 여전히 좋아해요. 이번 달만 가족과 보낼 거예요.'])('omits memory for an ordinary correction: %s',content=>{
  expect(conversationUsesSavedSources([{role:'user',content,correction:true}])).toBe(false);
});
it.each(['Compare this with my saved principle.','이전 원칙과 이번 선택을 비교해 주세요.'])('keeps memory for an explicit comparison: %s',content=>{
  expect(conversationUsesSavedSources([{role:'user',content,correction:true}])).toBe(true);
});
it('ordinary messages and older corrections do not disable the current memory context',()=>{
  expect(conversationUsesSavedSources([{role:'user',content:'A choice.'}])).toBe(true);
  expect(conversationUsesSavedSources([{role:'user',content:'No, this month only.',correction:true},{role:'user',content:'How can my principle help?'}])).toBe(true);
});
