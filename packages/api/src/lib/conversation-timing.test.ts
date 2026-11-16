/** WHAT THIS MOCKS, AND WHY: injected monotonic clock/log sink make numeric
 * phase accounting deterministic; no SQL, provider or user material is read. */
import {expect,it} from 'vitest';
import {createConversationTiming} from './conversation-timing.js';
it('records fixed phase durations once without accepting private dimensions',async()=>{
 let clock=0;const rows:unknown[]=[];const timing=createConversationTiming(()=>clock,row=>rows.push(row));
 expect(await timing.measure('prepare',async()=>{clock+=12;return 7;})).toBe(7);
 await timing.measure('lookup',async()=>{clock+=24;});
 await timing.measure('PRIVATE_PHASE_CANARY' as never,async()=>{clock+=2;});
 timing.finish({answerAttempted:true,published:false,profileId:'PRIVATE_ACCOUNT_CANARY'} as never);
 expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({event:'conversation_timing',totalMs:38,phaseMs:{prepare:12,lookup:24,revalidate:null,answer:null,publication:null},answerAttempted:true,published:false});
 expect(JSON.stringify(rows)).not.toMatch(/PRIVATE_|_aws/);
});
it('preserves the actual failure and contains a broken log sink',async()=>{
 let clock=0;const rows:any[]=[];const timing=createConversationTiming(()=>clock,row=>rows.push(row)),failure=Error('PRIVATE_ERROR_CANARY');
 await expect(timing.measure('answer',async()=>{clock+=9;throw failure;})).rejects.toBe(failure);
 timing.finish({answerAttempted:true,published:false});expect(rows[0].phaseError.answer).toBe(true);expect(rows[0].phaseMs.answer).toBe(9);expect(JSON.stringify(rows)).not.toContain('PRIVATE_ERROR_CANARY');
 const broken=createConversationTiming(()=>0,()=>{throw failure;});expect(()=>broken.finish({answerAttempted:false,published:false})).not.toThrow();
});

import {afterEach,vi} from 'vitest';
import {createConversationApiTiming} from './conversation-timing.js';
const requestId='11111111-1111-4111-8111-111111111111';
afterEach(()=>vi.unstubAllEnvs());
it('measures original awaits and their resolution tail with one completion event',()=>{
 vi.stubEnv('WAKA_STAGE','development');let clock=0;const rows:any[]=[];
 const timing=createConversationApiTiming('message',true,()=>clock,row=>rows.push(row));
 timing.mark('transaction');clock=20;timing.observe({requestId,revision:121,admission:'new'});timing.bodyFinished();clock=24;timing.mark('resolved');
 timing.mark('sweep');clock=27;timing.mark('wake');clock=35;timing.finish(true);timing.finish();
 expect(rows).toHaveLength(1);expect(rows[0]).toEqual({event:'conversation_api_timing',Stage:'development',operation:'message',transactionOutcome:'resolved',admission:'new',revisionBucket:'long',requestId,responseReady:true,totalMs:35,transactionMs:24,bodyExitToResolutionMs:4,sweepMs:3,wakeMs:8});
});
it('does not infer rollback or confirmation after a rejected or lost-ACK transaction',()=>{
 vi.stubEnv('WAKA_STAGE','development');let clock=0;const rows:any[]=[];
 const timing=createConversationApiTiming('create',true,()=>clock,row=>rows.push(row));timing.mark('transaction');clock=10;timing.bodyFinished();clock=14;timing.finish();
 expect(rows[0]).toMatchObject({transactionOutcome:'unconfirmed',responseReady:false,admission:'unlinked',transactionMs:14,bodyExitToResolutionMs:null,sweepMs:null,wakeMs:null});
 expect(JSON.stringify(rows)).not.toMatch(/rollback|PRIVATE/);
});
it('distinguishes standalone retry replay without inventing a sweep',()=>{
 vi.stubEnv('WAKA_STAGE','development');const rows:any[]=[];const timing=createConversationApiTiming('retry',true,()=>0,row=>rows.push(row));
 timing.mark('transaction');timing.observe({requestId,revision:30,admission:'replay'});timing.bodyFinished();timing.mark('resolved');timing.mark('wake');timing.finish(true);
 expect(rows[0]).toMatchObject({operation:'retry',admission:'replay',revisionBucket:'ordinary',requestId,sweepMs:null});
});
it.each([undefined,'production','test','local','dev'])('preserves nondevelopment worker shape and disables API event for %s',stage=>{
 vi.stubEnv('WAKA_STAGE',stage);const rows:any[]=[];const api=createConversationApiTiming('create',true,()=>0,row=>rows.push(row));api.mark('transaction');api.finish(true);expect(rows).toHaveLength(0);
 const worker=createConversationTiming(()=>0,row=>rows.push(row));worker.correlate(requestId,130);worker.finish({answerAttempted:false,published:false});
 expect(Object.keys(rows[0])).toEqual(['event','Stage','totalMs','phaseMs','phaseError','answerAttempted','published']);
});
it.each([[1,'first'],[2,'ordinary'],[30,'ordinary'],[31,'middle'],[119,'middle'],[120,'long'],[200,'long'],[201,'unknown'],[0,'unknown'],[NaN,'unknown']])('uses fixed revision bucket for %s',(revision,bucket)=>{
 vi.stubEnv('WAKA_STAGE','development');const rows:any[]=[];const worker=createConversationTiming(()=>0,row=>rows.push(row));worker.correlate(requestId,revision as number);worker.finish({answerAttempted:true,published:true});expect(rows[0]).toMatchObject({requestId,revisionBucket:bucket});
});
it('whitelists bounded dev fields and refuses arbitrary private dimensions',()=>{
 vi.stubEnv('WAKA_STAGE','development');const rows:any[]=[];const api=createConversationApiTiming('create',true,()=>Number.MAX_VALUE,row=>rows.push(row));
 api.observe({requestId:'PRIVATE_TOKEN',revision:121,admission:'new',profileId:'PRIVATE_PROFILE',error:'PRIVATE_ERROR',words:'PRIVATE_WORDS'} as never);api.mark('transaction');api.bodyFinished();api.mark('resolved');api.finish(true);
 const worker=createConversationTiming(()=>Number.MAX_VALUE,row=>rows.push(row));worker.correlate('PRIVATE_OTHER_TOKEN',Number.MAX_VALUE);worker.finish({answerAttempted:true,published:false});
 for(const row of rows){expect(Buffer.byteLength(JSON.stringify(row),'utf8')).toBeLessThanOrEqual(1024);expect(JSON.stringify(row)).not.toMatch(/PRIVATE|_aws/);}
 const invalid=createConversationApiTiming('PRIVATE_OPERATION' as never,true,()=>0,row=>rows.push(row));invalid.finish();expect(rows).toHaveLength(2);
});
it('contains sync and async sink failure and an unavailable diagnostic clock',async()=>{
 vi.stubEnv('WAKA_STAGE','development');const failure=Error('PRIVATE_DIAGNOSTIC_FAILURE');
 for(const emit of [()=>{throw failure;},()=>Promise.reject(failure)]){
  const api=createConversationApiTiming('create',true,()=>{throw failure;},emit);expect(()=>{api.mark('transaction');api.bodyFinished();api.mark('resolved');api.finish(true);}).not.toThrow();
  const worker=createConversationTiming(()=>0,emit);worker.correlate(requestId,1);expect(()=>worker.finish({answerAttempted:false,published:false})).not.toThrow();
 }
 await Promise.resolve();await Promise.resolve();
});

it('keeps business result and error when an injected worker clock fails',async()=>{
 const rows:any[]=[],failure=Error('BUSINESS_FAILURE');const timing=createConversationTiming(()=>{throw Error('PRIVATE_CLOCK');},row=>rows.push(row));
 expect(await timing.measure('prepare',async()=>7)).toBe(7);await expect(timing.measure('answer',async()=>{throw failure;})).rejects.toBe(failure);
 timing.finish({answerAttempted:true,published:false});expect(rows[0]).toMatchObject({totalMs:null,phaseMs:{prepare:null,answer:null},phaseError:{answer:true}});expect(JSON.stringify(rows)).not.toMatch(/PRIVATE_CLOCK|BUSINESS_FAILURE/);
});
