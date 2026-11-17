/** WHAT THIS MOCKS, AND WHY: `process.stdout.write` captures raw metric JSON
 * and a broken sink. Usage bodies are synthetic; no provider is called. */
import {afterEach,expect,it,vi} from 'vitest';
import {recordModelUsage} from './model-usage.js';
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});
it('records native OpenAI as bounded content-free logs, adding zero EMF series and no fictional returned cost',()=>{
  vi.stubEnv('WAKA_STAGE','development');const write=vi.spyOn(process.stdout,'write').mockImplementation(()=>true);
  recordModelUsage('openai','conversation reply',{usage:{input_tokens:25,output_tokens:9,cost:999,input_tokens_details:{cached_tokens:4},output_tokens_details:{reasoning_tokens:3}},output:'PRIVATE_OUTPUT'},5,'received',{model:'gpt-6.1-terra',reasoning:'low',result:'json_decoded'});
  const text=String(write.mock.calls[0][0]),result=JSON.parse(text);
  expect(result).toMatchObject({Provider:'openai',Stage:'development',operation:'conversation',UnpricedRequests:1,costStatus:'unknown',reasoningTokens:3,cachedInputTokens:4});
  expect(result).not.toHaveProperty('_aws');expect(result).not.toHaveProperty('CostUsd');expect(text).not.toContain('PRIVATE_OUTPUT');expect(Buffer.byteLength(text)).toBeLessThan(1024);
  recordModelUsage('openai','PRIVATE_LABEL',null,5,'received',{model:'PRIVATE_MODEL',reasoning:'PRIVATE_REASONING',result:'PRIVATE_RESULT'} as never);
  expect(String(write.mock.calls[1][0])).not.toContain('PRIVATE_');
});
it('records precise returned cost and tokens without private provider fields',()=>{
  vi.stubEnv('WAKA_STAGE','development');const write=vi.spyOn(process.stdout,'write').mockImplementation(()=>true);
  recordModelUsage('openrouter','conversation reply',{usage:{cost:.004,prompt_tokens:500,completion_tokens:30},choices:[{message:{content:'PRIVATE_OUTPUT'}}],id:'PRIVATE_ID'},123,'received');
  const result=JSON.parse(write.mock.calls[0][0] as string);
  expect(result).toMatchObject({Stage:'development',Provider:'openrouter',operation:'conversation',CostUsd:.004,UnpricedRequests:0,inputTokens:500,outputTokens:30,ModelRequests:1});
  expect(JSON.stringify(result)).not.toMatch(/PRIVATE_OUTPUT|PRIVATE_ID|choices/);
});
it('records transcription usage and classifies image calls without storing media or transcripts',()=>{
  const write=vi.spyOn(process.stdout,'write').mockImplementation(()=>true);
  recordModelUsage('openrouter','audio transcription',{text:'PRIVATE_TRANSCRIPT',usage:{cost:.00035,input_tokens:100,output_tokens:20}},50,'received');
  expect(JSON.parse(write.mock.calls[0][0] as string)).toMatchObject({operation:'audio_transcription',CostUsd:.00035,inputTokens:100,outputTokens:20});
  expect(write.mock.calls[0][0]).not.toContain('PRIVATE_TRANSCRIPT');
  recordModelUsage('openrouter','image description',null,10,'unknown');
  expect(JSON.parse(write.mock.calls[1][0] as string)).toMatchObject({operation:'image_description',UnpricedRequests:1});
});
it.each([{}, {usage:{cost:-1}},{usage:{cost:'0.004'}}])('missing or invalid cost stays explicitly unpriced %#',body=>{
  const write=vi.spyOn(process.stdout,'write').mockImplementation(()=>true);recordModelUsage('openrouter','PRIVATE_LABEL',body,100,'received');
  const result=JSON.parse(write.mock.calls[0][0] as string);expect(result.UnpricedRequests).toBe(1);expect(result).not.toHaveProperty('CostUsd');expect(result.operation).toBe('other');
  expect(JSON.stringify(result)).not.toContain('PRIVATE_LABEL');
});
it('does not invent Gemini dollar costs from token metadata',()=>{
  const write=vi.spyOn(process.stdout,'write').mockImplementation(()=>true);
  recordModelUsage('gemini','signal extraction',{usageMetadata:{promptTokenCount:100,candidatesTokenCount:20}},12,'received');
  expect(JSON.parse(write.mock.calls[0][0] as string)).toMatchObject({UnpricedRequests:1,inputTokens:100,outputTokens:20});
});
it('counts ambiguous failures without assuming zero charges, even with a broken log sink',()=>{
  const write=vi.spyOn(process.stdout,'write').mockImplementation(()=>true);recordModelUsage('openrouter','conversation reply',null,50,'unknown');
  expect(JSON.parse(write.mock.calls[0][0] as string)).toMatchObject({outcome:'unknown',UnpricedRequests:1});
  write.mockImplementation(()=>{throw new Error('Broken log');});expect(()=>recordModelUsage('openrouter','conversation reply',null,50,'unknown')).not.toThrow();
});
