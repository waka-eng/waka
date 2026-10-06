/** WHAT THIS MOCKS, AND WHY: `fetch` supplies synthetic provider envelopes and
 * `process.stdout.write` captures numeric logs. Real transports and limits run. */
import {afterEach,expect,it,vi} from 'vitest';
import {callOpenRouter} from './openrouter-http.js';
import {fetchModelWithTimeout} from './gemini-http.js';
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.unstubAllEnvs();});
const request={model:'deepseek/deepseek-v4.1-flash',messages:[{role:'user' as const,content:'PRIVATE_INPUT'}]};
it('records one priced OpenRouter envelope even when its answer is unusable',async()=>{
  vi.stubEnv('OPENROUTER_API_KEY','SYNTHETIC_KEY');vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({usage:{cost:.002,prompt_tokens:50,completion_tokens:10},choices:[{message:{content:'not JSON'}}]}))));
  const write=vi.spyOn(process.stdout,'write').mockImplementation(()=>true);
  expect(await callOpenRouter(request,'conversation reply')).toBeNull();
  expect(write).toHaveBeenCalledOnce();expect(JSON.parse(write.mock.calls[0][0] as string)).toMatchObject({CostUsd:.002,ModelRequests:1});
  expect(write.mock.calls[0][0]).not.toMatch(/PRIVATE_INPUT|SYNTHETIC_KEY|not JSON/);
});
it('HTTP failure and ambiguous transport failure each retain one attempt',async()=>{
  vi.stubEnv('OPENROUTER_API_KEY','SYNTHETIC_KEY');const write=vi.spyOn(process.stdout,'write').mockImplementation(()=>true);
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({error:{message:'PRIVATE_ERROR'}}),{status:503})));
  await expect(callOpenRouter(request,'conversation reply')).rejects.toThrow();expect(write).toHaveBeenCalledOnce();
  expect(JSON.parse(write.mock.calls[0][0] as string)).toMatchObject({outcome:'http_error',UnpricedRequests:1});
  write.mockClear();vi.stubGlobal('fetch',vi.fn(async()=>{throw new Error('PRIVATE_FAILURE');}));
  await expect(callOpenRouter(request,'conversation reply')).rejects.toThrow();expect(write).toHaveBeenCalledOnce();
  expect(JSON.parse(write.mock.calls[0][0] as string)).toMatchObject({outcome:'unknown',UnpricedRequests:1});
});
it('Gemini embedding metadata is attributed once without a dollar estimate or vector',async()=>{
  const write=vi.spyOn(process.stdout,'write').mockImplementation(()=>true);
  const response=await fetchModelWithTimeout(async()=>new Response(JSON.stringify({embedding:{values:[1,2,3]},usageMetadata:{promptTokenCount:20}})),
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent');
  expect((await response.json() as {embedding:{values:number[]}}).embedding.values).toEqual([1,2,3]);expect(write).toHaveBeenCalledOnce();
  expect(JSON.parse(write.mock.calls[0][0] as string)).toMatchObject({Provider:'gemini',operation:'embedding',UnpricedRequests:1,inputTokens:20});
  expect(write.mock.calls[0][0]).not.toContain('values');
});
