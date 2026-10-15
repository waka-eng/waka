import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {devAuditReadFailure} from './dev-operations-audit.mjs';

/** Inspect the default EventBridge bus without invoking Lambda or the database. */
export function auditDevQueueSchedule({worker,awsRead}){
  if(!/^waka-development-BackgroundWorkerFunction-[a-z0-9]+$/.test(worker??''))
    throw new Error('An explicit development worker is required');
  const report={stage:'development',readOnly:true,complete:false,verified:false,failures:[],rules:[]};
  try{
    const {arn}=awsRead(['lambda','get-function-configuration','--function-name',worker,'--query','{arn:FunctionArn}']);
    if(typeof arn!=='string'||!/^arn:aws:lambda:us-west-2:\d{12}:function:/.test(arn)||arn.split(':function:')[1]!==worker)
      throw new Error('Unverified worker ARN');
    const page=awsRead(['events','list-rule-names-by-target','--target-arn',arn,'--limit','100']);
    if(page.NextToken){report.failures.push('rule_page_incomplete');return report;}
    if(!Array.isArray(page.RuleNames)||page.RuleNames.length>100||page.RuleNames.some(name=>typeof name!=='string'||!/^[A-Za-z0-9_.-]{1,64}$/.test(name)))
      throw new Error('Invalid rule list');
    for(const name of new Set(page.RuleNames)){
      const row=awsRead(['events','describe-rule','--name',name,'--query','{name:Name,schedule:ScheduleExpression,state:State}']);
      if(row.name!==name||!['ENABLED','DISABLED','ENABLED_WITH_ALL_CLOUDTRAIL_MANAGEMENT_EVENTS'].includes(row.state))
        throw new Error('Unverified rule');
      const scheduled=typeof row.schedule==='string'&&row.schedule.length>0;
      report.rules.push({scheduled,state:row.state,dailySweep:row.schedule==='rate(1 day)',retiredRecovery:name.includes('QueueRecovery')||row.schedule==='rate(15 minutes)'});
    }
    report.complete=true;
    if(report.rules.some(row=>row.retiredRecovery))report.failures.push('retired_recovery_rule_present');
    if(report.rules.some(row=>row.scheduled&&row.state!=='DISABLED'&&!row.dailySweep))report.failures.push('unexpected_worker_schedule');
    if(!report.rules.some(row=>row.dailySweep&&row.state==='ENABLED'))report.failures.push('daily_sweep_missing');
    report.verified=report.failures.length===0;
  }catch(error){report.failures.push('schedule_'+devAuditReadFailure(error));}
  return report;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const report=auditDevQueueSchedule({worker:process.env.WAKA_AUDIT_WORKER_FUNCTION,awsRead:args=>JSON.parse(execFileSync('aws',
      [...args,'--region','us-west-2','--output','json','--no-cli-pager','--no-paginate'],
      {encoding:'utf8',timeout:15000,maxBuffer:1024*1024,stdio:['ignore','pipe','pipe']}))});
    console.log(JSON.stringify(report,null,2));if(!report.verified)process.exitCode=1;
  }catch{console.error('Development schedule verification failed; no private configuration was printed');process.exitCode=1;}
}
