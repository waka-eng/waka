/** WHAT THIS MOCKS, AND WHY (gate G6): nothing. The production prompt,
 * schema and parser run against synthetic memories and responses. */
import {expect,it} from 'vitest';
import {buildConversationReplyRequest,parseConversationReply} from './gemini.js';
import type {ConversationReplyInput} from '../lib/model-provider.js';
const input:ConversationReplyInput={preferredLocale:'en-US',history:[{role:'user',content:'I disagree with the old plan. What else could I try?'}],sources:[{kind:'principle',text:'Leave room to reconsider a plan.',state:'contested',supportCurrent:false,truncated:false}]};
it('fences untrusted memories, preserves standing and bounds the output',()=>{
  const request=buildConversationReplyRequest(input);expect(request.generationConfig.maxOutputTokens).toBe(1200);
  expect(request.contents[0].parts[0].text).toContain('<<<source 1>>>');expect(request.contents[0].parts[0].text).toContain('"supportCurrent":false');
  expect(request.systemInstruction.parts[0].text).toContain('untrusted data');expect(request.systemInstruction.parts[0].text).toContain('Accept disagreement');expect(request.systemInstruction.parts[0].text).toContain('never evidence');
  expect(buildConversationReplyRequest({...input,contextChanged:true}).contents[0].parts[0].text).toContain('Do not infer what a short answer affirms');
  expect(request.systemInstruction.parts[0].text).toContain('give no switch/keep recommendation');
  expect(request.systemInstruction.parts[0].text).toContain('a neutral question');
});
it('labels a correction and prioritizes it without claiming a principle edit',()=>{
  const request=buildConversationReplyRequest({...input,history:[{role:'user',content:'I no longer agree with this rule.',correction:true}]});
  expect(request.contents[0].parts[0].text).toContain('user correction');expect(request.systemInstruction.parts[0].text).toContain('This chat never edits or creates');
  expect(request.systemInstruction.parts[0].text).toContain('Principles can emerge automatically');
});
it('omits saved wording and its focus for a deliberate correction, without mutating the caller',()=>{
  const correction:ConversationReplyInput={...input,focusSourceNumber:1,history:[{role:'user',content:'No, I still enjoy work. This month only I want one family day.',correction:true}]};
  const request=buildConversationReplyRequest(correction),text=request.contents[0].parts[0].text;
  expect(text).not.toContain('<<<source 1>>>');
  expect(text).not.toContain('began this conversation from source');
  expect(correction.sources).toEqual(input.sources);expect(correction.focusSourceNumber).toBe(1);
  expect(parseConversationReply({answer:'This is a change for this month, not a new long-term rule.',followUpQuestion:null,citations:[]},correction).citations).toEqual([]);
  expect(()=>parseConversationReply({answer:'The old principle still applies.',followUpQuestion:null,citations:[{sourceNumber:1,quote:'Leave room to reconsider'}]},correction)).toThrow('conversation grounding');
});
it.each(['Compare this with my saved principle.','이전 원칙과 이번 선택을 비교해 주세요.'])('retains saved sources for an explicitly requested correction comparison: %s',content=>{
  const correction:ConversationReplyInput={...input,history:[{role:'user',content,correction:true}]};
  expect(buildConversationReplyRequest(correction).contents[0].parts[0].text).toContain('<<<source 1>>>');
  const answer={answer:'The recorded principle leaves room to reconsider.',followUpQuestion:null,citations:[{sourceNumber:1,quote:'Leave room to reconsider'}]};
  expect(parseConversationReply(answer,correction)).toEqual(answer);
});
it('carries capture dates separately from exact source text and explains their limit',()=>{
  const request=buildConversationReplyRequest({...input,messageDate:'2026-10-03',sources:[{kind:'inspiration',text:'Marathon training.',recordedAt:'2021-06-01T00:00:00Z',truncated:false}]});
  expect(request.contents[0].parts[0].text).toContain('2021-06-01');expect(request.contents[0].parts[0].text).toContain('Latest user message date: 2026-10-03');expect(request.systemInstruction.parts[0].text).toContain('not proof that an interest is current');
});
it('accepts one grounded answer and at most one follow-up without requiring memory when none is available',()=>{
  const answer={answer:'That principle is disputed, so it need not decide this choice.',followUpQuestion:'What would you like to learn from a small next step?',citations:[{sourceNumber:1,quote:'Leave room to reconsider'}]};
  expect(parseConversationReply(answer,input)).toEqual(answer);
  expect(parseConversationReply({...answer,citations:[]},{...input,sources:[]}).citations).toEqual([]);
});
it('accepts a requested list of questions without an additional follow-up',()=>{
  const reply={answer:'1. What caught your attention?\n2. What does it connect to?\n3. What might you try?',followUpQuestion:null,citations:[]};
  expect(parseConversationReply(reply,{...input,sources:[]})).toEqual(reply);
  expect(buildConversationReplyRequest(input).generationConfig.responseSchema.properties!.answer).not.toHaveProperty('pattern');
});
it('asks for a new follow-up rather than repeating an earlier assistant question',()=>{
  const previous='What is the one decision you most want people to make in this dashboard?';
  const continuation:ConversationReplyInput={...input,history:[{role:'user',content:'Help with this dashboard.'},{role:'assistant',content:'Start with one clear action.\n'+previous},{role:'user',content:'Let’s explore this idea further.'}]};
  expect(buildConversationReplyRequest(continuation).systemInstruction.parts[0].text).toContain('Never repeat a question already asked by an assistant');
  expect(parseConversationReply({answer:'We can explore the important action.',followUpQuestion:previous,citations:[]},continuation)).toEqual({answer:'We can explore the important action.',followUpQuestion:null,citations:[]});
  expect(()=>parseConversationReply({answer:'We can explore the important action.',followUpQuestion:previous,citations:[{sourceNumber:1,quote:'Invented words'}]},continuation)).toThrow('conversation grounding');
  expect(()=>parseConversationReply({answer:'A second question?',followUpQuestion:previous,citations:[]},continuation)).toThrow('conversation grounding');
  expect(parseConversationReply({answer:'We can explore the important action.',followUpQuestion:'Where did people hesitate in the prototype?',citations:[]},continuation).followUpQuestion).toContain('hesitate');
});
it.each([
  {answer:'A statement.',followUpQuestion:null,citations:[{sourceNumber:2,quote:'Leave room'}]},
  {answer:'A statement.',followUpQuestion:null,citations:[{sourceNumber:1,quote:'Invented quote'}]},
  {answer:'A question?',followUpQuestion:'Another question?',citations:[]},
  {answer:'A statement.',followUpQuestion:'First? Second?',citations:[]},
  {answer:'11111111-1111-4111-8111-111111111111',followUpQuestion:null,citations:[]},
])('refuses invalid grounding or multi-question output %#',payload=>expect(()=>parseConversationReply(payload,input)).toThrow());
