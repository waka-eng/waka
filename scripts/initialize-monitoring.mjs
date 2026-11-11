/** Two-phase missing-probe alarm initialization. No forced invocation/state
 * change, webhook call, DB query or model request. Only enables the exact
 * production alarm after a naturally observed healthy/OK baseline. */
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
export async function initializeMonitoring({outputs,read,enable,wait,clock=Date.now,attempts=32}) {
  const account=read(['sts','get-caller-identity']).Account;
  const probe=read(['lambda','get-function-configuration','--function-name',outputs.monitorProbeFunctionName]);
  const relay=read(['lambda','get-function-configuration','--function-name',outputs.monitorRelayFunctionName]);
  const app=JSON.parse(probe.Environment?.Variables?.SST_RESOURCE_App??'{}');
  if(!/^\d{12}$/.test(account)||probe.FunctionArn!==`arn:aws:lambda:us-west-2:${account}:function:${outputs.monitorProbeFunctionName}`||app.name!=='waka'||app.stage!=='production'||relay.FunctionArn!==`arn:aws:lambda:us-west-2:${account}:function:${outputs.monitorRelayFunctionName}`)throw Error('monitor_initialization_identity');
  const alarmName='waka-production-ProbeMissing';
  const readAlarm=()=>{
    const alarms=read(['cloudwatch','describe-alarms','--alarm-names',alarmName]).MetricAlarms??[];
    const a=alarms[0];
    if(alarms.length!==1||a.AlarmArn!==`arn:aws:cloudwatch:us-west-2:${account}:alarm:${alarmName}`||a.Namespace!=='AWS/Lambda'||a.MetricName!=='Invocations'||a.Dimensions?.length!==1||a.Dimensions[0].Name!=='FunctionName'||a.Dimensions[0].Value!==probe.FunctionName||a.Period!==300||a.EvaluationPeriods!==3||a.Threshold!==1||a.ComparisonOperator!=='LessThanThreshold'||a.TreatMissingData!=='breaching'||a.AlarmActions?.join()!==relay.FunctionArn||a.OKActions?.join()!==relay.FunctionArn)throw Error('monitor_initialization_alarm_binding');
    return a;
  };
  const initialActionsEnabled=readAlarm().ActionsEnabled;
  for(let i=0;i<attempts;i++){
    const now=clock(),since=Math.max(now-600000,Math.floor(Date.parse(probe.LastModified)/60000)*60000);
    if(!Number.isFinite(since))throw Error('monitor_initialization_version_time');
    const points=metric=>(read(['cloudwatch','get-metric-statistics','--namespace','AWS/Lambda','--metric-name',metric,'--dimensions',`Name=FunctionName,Value=${probe.FunctionName}`,'--start-time',new Date(since).toISOString(),'--end-time',new Date(now).toISOString(),'--period','60','--statistics','Sum']).Datapoints??[]).filter(d=>Date.parse(d.Timestamp)>=since&&Date.parse(d.Timestamp)<=now);
    const invoked=points('Invocations').some(d=>d.Sum>=1),errors=points('Errors').some(d=>d.Sum>0);
    if(invoked&&!errors&&readAlarm().StateValue==='OK'){
      if(readAlarm().ActionsEnabled!==true)enable(['cloudwatch','enable-alarm-actions','--alarm-names',alarmName]);
      if(readAlarm().ActionsEnabled!==true)throw Error('monitor_initialization_not_armed');
      return {stage:'production',passed:true,initialActionsEnabled,heartbeatActionsEnabled:true,probeHeartbeatArmed:true,naturalHealthyBaseline:true,notificationSent:false,observedAt:new Date(now).toISOString()};
    }
    if(i+1<attempts)await wait(15000);
  }
  return {stage:'production',passed:false,initialActionsEnabled,heartbeatActionsEnabled:readAlarm().ActionsEnabled,code:'baseline_unavailable',naturalHealthyBaseline:false,notificationSent:false};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const call=args=>execFileSync('aws',[...args,'--region','us-west-2','--output','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
  try{const report=await initializeMonitoring({outputs:JSON.parse(readFileSync('.sst/outputs.json','utf8')),read:args=>JSON.parse(call(args)),enable:args=>{call(args);},wait:ms=>new Promise(r=>setTimeout(r,ms))});console.log(JSON.stringify(report));if(!report.passed)process.exitCode=1;}
  catch{console.log(JSON.stringify({stage:'production',passed:false,heartbeatActionsEnabled:null,code:'metadata_or_binding_unavailable',notificationSent:false}));process.exitCode=1;}
}
