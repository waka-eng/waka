import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {devAuditReadFailure} from './dev-operations-audit.mjs';
const metrics=new Set(['OverdueJobs','ExhaustedLeases','RecoveryChecks']);
const states=new Set(['OK','ALARM','INSUFFICIENT_DATA']);
/** Only stage-dimensioned queue alarms. External notification actions are
 * refused before an optional state exercise, and original states are restored. */
export function auditDevAlerts({awsRead,exercise=false}){
  const report={stage:'development',readOnly:!exercise,failures:[],alarms:[],complete:false,consoleStatesVerified:false,externalDeliveryVerified:false};
  let rows;try{const page=awsRead(['cloudwatch','describe-alarms','--max-records','100']);
    if(page.NextToken){report.failures.push('alarm_page_incomplete');return report;}
    rows=(page.MetricAlarms??[]).filter(row=>row.Namespace==='WAKA/QueueRecovery'&&metrics.has(row.MetricName)&&
      row.Dimensions?.length===1&&row.Dimensions[0].Name==='Stage'&&row.Dimensions[0].Value==='development');
  }catch(error){report.failures.push('alarm_read_'+devAuditReadFailure(error));return report;}
  if(rows.length!==3||new Set(rows.map(row=>row.MetricName)).size!==3){report.failures.push('expected_alarm_set_missing');return report;}
  for(const row of rows){
    if(!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,254}$/.test(row.AlarmName)||!states.has(row.StateValue)){
      report.failures.push('untrusted_alarm_identity');return report;}
    const actionCount=['AlarmActions','OKActions','InsufficientDataActions'].reduce((sum,key)=>sum+(row[key]?.length??0),0);
    report.alarms.push({metric:row.MetricName,state:row.StateValue,period:row.Period,evaluationPeriods:row.EvaluationPeriods,actionCount,actionsEnabled:row.ActionsEnabled===true});
  }
  report.complete=true;if(!exercise)return report;
  if(report.alarms.some(row=>row.actionCount>0)){report.failures.push('external_actions_require_explicit_destination');return report;}
  if(rows.some(row=>row.StateValue==='ALARM')){report.failures.push('active_alarm_not_overridden');return report;}
  let checked=0;
  for(const row of rows){
    let changed=false;
    try{awsRead(['cloudwatch','set-alarm-state','--alarm-name',row.AlarmName,'--state-value','ALARM','--state-reason','Controlled WAKA development console verification']);changed=true;
      const current=awsRead(['cloudwatch','describe-alarms','--alarm-names',row.AlarmName]);
      if(current.MetricAlarms?.[0]?.StateValue!=='ALARM')throw Error('Console state not observed');checked++;
    }catch(error){report.failures.push('alarm_exercise_'+devAuditReadFailure(error));}
    finally{if(changed)try{awsRead(['cloudwatch','set-alarm-state','--alarm-name',row.AlarmName,'--state-value',row.StateValue,'--state-reason','Restore state after controlled WAKA development verification']);
      const restored=awsRead(['cloudwatch','describe-alarms','--alarm-names',row.AlarmName]);if(restored.MetricAlarms?.[0]?.StateValue!==row.StateValue)report.failures.push('alarm_restore_not_observed');
    }catch(error){report.failures.push('alarm_restore_'+devAuditReadFailure(error));}}
  }
  report.consoleStatesVerified=checked===3&&report.failures.length===0;return report;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const report=auditDevAlerts({exercise:process.env.WAKA_EXERCISE_CONSOLE_ALARMS==='1',awsRead:args=>{
    const raw=execFileSync('aws',[...args,'--region','us-west-2','--output','json','--no-cli-pager','--no-paginate'],{encoding:'utf8',timeout:15000,maxBuffer:2*1024*1024,stdio:['ignore','pipe','pipe']});return raw.trim()?JSON.parse(raw):{};
  }});console.log(JSON.stringify(report,null,2));if(report.failures.length)process.exitCode=1;
}
