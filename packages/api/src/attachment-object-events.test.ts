import { afterEach, expect, it, vi } from 'vitest';
const state=vi.hoisted(()=>({record:vi.fn(),drain:vi.fn()}));
vi.mock('./lib/db.js',()=>({getDb:()=>({})}));
vi.mock('./lib/attachment-uploads.js',()=>({recordAttachmentObjectCreated:state.record}));
vi.mock('./lib/attachment-sweep.js',()=>({attachmentStorageScope:()=> 'synthetic-store',drainAttachmentObjects:state.drain}));
import {handler} from './attachment-object-events.js';
afterEach(()=>{vi.unstubAllEnvs();vi.clearAllMocks();});
function event(id:string,bucket='synthetic',key='profiles%2Fsynthetic%2Ffile+name'){return {messageId:id,body:JSON.stringify({Records:[{eventSource:'aws:s3',eventName:'ObjectCreated:Put',awsRegion:'us-west-2',s3:{bucket:{name:bucket},object:{key}}}]})};}
it('decodes completed keys, ignores unknown inventory and reports only failed SQS items',async()=>{
  vi.stubEnv('ATTACHMENTS_BUCKET','synthetic');vi.stubEnv('ATTACHMENTS_REGION','us-west-2');vi.stubEnv('ATTACHMENTS_ENDPOINT','');
  state.record.mockResolvedValueOnce(false).mockResolvedValueOnce(true);state.drain.mockResolvedValue({failed:1});
  expect(await handler({Records:[event('unknown'),event('failed'),event('wrong-bucket','other')]})).toEqual({batchItemFailures:[{itemIdentifier:'failed'},{itemIdentifier:'wrong-bucket'}]});
  expect(state.record).toHaveBeenCalledWith({},'profiles/synthetic/file name','synthetic-store');expect(state.drain).toHaveBeenCalledTimes(1);
});
it('never treats an AWS event as authority over a local endpoint or runs generation work',async()=>{
  vi.stubEnv('ATTACHMENTS_ENDPOINT','http://127.0.0.1:3011');
  expect(await handler({Records:[event('local')]})).toEqual({batchItemFailures:[{itemIdentifier:'local'}]});expect(state.record).not.toHaveBeenCalled();
});
