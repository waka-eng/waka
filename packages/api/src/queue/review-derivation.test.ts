/** WHAT THIS MOCKS, AND WHY (gate G6): nothing. Real prompts and parsers
 * inspect complete human words, contextual material and model wire shapes. */
import {expect,it} from 'vitest';
import {buildReviewAnswerDerivationRequest,parseReviewAnswerDerivation} from './gemini.js';
import type {ReviewAnswerDerivationInput} from '../lib/model-provider.js';
const input:ReviewAnswerDerivationInput={preferredLocale:'en-US',answer:'I leave room to change plans. I do not agree that every minute needs to be productive.',question:'What stayed with you?',contextChanged:false,
  sources:[{text:'Quoted article: every minute should be productive.',reflections:[],attachments:[]}],claims:[{signalId:'claim',statement:'I leave room to change plans.'}],discover:true};
it('keeps the full answer, fences instructions and treats AI/source wording as context rather than evidence',()=>{
  const request=buildReviewAnswerDerivationRequest({...input,answer:'x'.repeat(15950)+' I reject that conclusion.',contextChanged:true});
  expect(request.contents[0]!.parts[0]!.text).toContain('I reject that conclusion.');
  expect(request.systemInstruction.parts[0]!.text).toContain('bare yes');expect(request.systemInstruction.parts[0]!.text).toContain('Preserve negation');
  expect(request.contents[0]!.parts[0]!.text).toContain('Earlier question context changed: true');
});
it('accepts an exact supported span and an empty discovery',()=>{
  expect(parseReviewAnswerDerivation({assessments:[{signalId:'claim',verdict:'supported',quote:'I leave room to change plans.'}],statements:[]},input).assessments).toHaveLength(1);
});
it.each([
  {assessments:[],statements:[]},
  {assessments:[{signalId:'other',verdict:'unsupported',quote:null}],statements:[]},
  {assessments:[{signalId:'claim',verdict:'supported',quote:'every minute should be productive'}],statements:[]},
  {assessments:[{signalId:'claim',verdict:'unsupported',quote:null}],statements:[{statement:'The AI question becomes a belief',quote:'What stayed with you?'}]},
])('rejects missing, foreign or non-human grounding %#',result=>expect(()=>parseReviewAnswerDerivation(result,input)).toThrow());
it('does not allow discovery during a support-only batch',()=>{
  expect(()=>parseReviewAnswerDerivation({assessments:[{signalId:'claim',verdict:'unsupported',quote:null}],statements:[{statement:'I leave room to change plans.',quote:'I leave room to change plans.'}]},{...input,discover:false})).toThrow();
});
