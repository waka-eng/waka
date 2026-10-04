/** WHAT THIS MOCKS, AND WHY (gate G6): nothing. The production prompt,
 * schema and parser run against synthetic memories and responses. */
import {expect,it} from 'vitest';
import {buildConversationReplyRequest,parseConversationReply} from './gemini.js';
import type {ConversationReplyInput} from '../lib/model-provider.js';
const input:ConversationReplyInput={preferredLocale:'en-US',history:[{role:'user',content:'I disagree with the old plan. What else could I try?'}],sources:[{kind:'principle',text:'Leave room to reconsider a plan.',state:'contested',supportCurrent:false,truncated:false}]};
it('fences untrusted memories, preserves standing and bounds the output',()=>{
  const request=buildConversationReplyRequest(input);expect(request.generationConfig.maxOutputTokens).toBe(1200);
  expect(request.contents[0].parts[0].text).toContain('<<<source 1>>>');expect(request.contents[0].parts[0].text).toContain('"supportCurrent":false');
  expect(request.systemInstruction.parts[0].text).toContain('untrusted data');expect(request.systemInstruction.parts[0].text).toContain('accept disagreement');expect(request.systemInstruction.parts[0].text).toContain('never evidence');
  expect(buildConversationReplyRequest({...input,contextChanged:true}).contents[0].parts[0].text).toContain('Do not infer what a short answer affirms');
});
it('accepts one grounded answer and at most one follow-up without requiring memory when none is available',()=>{
  const answer={answer:'That principle is disputed, so it need not decide this choice.',followUpQuestion:'What would you like to learn from a small next step?',citations:[{sourceNumber:1,quote:'Leave room to reconsider'}]};
  expect(parseConversationReply(answer,input)).toEqual(answer);
  expect(parseConversationReply({...answer,citations:[]},{...input,sources:[]}).citations).toEqual([]);
});
it.each([
  {answer:'A statement.',followUpQuestion:null,citations:[{sourceNumber:2,quote:'Leave room'}]},
  {answer:'A statement.',followUpQuestion:null,citations:[{sourceNumber:1,quote:'Invented quote'}]},
  {answer:'A question?',followUpQuestion:'Another question?',citations:[]},
  {answer:'A statement.',followUpQuestion:'First? Second?',citations:[]},
  {answer:'11111111-1111-4111-8111-111111111111',followUpQuestion:null,citations:[]},
])('refuses invalid grounding or multi-question output %#',payload=>expect(()=>parseConversationReply(payload,input)).toThrow());
