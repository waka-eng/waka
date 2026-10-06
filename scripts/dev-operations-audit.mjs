import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyRuntimeConfiguration} from './runtime-config-policy.mjs';

const stages=new Set(['queue_wait','material_read','context_read','embedding','model','publication_validation']);
const numeric=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
const fields=['PUBLIC_WEB_URL','PUBLIC_API_URL','NODE_ENV','WAKA_INSECURE_COOKIES','WAKA_STAGE',
  'OPENROUTER_GENERATION_MODEL','WAKA_ENRICHMENT_ALLOWED_HOSTS','WAKA_TRUSTED_PROXY_HOPS',
  'WAKA_MODEL_CHAT','WAKA_OPENROUTER_DATA_COLLECTION','WAKA_OPENROUTER_REQUIRE_ZDR'];
const query='{environment:{'+fields.map(key=>`${key}:Environment.Variables.${key}`).join(',')+'},database:Environment.Variables.DB_CONNECTION_URL,logGroup:LoggingConfig.LogGroup}';

export function validateDevAuditTargets(api,worker){
  if(!/^waka-development-ApiFunction-[a-z0-9]+$/.test(api??'')||
    !/^waka-development-BackgroundWorkerFunction-[a-z0-9]+$/.test(worker??''))
    throw new Error('Explicit development API and worker function names are required');
}

export function devAuditReadFailure(error){
  const stderr=typeof error?.stderr==='string'?error.stderr:'';
  if(/An error occurred \((AccessDeniedException|AccessDenied)\)/.test(stderr))return 'access_denied';
  if(/An error occurred \(ResourceNotFoundException\)/.test(stderr))return 'missing_resource';
  return error?.code==='ETIMEDOUT'?'timeout':'read_failed';
}

/** Never return messages, request IDs, source words or arbitrary log fields. */
export function summarizeDevEvents(kind,events){
  const readings=[];
  for(const event of events??[]){
    const message=typeof event.message==='string'?event.message:'';
    if(kind==='runtime'){
      const duration=message.match(/\bDuration:\s*([\d.]+) ms/),cold=message.match(/Init Duration:\s*([\d.]+) ms/);
      if(duration&&numeric(Number(duration[1])))readings.push({durationMs:Number(duration[1]),cold:!!cold,
        ...(cold&&numeric(Number(cold[1]))?{initMs:Number(cold[1])}:{})});
      continue;
    }
    const match=kind==='timing'?message.match(/\[performance-stage\]\s*(\{.*\})/):message.match(/(\{.*\})/);
    if(!match)continue;
    let body;try{body=JSON.parse(match[1]);}catch{continue;}
    if(!body||typeof body!=='object')continue;
    if(kind==='timing'&&stages.has(body.stage)&&numeric(body.durationMs)&&['ok','error'].includes(body.outcome))
      readings.push({stage:body.stage,durationMs:body.durationMs,outcome:body.outcome});
    if(kind==='recovery'&&body.event==='queue_recovery'&&body.Stage==='development')
      readings.push(Object.fromEntries(['OverdueJobs','OldestOverdueMs','ExhaustedLeases','RecoveryChecks']
        .filter(key=>numeric(body[key])).map(key=>[key,body[key]])));
    if(kind==='usage'&&body.event==='model_usage'&&body.Stage==='development'&&['openrouter','gemini'].includes(body.Provider))
      readings.push({provider:body.Provider,...Object.fromEntries(['ModelRequests','UnpricedRequests','CostUsd','inputTokens','outputTokens','durationMs']
        .filter(key=>numeric(body[key])).map(key=>[key,body[key]]))});
  }
  return {samples:readings.length,readings};
}

/** At most thirteen read commands, one log page per kind/role, never an invocation. */
export function auditDevOperations({api,worker,now=Date.now(),awsRead}){
  validateDevAuditTargets(api,worker);
  const report={stage:'development',observedAt:new Date(now).toISOString(),failures:[],configurationReads:[],configuration:{},logs:[],queueMetrics:[],
    controlledConcurrentMeasurement:false,alertDeliveryVerified:false,providerPrivacyVerified:false,
    recurringMonetaryLimitsVerified:false};
  const environments={};
  for(const [role,name] of [['api',api],['worker',worker]]){
    try{environments[role]=awsRead(['lambda','get-function-configuration','--function-name',name,'--query',query]);report.configurationReads.push({role,read:true});}
    catch(error){report.failures.push(role+'_configuration_unavailable');report.configurationReads.push({role,read:false,reason:devAuditReadFailure(error)});}
    const group=environments[role]?.logGroup;
    const groupPrefix=role==='api'?'ApiFunction':'BackgroundWorkerFunction';
    if(typeof group!=='string'||!new RegExp('^/aws/lambda/waka-development-'+groupPrefix+'-[a-z0-9]+$').test(group)){
      report.failures.push(role+'_log_group_unverified');report.logs.push({role,kind:'group',read:false,reason:'untrusted_log_group'});continue;
    }
    for(const [kind,pattern] of [['timing','"performance-stage"'],['recovery','{ $.event = "queue_recovery" }'],
      ['usage','{ $.event = "model_usage" }'],['runtime','"REPORT"']]){
      try{
        const page=awsRead(['logs','filter-log-events','--log-group-name',group,'--filter-pattern',pattern,
          '--start-time',String(now-60*60*1000),'--end-time',String(now),'--limit','100']);
        report.logs.push({role,kind,read:true,partialPage:!!page.nextToken,...summarizeDevEvents(kind,page.events)});
      }catch(error){report.failures.push(role+'_'+kind+'_unavailable');report.logs.push({role,kind,read:false,reason:devAuditReadFailure(error)});}
    }
  }
  if(environments.api&&environments.worker){
    try{report.configuration=verifyRuntimeConfiguration({api:environments.api.environment,worker:environments.worker.environment},'development');}
    catch{report.failures.push('runtime_policy_failed');}
    report.configuration.apiWorkerDatabaseIdentical=typeof environments.api.database==='string'&&!!environments.api.database&&
      environments.api.database===environments.worker.database;
    report.configuration.chatModelsMatch=['api','worker'].every(role=>environments[role].environment?.WAKA_MODEL_CHAT==='deepseek/deepseek-v4.1-flash');
    report.configuration.restrictivePrivacyOverrides=['api','worker'].every(role=>
      environments[role].environment?.WAKA_OPENROUTER_DATA_COLLECTION==='deny'&&environments[role].environment?.WAKA_OPENROUTER_REQUIRE_ZDR==='1');
    if(!report.configuration.apiWorkerDatabaseIdentical)report.failures.push('runtime_database_mismatch');
    if(!report.configuration.chatModelsMatch)report.failures.push('runtime_chat_model_mismatch');
  }
  for(const [metric,statistic] of [['RecoveryChecks','Sum'],['OverdueJobs','Maximum'],['ExhaustedLeases','Maximum']]){
    try{
      const result=awsRead(['cloudwatch','get-metric-statistics','--namespace','WAKA/QueueRecovery','--metric-name',metric,
        '--dimensions','Name=Stage,Value=development','--unit','Count','--period','900','--statistics',statistic,
        '--start-time',new Date(now-60*60*1000).toISOString(),'--end-time',new Date(now).toISOString()]);
      const values=(result.Datapoints??[]).filter(point=>numeric(point[statistic])).map(point=>point[statistic]);
      report.queueMetrics.push({metric,read:true,samples:values.length,values});
    }catch(error){report.failures.push('metric_'+metric+'_unavailable');report.queueMetrics.push({metric,read:false,reason:devAuditReadFailure(error)});}
  }
  report.recoveryMetricExtractionVerified=report.queueMetrics.some(metric=>metric.metric==='RecoveryChecks'&&metric.values?.some(value=>value>=1));
  return report;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const report=auditDevOperations({api:process.env.WAKA_AUDIT_API_FUNCTION,worker:process.env.WAKA_AUDIT_WORKER_FUNCTION,
      awsRead:args=>JSON.parse(execFileSync('aws',[...args,'--region','us-west-2','--output','json','--no-cli-pager','--no-paginate'],
        {encoding:'utf8',timeout:15000,maxBuffer:2*1024*1024,stdio:['ignore','pipe','pipe']}))});
    console.log(JSON.stringify(report,null,2));if(report.failures.length)process.exitCode=1;
  }catch{console.error('Development operational audit failed; no private configuration was printed');process.exitCode=1;}
}
