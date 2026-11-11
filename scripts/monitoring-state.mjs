/** Preserve actual armed state through an IaC update. Metadata only; no writes. */
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
export function monitoringArmState(read){
  const account=read(['sts','get-caller-identity']).Account;
  const rows=read(['cloudwatch','describe-alarms','--alarm-names','waka-production-ProbeMissing']).MetricAlarms??[];
  if(!/^\d{12}$/.test(account))throw Error('monitor_arm_identity');
  if(!rows.length)return {stage:'production',existing:false,armed:false};
  const a=rows[0],dimension=a.Dimensions?.[0];
  if(rows.length!==1||a.AlarmArn!==`arn:aws:cloudwatch:us-west-2:${account}:alarm:waka-production-ProbeMissing`||a.Namespace!=='AWS/Lambda'||a.MetricName!=='Invocations'||a.Dimensions?.length!==1||dimension.Name!=='FunctionName')throw Error('monitor_arm_binding');
  const f=read(['lambda','get-function-configuration','--function-name',dimension.Value]);
  const app=JSON.parse(f.Environment?.Variables?.SST_RESOURCE_App??'{}');
  if(f.FunctionArn!==`arn:aws:lambda:us-west-2:${account}:function:${dimension.Value}`||app.name!=='waka'||app.stage!=='production')throw Error('monitor_arm_stack');
  return {stage:'production',existing:true,armed:a.ActionsEnabled===true};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const receipt=monitoringArmState(args=>JSON.parse(execFileSync('aws',[...args,'--region','us-west-2','--output','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']})));
    writeFileSync('production-monitoring-before.json',JSON.stringify(receipt)+'\n',{mode:0o600});
    // Fixed boolean only; no private environment or API body is exported.
    console.log(`WAKA_MONITOR_HEARTBEAT_ARMED=${receipt.armed?'1':'0'}`);
  }catch{console.error('Monitoring action-state metadata unavailable; no apply permitted.');process.exitCode=1;}
}
