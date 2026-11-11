import {expect,it,vi} from 'vitest';
import {resolve} from 'node:path';
const load=()=>import(/* @vite-ignore */resolve(__dirname,'../../../scripts/initialize-monitoring.mjs'));
function fixture(armed=false,healthy=true){
  const account='111122223333',prefix=`arn:aws:lambda:us-west-2:${account}:function:`,now=Date.parse('2026-11-11T23:00:00Z');
  const outputs={monitorProbeFunctionName:'probe',monitorRelayFunctionName:'relay'};
  const alarm={AlarmArn:`arn:aws:cloudwatch:us-west-2:${account}:alarm:waka-production-ProbeMissing`,Namespace:'AWS/Lambda',MetricName:'Invocations',Dimensions:[{Name:'FunctionName',Value:'probe'}],Period:300,EvaluationPeriods:3,Threshold:1,ComparisonOperator:'LessThanThreshold',TreatMissingData:'breaching',AlarmActions:[prefix+'relay'],OKActions:[prefix+'relay'],StateValue:healthy?'OK':'ALARM',ActionsEnabled:armed};
  const read=(args:string[])=>{
    if(args[1]==='get-caller-identity')return {Account:account};
    if(args[1]==='get-function-configuration')return {FunctionName:args.at(-1),FunctionArn:prefix+args.at(-1),LastModified:new Date(now-60000).toISOString(),Environment:{Variables:{SST_RESOURCE_App:JSON.stringify({name:'waka',stage:'production'})}}};
    if(args[1]==='describe-alarms')return {MetricAlarms:[alarm]};
    if(args[1]==='get-metric-statistics')return {Datapoints:healthy&&args.includes('Invocations')?[{Timestamp:new Date(now-30000).toISOString(),Sum:1}]:[]};
    throw Error('Unexpected read');
  };
  const enable=vi.fn((args:string[])=>{expect(args).toEqual(['cloudwatch','enable-alarm-actions','--alarm-names','waka-production-ProbeMissing']);alarm.ActionsEnabled=true;});
  return {outputs,read,enable,wait:vi.fn(async()=>{}),clock:()=>now,attempts:2,alarm};
}
it('arms only after natural healthy native metrics and OK; no forced probe/state/message',async()=>{const {initializeMonitoring}=await load(),f=fixture(),r=await initializeMonitoring(f);expect(r.passed).toBe(true);expect(r.initialActionsEnabled).toBe(false);expect(r.heartbeatActionsEnabled).toBe(true);expect(f.enable).toHaveBeenCalledTimes(1);});
it('already armed redeploy preserves actual state without assuming Pulumi disabled it',async()=>{const {initializeMonitoring}=await load(),f=fixture(true),r=await initializeMonitoring(f);expect(r.initialActionsEnabled).toBe(true);expect(r.heartbeatActionsEnabled).toBe(true);expect(f.enable).not.toHaveBeenCalled();});
it.each([true,false])('baseline failure leaves actual prior action state %s unchanged',async armed=>{const {initializeMonitoring}=await load(),f=fixture(armed,false),r=await initializeMonitoring(f);expect(r.passed).toBe(false);expect(r.heartbeatActionsEnabled).toBe(armed);expect(f.alarm.ActionsEnabled).toBe(armed);expect(f.enable).not.toHaveBeenCalled();expect(f.wait).toHaveBeenCalledTimes(1);});
it('refuses foreign bindings before any action mutation',async()=>{const {initializeMonitoring}=await load(),f=fixture();f.alarm.Dimensions[0].Value='dev-probe';await expect(initializeMonitoring(f)).rejects.toThrow('monitor_initialization_alarm_binding');expect(f.enable).not.toHaveBeenCalled();});
