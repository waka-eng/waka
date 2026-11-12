/** Preserve actual armed state through an IaC update. Metadata only; no writes. */
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {AuditDiagnosticError,readAuditAwsJson,auditFailure,explainAuditFailure} from './audit-diagnostics.mjs';
const binding=check=>new AuditDiagnosticError('binding_mismatch',{check});
export function monitoringArmState(read){
  const account=read(['sts','get-caller-identity']).Account;
  const rows=read(['cloudwatch','describe-alarms','--alarm-names','waka-production-ProbeMissing']).MetricAlarms??[];
  if(!/^\d{12}$/.test(account))throw binding('monitor_arm_identity');
  if(!rows.length)return {stage:'production',existing:false,armed:false};
  const a=rows[0],dimension=a.Dimensions?.[0];
  if(rows.length!==1||a.AlarmArn!==`arn:aws:cloudwatch:us-west-2:${account}:alarm:waka-production-ProbeMissing`||a.Namespace!=='AWS/Lambda'||a.MetricName!=='Invocations'||a.Dimensions?.length!==1||dimension.Name!=='FunctionName')throw binding('monitor_arm_binding');
  const f=read(['lambda','get-function-configuration','--function-name',dimension.Value]);
  let app;try{app=JSON.parse(f.Environment?.Variables?.SST_RESOURCE_App??'{}');}catch{throw binding('monitor_arm_stack');}
  if(f.FunctionArn!==`arn:aws:lambda:us-west-2:${account}:function:${dimension.Value}`||app.name!=='waka'||app.stage!=='production')throw binding('monitor_arm_stack');
  return {stage:'production',existing:true,armed:a.ActionsEnabled===true};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const receipt=monitoringArmState(readAuditAwsJson);
    try{writeFileSync('production-monitoring-before.json',JSON.stringify(receipt)+'\n',{mode:0o600});}catch{throw new AuditDiagnosticError('artifact_write_failed');}
    // Fixed boolean only; no private environment or API body is exported.
    console.log(`WAKA_MONITOR_HEARTBEAT_ARMED=${receipt.armed?'1':'0'}`);
  }catch(error){
    const receipt=auditFailure('monitoring_action_state',error,{armed:null});
    try{writeFileSync('production-monitoring-before.json',JSON.stringify(receipt)+'\n',{mode:0o600});console.error(explainAuditFailure(receipt,'production-monitoring-before.json'));}
    catch{console.error('Production acceptance failed: monitoring_action_state artifact_write_failed. Next: verify the safe artifact destination is writable; no apply permitted.');console.error(JSON.stringify(receipt));}
    process.exitCode=1;
  }
}
