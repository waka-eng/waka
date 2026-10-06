import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {devAuditReadFailure,validateDevAuditTargets} from './dev-operations-audit.mjs';

/** Resource policies and URLs stay in memory; output contains only verdicts. */
export function auditDevSourcePolicy({api,worker,awsRead}){
  validateDevAuditTargets(api,worker);
  const result={stage:'development',reads:[],urlAuthType:'unknown',publicPrincipalPresent:false,
    cloudFrontServiceGrantPresent:false,cloudFrontOnlyVerified:false,forwardedHeaderTrustVerified:false};
  try{
    const url=awsRead(['lambda','get-function-url-config','--function-name',api,'--query','{authType:AuthType}']);
    if(['NONE','AWS_IAM'].includes(url.authType))result.urlAuthType=url.authType;
    result.reads.push({kind:'url_configuration',read:true});
  }catch(error){result.reads.push({kind:'url_configuration',read:false,reason:devAuditReadFailure(error)});}
  try{
    const raw=awsRead(['lambda','get-policy','--function-name',api,'--query','{policy:Policy}']);
    const policy=JSON.parse(raw.policy);
    const rows=Array.isArray(policy.Statement)?policy.Statement:[policy.Statement];
    for(const row of rows){
      if(!row||row.Effect!=='Allow')continue;
      const actions=Array.isArray(row.Action)?row.Action:[row.Action];
      if(!actions.some(action=>['*','lambda:*','lambda:InvokeFunction','lambda:InvokeFunctionUrl'].includes(action)))continue;
      const aws=Array.isArray(row.Principal?.AWS)?row.Principal.AWS:[row.Principal?.AWS];
      if(row.Principal==='*'||aws.includes('*'))result.publicPrincipalPresent=true;
      const services=Array.isArray(row.Principal?.Service)?row.Principal.Service:[row.Principal?.Service];
      if(services.includes('cloudfront.amazonaws.com'))result.cloudFrontServiceGrantPresent=true;
    }
    result.reads.push({kind:'resource_policy',read:true});
  }catch(error){result.reads.push({kind:'resource_policy',read:false,reason:devAuditReadFailure(error)});}
  // A principal being present alone cannot attest its conditions, distribution,
  // identity policies or the edge's header rewriting. Never guess a hop count.
  return result;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const result=auditDevSourcePolicy({api:process.env.WAKA_AUDIT_API_FUNCTION,worker:process.env.WAKA_AUDIT_WORKER_FUNCTION,
      awsRead:args=>JSON.parse(execFileSync('aws',[...args,'--region','us-west-2','--output','json','--no-cli-pager','--no-paginate'],
        {encoding:'utf8',timeout:15000,maxBuffer:1024*1024,stdio:['ignore','pipe','pipe']}))});
    console.log(JSON.stringify(result,null,2));if(result.reads.some(read=>!read.read))process.exitCode=1;
  }catch{console.error('Development source-policy audit failed; no private metadata was printed');process.exitCode=1;}
}
