/** Two-phase missing-probe alarm initialization. No forced invocation/state
 * change, webhook call, DB query or model request. Only enables the exact
 * production alarm after a naturally observed healthy/OK baseline. */
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {AuditDiagnosticError,callAuditAws,readAuditAwsJson,readAuditOutputs,auditFailure,printAuditReport} from './audit-diagnostics.mjs';
const binding=check=>new AuditDiagnosticError('binding_mismatch',{check});
export async function initializeMonitoring({outputs,read,enable,wait,clock=Date.now,attempts=32}) {
  const account=read(['sts','get-caller-identity']).Account;
  const probe=read(['lambda','get-function-configuration','--function-name',outputs.monitorProbeFunctionName]);
  const relay=read(['lambda','get-function-configuration','--function-name',outputs.monitorRelayFunctionName]);
  let app;try{app=JSON.parse(probe.Environment?.Variables?.SST_RESOURCE_App??'{}');}catch{throw binding('monitor_initialization_identity');}
  if(!/^\d{12}$/.test(account)||probe.FunctionArn!==`arn:aws:lambda:us-west-2:${account}:function:${outputs.monitorProbeFunctionName}`||app.name!=='waka'||app.stage!=='production'||relay.FunctionArn!==`arn:aws:lambda:us-west-2:${account}:function:${outputs.monitorRelayFunctionName}`)throw binding('monitor_initialization_identity');
  const alarmName='waka-production-ProbeMissing';
  const readAlarm=()=>{
    const alarms=read(['cloudwatch','describe-alarms','--alarm-names',alarmName]).MetricAlarms??[];
    const a=alarms[0];
    if(alarms.length!==1||a.AlarmArn!==`arn:aws:cloudwatch:us-west-2:${account}:alarm:${alarmName}`||a.Namespace!=='AWS/Lambda'||a.MetricName!=='Invocations'||a.Dimensions?.length!==1||a.Dimensions[0].Name!=='FunctionName'||a.Dimensions[0].Value!==probe.FunctionName||a.Period!==300||a.EvaluationPeriods!==3||a.Threshold!==1||a.ComparisonOperator!=='LessThanThreshold'||a.TreatMissingData!=='breaching'||a.AlarmActions?.join()!==relay.FunctionArn||a.OKActions?.join()!==relay.FunctionArn)throw binding('monitor_initialization_alarm_binding');
    return a;
  };
  const initialActionsEnabled=readAlarm().ActionsEnabled;
  let invoked=false,errors=false;
  for(let i=0;i<attempts;i++){
    const now=clock(),since=Math.max(now-600000,Math.floor(Date.parse(probe.LastModified)/60000)*60000);
    if(!Number.isFinite(since))throw binding('monitor_initialization_version_time');
    const points=metric=>(read(['cloudwatch','get-metric-statistics','--namespace','AWS/Lambda','--metric-name',metric,'--dimensions',`Name=FunctionName,Value=${probe.FunctionName}`,'--start-time',new Date(since).toISOString(),'--end-time',new Date(now).toISOString(),'--period','60','--statistics','Sum']).Datapoints??[]).filter(d=>Date.parse(d.Timestamp)>=since&&Date.parse(d.Timestamp)<=now);
    invoked=points('Invocations').some(d=>d.Sum>=1);errors=points('Errors').some(d=>d.Sum>0);
    if(invoked&&!errors&&readAlarm().StateValue==='OK'){
      if(readAlarm().ActionsEnabled!==true)enable(['cloudwatch','enable-alarm-actions','--alarm-names',alarmName]);
      if(readAlarm().ActionsEnabled!==true)throw binding('monitor_initialization_not_armed');
      return {stage:'production',passed:true,initialActionsEnabled,heartbeatActionsEnabled:true,probeHeartbeatArmed:true,naturalHealthyBaseline:true,notificationSent:false,observedAt:new Date(now).toISOString()};
    }
    if(i+1<attempts)await wait(15000);
  }
  const finalAlarm=readAlarm(),alarmState=['OK','ALARM','INSUFFICIENT_DATA'].includes(finalAlarm.StateValue)?finalAlarm.StateValue:'unknown';
  return {stage:'production',passed:false,initialActionsEnabled,heartbeatActionsEnabled:finalAlarm.ActionsEnabled,code:'baseline_unavailable',checks:{naturalInvocation:invoked,noProbeErrors:!errors,heartbeatAlarmOk:alarmState==='OK'},baseline:{invocationObserved:invoked,errorsObserved:errors,alarmState,attempts},naturalHealthyBaseline:false,notificationSent:false};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const report=await initializeMonitoring({outputs:readAuditOutputs(),read:readAuditAwsJson,enable:args=>callAuditAws(args,undefined,{json:false}),wait:ms=>new Promise(r=>setTimeout(r,ms))});printAuditReport(report,'production-monitoring-baseline.json');}
  catch(error){printAuditReport(auditFailure('monitoring_initialization',error,{heartbeatActionsEnabled:null,notificationSent:false}),'production-monitoring-baseline.json');}
}
