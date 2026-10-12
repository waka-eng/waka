/** WHAT THIS MOCKS, AND WHY: injected AWS reads return synthetic configuration
 * and logs. Real audit/CLI policy, no cloud, credentials or model calls. */
import {readFileSync} from 'node:fs';
import {expect,it,vi} from 'vitest';
import {auditDevOperations,devAuditReadFailure,readDevLogPages,summarizeDevEvents,validateDevAuditTargets} from '../../../scripts/dev-operations-audit.mjs';
const api='waka-development-ApiFunction-efwcwxdn',worker='waka-development-BackgroundWorkerFunction-xxbrbmcx';
const environment={PUBLIC_WEB_URL:'https://dev.waka.im',PUBLIC_API_URL:'https://dev.waka.im',NODE_ENV:'production',WAKA_STAGE:'development',WAKA_TRUSTED_PROXY_HOPS:null,
  OPENROUTER_GENERATION_MODEL:'deepseek/deepseek-v4.1-flash',WAKA_MODEL_CHAT:'deepseek/deepseek-v4.1-flash'};
it('refuses production, missing or flag-bearing targets before AWS access',()=>{
  const awsRead=vi.fn();
  for(const name of ['waka-production-ApiFunction-aaa',undefined,'--profile=PRIVATE'])
    expect(()=>auditDevOperations({api:name,worker,awsRead})).toThrow('development');
  expect(awsRead).not.toHaveBeenCalled();expect(()=>validateDevAuditTargets(api,worker)).not.toThrow();
});
it('bounds reads, scopes development and leaves broad operational gates unproven',()=>{
  const awsRead=vi.fn(args=>args[0]==='lambda'?{environment,database:'PRIVATE_DB',logGroup:'/aws/lambda/'+args[3]}:{events:[],nextToken:'PRIVATE_CURSOR'});
  const result=auditDevOperations({api,worker,now:1791266400000,awsRead});
  expect(awsRead).toHaveBeenCalledTimes(21);expect(result.failures).toEqual([]);
  expect(result.configuration).toMatchObject({trustedOrigins:true,proxyTopologyDeclared:false,apiWorkerDatabaseIdentical:true,chatModelsMatch:true,restrictivePrivacyOverrides:false});
  expect(result).toMatchObject({controlledConcurrentMeasurement:false,alertDeliveryVerified:false,providerPrivacyVerified:false,recurringMonetaryLimitsVerified:false});
  expect(result.logs.every(log=>log.partialPage&&log.samples===0)).toBe(true);
  expect(result.logs.every(log=>log.pagesRead===2&&log.cursorRepeated)).toBe(true);
  expect(result.logPagesComplete).toBe(false);
  expect(JSON.stringify(result)).not.toContain('PRIVATE');
  for(const [args] of awsRead.mock.calls)expect(args.slice(0,2)).toEqual(args[0]==='lambda'?['lambda','get-function-configuration']:args[0]==='logs'?['logs','filter-log-events']:['cloudwatch','get-metric-statistics']);
});
it('continues through empty pages and suppresses duplicate events without exposing IDs or cursors',()=>{
  const event={eventId:'PRIVATE_EVENT',message:JSON.stringify({event:'model_usage',Stage:'development',Provider:'openrouter',ModelRequests:1,UnpricedRequests:0,CostUsd:.004})};
  const pages=[{events:[],nextToken:'PRIVATE_1'},{events:[event],nextToken:'PRIVATE_2'},{events:[event]}];
  const read=vi.fn(()=>pages.shift());const result=readDevLogPages('usage',['logs','filter-log-events'],read);
  expect(result).toMatchObject({pagesRead:3,partialPage:false,cursorRepeated:false,samples:1});
  expect(result.readings[0].CostUsd).toBe(.004);expect(JSON.stringify(result)).not.toContain('PRIVATE');
  expect(read.mock.calls[1][0]).toEqual(['logs','filter-log-events','--next-token','PRIVATE_1']);
});
it('retains partial coverage at the page ceiling and refuses invalid bounds before cloud access',()=>{
  const read=vi.fn(()=>({events:[],nextToken:'page-'+read.mock.calls.length}));
  expect(readDevLogPages('usage',[],read,3)).toMatchObject({pagesRead:3,partialPage:true});
  read.mockClear();for(const maxPages of [0,11,1.5,NaN])expect(()=>readDevLogPages('usage',[],read,maxPages)).toThrow('bound');
  expect(read).not.toHaveBeenCalled();
});
it('refuses unsafe time windows before AWS access and uses an explicit controlled start',()=>{
  const now=1791266400000,awsRead=vi.fn(args=>args[0]==='lambda'?{environment,database:'PRIVATE_DB',logGroup:'/aws/lambda/'+args[3]}:{events:[]});
  for(const since of ['PRIVATE',new Date(now+1).toISOString(),new Date(now-3*3600000).toISOString()])expect(()=>auditDevOperations({api,worker,now,awsRead,since})).toThrow('start');
  expect(awsRead).not.toHaveBeenCalled();
  const since=new Date(now-60000).toISOString();const result=auditDevOperations({api,worker,now,awsRead,since});
  expect(result.logWindow.start).toBe(since);expect(result.logPagesComplete).toBe(true);
  for(const [args] of awsRead.mock.calls.filter(([args])=>args[0]==='logs'))expect(args[args.indexOf('--start-time')+1]).toBe(String(now-60000));
});
it('reports refused reads without echoing provider errors, configuration or credentials',()=>{
  const result=auditDevOperations({api,worker,awsRead:()=>{throw new Error('PRIVATE_CREDENTIAL PRIVATE_DB');}});
  expect(result.failures).toHaveLength(7);expect(JSON.stringify(result)).not.toContain('PRIVATE');
});
it('classifies only known CLI failure codes without echoing sensitive stderr',()=>{
  expect(devAuditReadFailure({stderr:'An error occurred (AccessDeniedException) PRIVATE_ROLE PRIVATE_KEY'})).toBe('access_denied');
  expect(devAuditReadFailure({stderr:'An error occurred (ResourceNotFoundException) PRIVATE_GROUP'})).toBe('missing_resource');
  expect(devAuditReadFailure({code:'ETIMEDOUT',stderr:'PRIVATE_ERROR'})).toBe('timeout');
  expect(devAuditReadFailure({message:'AccessDenied PRIVATE_KEY'})).toBe('read_failed');
});
it('fails mismatched worker/database policy and never returns supplied raw environment',()=>{
  const result=auditDevOperations({api,worker,awsRead:args=>args[0]==='logs'?{events:[]}:{environment:{...environment,...(args[3]===worker?{PUBLIC_WEB_URL:'https://PRIVATE.evil.test'}:{})},database:args[3],logGroup:'/aws/lambda/'+args[3]}});
  expect(result.failures).toContain('runtime_policy_failed');expect(result.failures).toContain('runtime_database_mismatch');expect(JSON.stringify(result)).not.toContain('PRIVATE');
});
it('uses the actual configured group instead of assuming it matches a replaced function',()=>{
  const awsRead=vi.fn(args=>args[0]==='lambda'?{environment,database:'PRIVATE_DB',logGroup:'/aws/lambda/waka-development-'+(args[3]===api?'ApiFunction':'BackgroundWorkerFunction')+'-oldergroup'}:{events:[]});
  expect(auditDevOperations({api,worker,awsRead}).failures).toEqual([]);
  for(const [args] of awsRead.mock.calls.filter(([args])=>args[0]==='logs'))expect(args[3]).toContain('-oldergroup');
});
it('refuses absent, foreign or flag-bearing configured log groups before log reads',()=>{
  for(const logGroup of [undefined,'/aws/lambda/waka-production-ApiFunction-old','PRIVATE_GROUP --profile=other']){
    const awsRead=vi.fn(()=>({environment,database:'PRIVATE_DB',logGroup}));
    const result=auditDevOperations({api,worker,awsRead});
    expect(awsRead).toHaveBeenCalledTimes(5);expect(result.failures).toEqual(['api_log_group_unverified','worker_log_group_unverified']);
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  }
});
it('verifies actual dev heartbeat extraction without treating log receipt as metric delivery',()=>{
  const awsRead=vi.fn(args=>args[0]==='lambda'?{environment,database:'PRIVATE_DB',logGroup:'/aws/lambda/'+args[3]}:
    args[0]==='logs'?{events:[]}:{Datapoints:[{Sum:1,Maximum:0,private:'PRIVATE_VALUE'}]});
  const result=auditDevOperations({api,worker,awsRead});
  expect(result.recoveryMetricExtractionVerified).toBe(true);expect(JSON.stringify(result)).not.toContain('PRIVATE');
  for(const [args] of awsRead.mock.calls.filter(([args])=>args[0]==='cloudwatch')){
    expect(args).toContain('WAKA/QueueRecovery');expect(args).toContain('Name=Stage,Value=development');
  }
  expect(auditDevOperations({api,worker,awsRead:args=>args[0]==='lambda'?{environment,database:'PRIVATE_DB',logGroup:'/aws/lambda/'+args[3]}:{}}).recoveryMetricExtractionVerified).toBe(false);
});
it('keeps only closed numeric log fields, omitting private wording and identities',()=>{
  const wrap=body=>[{message:'timestamp INFO '+JSON.stringify({...body,secret:'PRIVATE_WORDS',requestId:'PRIVATE_ID'})}];
  expect(summarizeDevEvents('timing',[{message:'INFO [performance-stage] '+JSON.stringify({stage:'model',durationMs:12,outcome:'ok',prompt:'PRIVATE_WORDS'})}]))
    .toEqual({samples:1,readings:[{stage:'model',durationMs:12,outcome:'ok'}]});
  expect(summarizeDevEvents('recovery',wrap({event:'queue_recovery',Stage:'development',OverdueJobs:2,RecoveryChecks:1})))
    .toEqual({samples:1,readings:[{OverdueJobs:2,RecoveryChecks:1}]});
  expect(summarizeDevEvents('usage',wrap({event:'model_usage',Stage:'development',Provider:'gemini',ModelRequests:1,UnpricedRequests:1,cost:0})))
    .toEqual({samples:1,readings:[{provider:'gemini',ModelRequests:1,UnpricedRequests:1}]});
  expect(summarizeDevEvents('runtime',[{message:'REPORT PRIVATE_ID Duration: 15.5 ms Billed Duration: 100 ms Init Duration: 60 ms'}]))
    .toEqual({samples:1,readings:[{durationMs:15.5,cold:true,initMs:60}]});
});
it('drops malformed, foreign-stage and nonnumeric events',()=>{
  expect(summarizeDevEvents('timing',[{message:'[performance-stage] {bad'},{message:'[performance-stage] {"stage":"PRIVATE","durationMs":1,"outcome":"ok"}'}]).samples).toBe(0);
  expect(summarizeDevEvents('usage',[{message:'{"event":"model_usage","Stage":"production","Provider":"openrouter","CostUsd":1}'}]).samples).toBe(0);
  expect(summarizeDevEvents('recovery',[{message:'{"event":"queue_recovery","Stage":"development","OverdueJobs":"PRIVATE"}'}]).readings).toEqual([{}]);
});
it('keeps manual verification out of push/deployment jobs and never invokes models or workers',()=>{
  const workflow=readFileSync(new URL('../../../.github/workflows/deploy-dev.yml',import.meta.url),'utf8');
  expect(workflow).toContain("if: ${{ github.event_name == 'workflow_dispatch' && inputs.verify_only == true }}");
  expect(workflow).toContain("if: ${{ github.event_name != 'workflow_dispatch' || inputs.verify_only != true }}");
  const verification=workflow.slice(workflow.indexOf('  verify:'),workflow.indexOf('  deploy:'));
  expect(verification).toContain('timeout-minutes: 5');expect(verification).not.toMatch(/sst deploy|db:migrate|secret set|pnpm install/);
  const script=readFileSync(new URL('../../../scripts/dev-operations-audit.mjs',import.meta.url),'utf8');
  expect(script).not.toMatch(/InvokeCommand|put-metric|invoke-function|fetch\(/);
  expect(script).toContain("'--no-paginate'");
});
