import {expect,it} from 'vitest';
import {resolve} from 'node:path';
import {executeAuditCli} from './helpers/audit-cli';
import {alarmLabels} from '../src/monitoring/protocol';
const load=()=>import(/* @vite-ignore */resolve(__dirname,'../../../scripts/audit-diagnostics.mjs'));
const canary='PRIVATE_CAPTURE https://private.invalid/?key=SECRET_KEY arn:aws:private:SECRET person@example.test';
it.each(['{}','',' \n\t'])('normalizes only a successful exact unreserved read (%j)',async stdout=>{
 const {readAuditAwsJson}=await load();
 expect(readAuditAwsJson(['lambda','get-function-concurrency','--function-name','private-name'],()=>stdout)).toEqual({});
});
it.each([
 [['sts','get-caller-identity'],'','empty_unexpected'],
 [['lambda','get-function-concurrency','--function-name','private-name','--query','private-query'],'','empty_unexpected'],
 [['lambda','get-function-concurrency','--function-name','private-name'],'{'+canary,'invalid_json'],
])('refuses unexpected empty/malformed JSON without content',async(args,stdout,kind)=>{
 const {readAuditAwsJson,auditFailure}=await load();let error;
 try{readAuditAwsJson(args as string[],()=>stdout);}catch(caught){error=caught;}
 const r=auditFailure('monitoring_audit',error);expect(r.failure.kind).toBe(kind);expect(JSON.stringify(r)).not.toContain('private');expect(JSON.stringify(r)).not.toContain('PRIVATE');
});
it('refuses unknown operations before execution and keeps unknown errors unknown',async()=>{
 const {readAuditAwsJson,auditFailure}=await load();let calls=0,error;
 try{readAuditAwsJson(['PRIVATE_SERVICE','PRIVATE_OP'],()=>{calls++;return '';});}catch(caught){error=caught;}
 expect(calls).toBe(0);expect(auditFailure('monitoring_audit',error).failure).toEqual({phase:'monitoring_audit',kind:'aws_read_failed',operation:'other'});
 expect(auditFailure('monitoring_audit',new Error(canary)).failure).toEqual({phase:'monitoring_audit',kind:'unknown'});
});
it.each(['monitoring-audit.mjs','production-release-audit.mjs','initialize-monitoring.mjs','monitoring-state.mjs'])('real %s entrypoint retains safe AWS failure JSON and human context',script=>{
 const r=executeAuditCli(script,{fallback:{status:254,stderr:`An error occurred (AccessDeniedException) when calling PRIVATE_OP: ${canary}`},env:{PRIVATE_ENV:canary}});
 expect(r.status).toBe(1);
 const report=script==='monitoring-state.mjs'?r.artifacts['production-monitoring-before.json']:JSON.parse(r.stdout);
 expect(report.passed).toBe(false);expect(report.failure).toMatchObject({kind:'aws_read_failed',awsExceptionCode:'AccessDeniedException'});
 expect(report.failure.operation).toBe(script==='production-release-audit.mjs'?'lambda:get-function-configuration':'sts:get-caller-identity');
 expect(r.stderr).toContain(report.failure.phase);expect(r.stderr).toContain(report.failure.operation);expect(r.stderr).toContain('Safe JSON:');expect(r.stderr).toContain('Next:');
 if(script==='monitoring-state.mjs')expect(r.stdout).toBe('');
 for(const value of [r.stdout,r.stderr,JSON.stringify(r.artifacts)]){expect(value).not.toContain('PRIVATE');expect(value).not.toContain('SECRET');expect(value).not.toContain('https:');expect(value).not.toContain('arn:');}
});
it.each([
 [{stdout:''},'empty_unexpected'],[{stdout:'{'+canary},'invalid_json'],
 [{status:1,stderr:canary},'aws_read_failed'],
 [{status:1,stderr:`An error occurred (PRIVATE_CODE): ${canary}`},'aws_read_failed'],
])('executed CLI adapter fails closed for %j', (fallback,kind)=>{
 const r=executeAuditCli('monitoring-audit.mjs',{fallback});expect(r.status).toBe(1);
 const report=JSON.parse(r.stdout);expect(report.failure.kind).toBe(kind);expect(report.failure.awsExceptionCode).toBeUndefined();
 expect(r.stdout+r.stderr).not.toContain('PRIVATE');expect(r.stdout+r.stderr).not.toContain('SECRET');
});
it.each([
 [{missingOutputs:true},'outputs_read_failed'],[{outputsText:'{'+canary},'outputs_invalid_json'],[{outputsText:'null'},'outputs_invalid_shape'],
])('guards local outputs at the actual CLI boundary: %s',(options,kind)=>{
 const r=executeAuditCli('monitoring-audit.mjs',options);expect(r.status).toBe(1);expect(JSON.parse(r.stdout).failure.kind).toBe(kind);
 expect(r.stderr).toContain(kind);expect(r.stderr).toContain('deployment outputs file');expect(r.stdout+r.stderr).not.toContain('PRIVATE');
});
it('state receipt write failure emits no invalid GITHUB_ENV assignment or raw path',()=>{
 const r=executeAuditCli('monitoring-state.mjs',{artifactDirectory:true,fallback:{status:1,stderr:canary}});
 expect(r.status).toBe(1);expect(r.stdout).toBe('');expect(r.stderr).toContain('artifact_write_failed');expect(r.stderr).not.toContain('PRIVATE');expect(r.stderr).not.toContain('/tmp/');
});
it('an executed unknown metadata-shape failure remains explicitly unknown and private',()=>{
 const r=executeAuditCli('monitoring-audit.mjs',{fallback:{json:null}});
 expect(r.status).toBe(1);expect(JSON.parse(r.stdout).failure).toEqual({phase:'monitoring_audit',kind:'unknown'});
 expect(r.stderr).toContain('cause remains unknown');expect(r.stderr).not.toContain('TypeError');expect(r.stderr).not.toContain('/scripts/');
});
it('executed initializer identifies its binding refusal rather than a generic unavailable message',()=>{
 const responses={
  [JSON.stringify(['sts','get-caller-identity'])]:{json:{Account:'111122223333'}},
 };
 const r=executeAuditCli('initialize-monitoring.mjs',{responses,fallback:{json:{Environment:{Variables:{SST_RESOURCE_App:'{'+canary}}}}});
 expect(r.status).toBe(1);expect(JSON.parse(r.stdout).failure).toEqual({phase:'monitoring_initialization',kind:'binding_mismatch',check:'monitor_initialization_identity'});
 expect(r.stderr).toContain('monitor_initialization_identity');expect(r.stdout+r.stderr).not.toContain('PRIVATE');
});
it('the existing enable-action boundary accepts empty success but preserves command failures',async()=>{
 const {callAuditAws,auditFailure}=await load(),args=['cloudwatch','enable-alarm-actions','--alarm-names','waka-production-ProbeMissing'];
 expect(callAuditAws(args,()=>'',{json:false})).toBeUndefined();let error;
 try{callAuditAws(args,()=>{throw {stderr:`An error occurred (AccessDeniedException): ${canary}`};},{json:false});}catch(caught){error=caught;}
 expect(auditFailure('monitoring_initialization',error).failure).toEqual({phase:'monitoring_initialization',kind:'aws_command_failed',operation:'cloudwatch:enable-alarm-actions',awsExceptionCode:'AccessDeniedException'});
});
const previewResponses={
 [JSON.stringify(['ssm','get-parameter','--name','/sst/bootstrap','--query','Parameter.Value'])]:{json:JSON.stringify({version:5,state:'sst-state-veustfdskvrh'})},
 [JSON.stringify(['ssm','get-parameter','--name','/sst/passphrase/waka/production','--query','Parameter.Type'])]:{json:'SecureString'},
 [JSON.stringify(['s3api','head-object','--bucket','sst-state-veustfdskvrh','--key','app/waka/production.json'])]:{json:{ContentLength:100}},
};
const previewEvents=(wrongName=false)=>Object.keys(alarmLabels).map((code,i)=>{
 const type='aws:cloudwatch/metricAlarm:MetricAlarm',urn=`urn:pulumi:production::waka::${type}::Monitor${code}`;
 return JSON.stringify({resourcePreEvent:{metadata:{op:'create',type,urn,new:{type,urn,inputs:{name:wrongName&&i===0?canary:`waka-production-${code}`}}}}});
}).join('\n');
it('executed preview child failure prints actual counts/exit and explicit unknown without child content',()=>{
 const r=executeAuditCli('preview-production.mjs',{responses:previewResponses,preview:{exit:1,events:previewEvents(),stdout:canary,stderr:'Unclassified failure '+canary}});
 expect(r.status).toBe(1);const report=r.artifacts['production-preview.json'];
 expect(report.exitCode).toBe(1);expect(report.operations).toHaveLength(8);expect(report.monitorAlarmIdentity.passed).toBe(true);
 expect(r.stderr).toContain('child exit=1; operations=8; alarms=8/8');expect(r.stderr).toContain('failed guards=childSucceeded');expect(r.stderr).toContain('categories=unknown');
 expect(r.stderr).toContain('production-preview.json');expect(r.stderr).toContain('Next:');expect(r.stdout+r.stderr+JSON.stringify(report)).not.toContain('PRIVATE');expect(r.stdout+r.stderr).not.toContain('https:');
});
it('executed preview names the actual identity check after a successful child with a wrong physical binding',()=>{
 const r=executeAuditCli('preview-production.mjs',{responses:previewResponses,preview:{exit:0,events:previewEvents(true)}});
 expect(r.status).toBe(1);const report=r.artifacts['production-preview.json'];
 expect(report.exitCode).toBe(0);expect(report.monitorAlarmIdentity.checks.exactNames).toBe(false);
 expect(r.stderr).toContain('failed guards=exactNames,alarmIdentityPassed');expect(r.stderr).toContain('alarms=8/8');expect(r.stdout+r.stderr).not.toContain('PRIVATE');
});
it('preview preflight failure leaves a valid JSON artifact before child initialization',()=>{
 const r=executeAuditCli('preview-production.mjs',{fallback:{status:254,stderr:`An error occurred (AccessDenied): ${canary}`}});
 expect(r.status).toBe(1);const report=r.artifacts['production-preview.json'];
 expect(report.failure).toEqual({phase:'preview_preflight',kind:'aws_read_failed',operation:'ssm:get-parameter',awsExceptionCode:'AccessDenied'});
 expect(report.exitCode).toBeNull();expect(report.operations).toEqual([]);expect(r.stderr).toContain('ssm:get-parameter');expect(r.stderr).toContain('Safe JSON: production-preview.json');expect(r.stdout+r.stderr).not.toContain('PRIVATE');
});
