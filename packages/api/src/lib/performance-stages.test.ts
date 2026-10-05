/** WHAT THIS MOCKS, AND WHY: log sink and provider transport only. Timing
 * forwards real work unchanged and cannot publish content or retry it. */
import {afterEach,expect,it,vi} from 'vitest';
import {measurePerformanceStage,recordPerformanceStage,timeModelProvider} from './performance-stages.js';
import type {ModelProvider} from './model-provider.js';
afterEach(()=>vi.restoreAllMocks());
it('returns the same result and records only timing metadata',async()=>{
  const log=vi.spyOn(console,'info').mockImplementation(()=>{}),result={private:'PRIVATE_INPUT_WORDS'};
  expect(await measurePerformanceStage('context_read','conversation',async()=>result)).toBe(result);
  const data=JSON.parse(log.mock.calls[0][1]);expect(Object.keys(data).sort()).toEqual(['durationMs','operation','outcome','stage']);
  expect(data).toMatchObject({stage:'context_read',operation:'conversation',outcome:'ok'});
  expect(JSON.stringify(log.mock.calls)).not.toContain('PRIVATE_INPUT_WORDS');
});
it('preserves the original error without logging its text and survives a broken sink',async()=>{
  const log=vi.spyOn(console,'info').mockImplementation(()=>{}),error=new Error('sk-secret PRIVATE_WORDS');
  await expect(measurePerformanceStage('embedding','gemini',async()=>{throw error;})).rejects.toBe(error);
  expect(JSON.stringify(log.mock.calls)).not.toContain('PRIVATE_WORDS');expect(JSON.parse(log.mock.calls[0][1]).outcome).toBe('error');
  log.mockImplementation(()=>{throw new Error('sink failed');});
  expect(await measurePerformanceStage('material_read','inspiration',async()=>7)).toBe(7);
});
it('forwards one provider call, preserving this, arguments, result and identity properties',async()=>{
  vi.spyOn(console,'info').mockImplementation(()=>{});const input={private:'PRIVATE_INPUT'},result={answer:'PRIVATE_OUTPUT'},call=vi.fn();
  const provider={name:'fixture',answerConversation:async function(this:unknown,value:unknown){expect(this).toBe(provider);call(value);return result;}} as unknown as ModelProvider;
  const timed=timeModelProvider(provider);expect(timed.name).toBe('fixture');
  expect(await timed.answerConversation(input as never)).toBe(result);expect(call).toHaveBeenCalledExactlyOnceWith(input);
});
it('refuses arbitrary operation labels rather than letting caller content become a log field',()=>{
  const log=vi.spyOn(console,'info').mockImplementation(()=>{});
  recordPerformanceStage('context_read','PRIVATE_INPUT_WORDS',10);expect(log).not.toHaveBeenCalled();
});
