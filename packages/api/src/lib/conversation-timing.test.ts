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
