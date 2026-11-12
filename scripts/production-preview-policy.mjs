/** Version-pinned checks before invoking SST, whose init may bootstrap AWS. */
import {alarmLabels} from '../packages/api/src/monitoring/protocol.ts';

export function verifyExistingProductionBootstrap(read){
 const bootstrap=JSON.parse(read(['ssm','get-parameter','--name','/sst/bootstrap','--query','Parameter.Value']).value);
 if(bootstrap.version!==5||bootstrap.state!=='sst-state-veustfdskvrh')throw Error('Existing bootstrap version/store differs from reviewed SST3.19.3');
 const passphrase=read(['ssm','get-parameter','--name','/sst/passphrase/waka/production','--query','Parameter.Type']);
 if(passphrase.value!=='SecureString')throw Error('Existing production passphrase required');
 const state=read(['s3api','head-object','--bucket',bootstrap.state,'--key','app/waka/production.json']);
 if(!(state.ContentLength>0))throw Error('Existing production state required');
 return {sstVersion:'3.19.3',bootstrapVersion:5,existingState:true,existingPassphrase:true,bootstrapUpgradeAllowed:false,updateHistoryMetadataWriteExpected:true};
}

/** Select structural Pulumi metadata only. No inputs, outputs, IDs or values. */
export function summarizePreviewEvents(raw){
 const operations=[];
 const allowed=new Set(['create','update','delete','replace','create-replacement','delete-replaced','import','import-replacement']);
 for(const line of raw.split('\n')){
  if(!line.trim())continue;
  const event=JSON.parse(line),m=event.resourcePreEvent?.metadata;
  if(!m||!allowed.has(m.op))continue;
  const resource=m.urn?.split('::').at(-1);
  if(!/^[A-Za-z][A-Za-z0-9_.:-]*$/.test(resource??'')||!/^[A-Za-z][A-Za-z0-9_:./-]*$/.test(m.type??''))throw Error('Unexpected resource identifier');
  operations.push({operation:m.op,resource,type:m.type,changedProperties:Object.keys(m.detailedDiff??{}).filter(k=>/^[A-Za-z0-9_.\[\]"'-]+$/.test(k))});
 }
 return operations;
}

/** Pulumi 3.210.0 ResourcePreEvent -> StepEventMetadata -> new.inputs.
 * Read desired physical names privately; publish only counts and booleans.
 * Replacement wrapper/old-state events are not additional desired resources.
 */
export function verifyMonitorAlarmIdentities(raw){
 const type='aws:cloudwatch/metricAlarm:MetricAlarm';
 const expected=new Map(Object.keys(alarmLabels).map(code=>[`Monitor${code}`,`waka-production-${code}`]));
 const desiredOps=new Set(['same','create','update','create-replacement','import','import-replacement']);
 const seen=new Set(),names=new Set();
 const checks={wellFormed:true,knownIdentities:true,desiredStatePresent:true,exactBindings:true,exactNames:true,uniqueIdentities:true,complete:false};
 let observedCount=0;
 try {
  for(const line of raw.split('\n')){
   if(!line.trim())continue;
   const m=JSON.parse(line).resourcePreEvent?.metadata;
   if(!m)continue;
   const logical=typeof m.urn==='string'?m.urn.split('::').at(-1):'';
   const name=m.new?.inputs?.name;
   const owned=expected.has(logical)||(m.type===type&&(logical?.startsWith('Monitor')||(typeof name==='string'&&name.startsWith('waka-production-'))));
   if(!owned)continue;
   if(m.op==='replace'||m.op==='delete-replaced')continue;
   observedCount++;
   if(!expected.has(logical))checks.knownIdentities=false;
   if(!desiredOps.has(m.op)||!m.new||!m.new.inputs||m.new.delete===true)checks.desiredStatePresent=false;
   const urn=`urn:pulumi:production::waka::${type}::${logical}`;
   if(m.urn!==urn||m.type!==type||m.new?.urn!==urn||m.new?.type!==type)checks.exactBindings=false;
   if(typeof name!=='string'||!expected.has(logical)||name!==expected.get(logical))checks.exactNames=false;
   if(seen.has(logical)||(typeof name==='string'&&names.has(name)))checks.uniqueIdentities=false;
   seen.add(logical);if(typeof name==='string')names.add(name);
  }
 } catch {checks.wellFormed=false;}
 checks.complete=expected.size===8&&observedCount===8&&[...expected.keys()].every(key=>seen.has(key));
 return {expectedCount:8,observedCount,checks,passed:Object.values(checks).every(Boolean)};
}
