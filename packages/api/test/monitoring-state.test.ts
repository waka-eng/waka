import {expect,it} from 'vitest';
import {resolve} from 'node:path';
const load=()=>import(/* @vite-ignore */resolve(__dirname,'../../../scripts/monitoring-state.mjs'));
function read(armed:boolean,foreign=false){return(args:string[])=>{
  if(args[1]==='get-caller-identity')return {Account:'111122223333'};
  if(args[1]==='describe-alarms')return {MetricAlarms:[{AlarmArn:'arn:aws:cloudwatch:us-west-2:111122223333:alarm:waka-production-ProbeMissing',Namespace:'AWS/Lambda',MetricName:'Invocations',Dimensions:[{Name:'FunctionName',Value:'probe'}],ActionsEnabled:armed}]};
  return {FunctionArn:'arn:aws:lambda:us-west-2:111122223333:function:probe',Environment:{Variables:{SST_RESOURCE_App:JSON.stringify({name:'waka',stage:foreign?'development':'production'}),PRIVATE_SECRET:'never output'}}};
};}
it.each([true,false])('preserves real prior armed state %s without a reset assumption',async armed=>{const {monitoringArmState}=await load();const r=monitoringArmState(read(armed));expect(r).toEqual({stage:'production',existing:true,armed});expect(JSON.stringify(r)).not.toContain('PRIVATE');});
it('new alarm starts unarmed but foreign binding refuses metadata initialization',async()=>{const {monitoringArmState}=await load();expect(monitoringArmState((args:string[])=>args[1]==='get-caller-identity'?{Account:'111122223333'}:{MetricAlarms:[]})).toMatchObject({existing:false,armed:false});expect(()=>monitoringArmState(read(true,true))).toThrow('monitor_arm_stack');});
