/** WHAT THIS MOCKS, AND WHY: AWS configuration/rule reads are closed fixtures.
 * The audit's scoping and incomplete/leftover-rule failures are real. */
import {expect,it,vi} from 'vitest';
import {auditDevQueueSchedule} from '../../../scripts/dev-queue-schedule-audit.mjs';
const worker='waka-development-BackgroundWorkerFunction-fixture';
const arn=`arn:aws:lambda:us-west-2:123456789012:function:${worker}`;
const daily={name:'DailySweep',schedule:'rate(1 day)',state:'ENABLED'};
function reads(rows=[daily]){
  return vi.fn(args=>args[0]==='lambda'?{arn}:args[1]==='list-rule-names-by-target'?{RuleNames:rows.map(row=>row.name)}:rows.find(row=>row.name===args[3]));
}
it('verifies only the daily sweep and makes no database, invocation or mutation calls',()=>{
  const awsRead=reads();expect(auditDevQueueSchedule({worker,awsRead})).toMatchObject({complete:true,verified:true,failures:[]});
  expect(awsRead.mock.calls.map(([args])=>args.slice(0,2))).toEqual([
    ['lambda','get-function-configuration'],['events','list-rule-names-by-target'],['events','describe-rule']]);
  expect(awsRead.mock.calls[1][0]).toContain(arn);
});
it.each(['ENABLED','DISABLED'])('refuses a leftover recovery rule in state %s',state=>{
  const awsRead=reads([daily,{name:'QueueRecoveryRule',schedule:'rate(15 minutes)',state}]);
  expect(auditDevQueueSchedule({worker,awsRead})).toMatchObject({verified:false,failures:expect.arrayContaining(['retired_recovery_rule_present'])});
});
it('detects another frequent poll but allows unscheduled event-driven rules',()=>{
  expect(auditDevQueueSchedule({worker,awsRead:reads([daily,{name:'OtherPoll',schedule:'rate(5 minutes)',state:'ENABLED'}])}).failures).toContain('unexpected_worker_schedule');
  expect(auditDevQueueSchedule({worker,awsRead:reads([daily,{name:'OnEvent',schedule:null,state:'ENABLED'}])}).verified).toBe(true);
});
it('requires a complete read and a live daily sweep',()=>{
  for(const rows of [[],[{...daily,state:'DISABLED'}]])expect(auditDevQueueSchedule({worker,awsRead:reads(rows)}).failures).toContain('daily_sweep_missing');
  const awsRead=vi.fn(args=>args[0]==='lambda'?{arn}:{RuleNames:['DailySweep'],NextToken:'PRIVATE_CURSOR'});
  const result=auditDevQueueSchedule({worker,awsRead});expect(result).toMatchObject({verified:false,complete:false,failures:['rule_page_incomplete']});
  expect(JSON.stringify(result)).not.toContain('PRIVATE');
});
it('refuses other stages and unverified ARNs without exposing AWS errors',()=>{
  const awsRead=vi.fn();expect(()=>auditDevQueueSchedule({worker:'waka-production-BackgroundWorkerFunction-fixture',awsRead})).toThrow('development');expect(awsRead).not.toHaveBeenCalled();
  for(const read of [()=>({arn:arn+'-other'}),()=>{throw Error('PRIVATE_CREDENTIAL');}]){
    const result=auditDevQueueSchedule({worker,awsRead:read});expect(result.verified).toBe(false);expect(JSON.stringify(result)).not.toContain('PRIVATE');
  }
});
