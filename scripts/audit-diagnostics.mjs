/** Small shared CLI boundary: retain useful closed diagnostics, never AWS bodies,
 * command arguments, environment values or exception messages/stacks. */
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
const operations=new Set([
  'sts:get-caller-identity','lambda:get-function-configuration','lambda:get-function-concurrency',
  'lambda:get-function-event-invoke-config','lambda:get-policy','lambda:list-event-source-mappings',
  'dynamodb:describe-table','dynamodb:describe-time-to-live','sqs:get-queue-attributes','sqs:get-queue-url',
  's3api:get-bucket-notification-configuration','s3api:head-object','ssm:get-parameter',
  'iam:get-role','iam:list-attached-role-policies','iam:list-role-policies','iam:get-role-policy',
  'cloudwatch:describe-alarms','cloudwatch:get-metric-statistics','cloudwatch:enable-alarm-actions',
  'logs:describe-log-groups','events:describe-rule','events:list-targets-by-rule',
]);
const kinds=new Set(['empty_unexpected','invalid_json','aws_read_failed','aws_command_failed',
  'outputs_read_failed','outputs_invalid_json','outputs_invalid_shape','artifact_write_failed',
  'binding_mismatch','cli_version_failed','cli_version_mismatch','bootstrap_refused','private_log_reset_failed']);
const codes=new Set(['AccessDenied','AccessDeniedException','UnauthorizedOperation','ExpiredToken',
  'ExpiredTokenException','InvalidClientTokenId','UnrecognizedClientException','ResourceNotFoundException',
  'ValidationException','Throttling','ThrottlingException','TooManyRequestsException',
  'ServiceUnavailableException','InternalFailure','InternalServerError','NoSuchBucket']);
const bindingChecks=new Set(['monitor_initialization_identity','monitor_initialization_alarm_binding',
  'monitor_initialization_version_time','monitor_initialization_not_armed','monitor_arm_identity',
  'monitor_arm_binding','monitor_arm_stack','bootstrapVersionStore','existingPassphrase','existingState']);
export class AuditDiagnosticError extends Error {
  constructor(kind,{operation,awsExceptionCode,check}={}){
    super(bindingChecks.has(check)?check:'audit_boundary_failed');
    this.diagnostic={kind:kinds.has(kind)?kind:'unknown'};
    if(operation)this.diagnostic.operation=operations.has(operation)?operation:'other';
    if(codes.has(awsExceptionCode))this.diagnostic.awsExceptionCode=awsExceptionCode;
    if(bindingChecks.has(check))this.diagnostic.check=check;
  }
}
export function callAuditAws(args,execute=execFileSync,{env,json=true}={}){
  const operation=Array.isArray(args)?`${args[0]}:${args[1]}`:'other';
  if(!operations.has(operation))throw new AuditDiagnosticError('aws_read_failed',{operation:'other'});
  let output;
  try{output=execute('aws',[...args,'--region','us-west-2','--output','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],...(env?{env}:{})});}
  catch(error){
    // execFileSync.message contains argument values. Inspect only the bounded
    // stderr channel for a closed AWS exception code; never forward its text.
    const stderr=typeof error?.stderr==='string'?error.stderr:Buffer.isBuffer(error?.stderr)?error.stderr.toString('utf8'):'';
    const awsExceptionCode=stderr.slice(0,65536).match(/An error occurred \(([A-Za-z][A-Za-z0-9]+)\)/)?.[1];
    throw new AuditDiagnosticError(json?'aws_read_failed':'aws_command_failed',{operation,awsExceptionCode});
  }
  if(!json)return;
  const text=String(output);
  if(!text.trim()){
    // AWS CLI JSONFormatter omits stdout for {}. This exact successful read
    // means unreserved concurrency. No other empty response is fabricated.
    if(operation==='lambda:get-function-concurrency'&&args.length===4&&args[2]==='--function-name'&&typeof args[3]==='string'&&args[3].length>0)return {};
    throw new AuditDiagnosticError('empty_unexpected',{operation});
  }
  try{return JSON.parse(text);}catch{throw new AuditDiagnosticError('invalid_json',{operation});}
}
export const readAuditAwsJson=(args,execute=execFileSync,options={})=>callAuditAws(args,execute,options);
export function readAuditOutputs(){
  let text,value;
  try{text=readFileSync('.sst/outputs.json','utf8');}catch{throw new AuditDiagnosticError('outputs_read_failed');}
  try{value=JSON.parse(text);}catch{throw new AuditDiagnosticError('outputs_invalid_json');}
  if(!value||typeof value!=='object'||Array.isArray(value))throw new AuditDiagnosticError('outputs_invalid_shape');
  return value;
}
export function auditFailure(phase,error,extra={}){
  const diagnostic=error instanceof AuditDiagnosticError?error.diagnostic:{kind:'unknown'};
  return {stage:'production',passed:false,...extra,failure:{...(diagnostic.kind.startsWith('outputs_')?{phase:'deployment_outputs',during:phase}:{phase}),...diagnostic}};
}
export function explainAuditFailure(report,artifact){
  const failed=Object.entries(report.checks??{}).filter(([,value])=>value!==true).map(([key])=>key);
  const f=report.failure,reason=f?`${f.phase}: ${f.operation??'local'} ${f.kind}${f.awsExceptionCode?` (${f.awsExceptionCode})`:''}${f.check?`; check=${f.check}`:''}`:'boolean gate failed';
  const baseline=report.baseline?`; baseline=${JSON.stringify(report.baseline)}`:'';
  return `Production acceptance failed: ${reason}${failed.length?`; failed checks=${failed.join(',')}`:''}${baseline}. Safe JSON: ${artifact}. Next: ${f?.kind==='unknown'?'inspect this phase and the last successful safe receipt; cause remains unknown':f?.operation?'verify this exact operation and its scoped access/response contract':f?.kind?.startsWith('outputs_')?'verify the deployment outputs file exists and is valid JSON':report.baseline?'inspect recent probe Invocations/Errors and the heartbeat alarm state; do not force a probe':'inspect the named checks and their retained expected bindings before retrying'}.`;
}
export function printAuditReport(report,artifact){
  console.log(JSON.stringify(report));
  if(!report.passed){console.error(explainAuditFailure(report,artifact));process.exitCode=1;}
}
