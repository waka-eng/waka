/** WHAT THIS MOCKS, AND WHY: the Lambda SDK transport captures invocation
 * arguments without AWS credentials/network. Durable claims and retries have
 * real SQL coverage in queue-retry-wake.db.test.ts. */
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const {send}=vi.hoisted(()=>({send:vi.fn()}));
vi.mock('@aws-sdk/client-lambda',()=>({
  LambdaClient:class {send=send;},
  InvokeCommand:class {constructor(readonly input:unknown){}},
}));
import {wakeCommittedBackgroundJobs} from './queue.js';
beforeEach(()=>{
  send.mockReset().mockResolvedValue({StatusCode:202});
  vi.stubEnv('WAKA_BACKGROUND_JOB_AUTODRAIN','0');
  vi.stubEnv('WAKA_BACKGROUND_WORKER_FUNCTION','synthetic-worker');
  vi.stubEnv('AWS_LAMBDA_FUNCTION_NAME','synthetic-api');
});
afterEach(()=>{vi.unstubAllEnvs();});
it('marks the existing async enqueue wake so only it opts into bounded native retry delivery',async()=>{
  await wakeCommittedBackgroundJobs();expect(send).toHaveBeenCalledOnce();
  const command=send.mock.calls[0][0];
  expect(command.input).toMatchObject({FunctionName:'synthetic-worker',InvocationType:'Event'});
  expect(JSON.parse(new TextDecoder().decode(command.input.Payload))).toEqual({mode:'enqueue'});
});
it('does not self-invoke the worker when its drain enqueues downstream work',async()=>{
  vi.stubEnv('AWS_LAMBDA_FUNCTION_NAME','synthetic-worker');
  await wakeCommittedBackgroundJobs();expect(send).not.toHaveBeenCalled();
});
it('does not turn a saved capture into a write failure when the wake transport fails',async()=>{
  const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
  try{send.mockRejectedValue(new Error('Synthetic unavailable transport'));await expect(wakeCommittedBackgroundJobs()).resolves.toBeUndefined();}
  finally{warn.mockRestore();}
});
