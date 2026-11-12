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
 const codes=new Map(Object.keys(alarmLabels).map(code=>[`Monitor${code}`,code]));
 const desiredOps=new Set(['same','create','update','create-replacement','import','import-replacement']);
 const operations=new Set([...desiredOps,'replace','delete-replaced','delete','read','read-replacement','refresh']);
 const typeTags=new Map([[type,'metric_alarm'],['aws:sqs/queue:Queue','sqs_queue'],['sst:sst:LinkRef','sst_link_ref'],['aws:lambda/permission:Permission','lambda_permission'],['aws:cloudwatch/eventRule:EventRule','event_rule']]);
 const urnBaseType=urn=>typeof urn==='string'?urn.split('::')[2]?.split('$').at(-1):undefined;
 const candidates=[],observations=new Map();let candidateCount=0,excludedNonAlarmCount=0,candidatesCapped=false;
 const seen=new Set(),names=new Set();
 const checks={wellFormed:true,knownIdentities:true,desiredStatePresent:true,exactBindings:true,exactNames:true,uniqueIdentities:true,complete:false};
 let observedCount=0;
 try {
  for(const line of raw.split('\n')){
   if(!line.trim())continue;
   const event=JSON.parse(line),m=event.resourcePreEvent?.metadata;
   if(!m)continue;
   const logical=typeof m.urn==='string'?m.urn.split('::').at(-1):'';
   const name=m.new?.inputs?.name;
   // A queue and an alarm can share a logical name: Pulumi identity includes
   // type. Any alarm signal still enters the exact checks, even if another
   // metadata/state type or URN is malformed. No blanket skip of same events.
   const alarmLike=[m.type,urnBaseType(m.urn),m.new?.type,urnBaseType(m.new?.urn)].includes(type);
   const related=expected.has(logical)||(alarmLike&&(logical?.startsWith('Monitor')||(typeof name==='string'&&name.startsWith('waka-production-'))));
   if(!related)continue;
   // Never export names/URNs/inputs, including the excluded non-alarm peer.
   candidateCount++;
   if(!alarmLike)excludedNonAlarmCount++;
   const known=expected.has(logical),urn=`urn:pulumi:production::waka::${type}::${logical}`;
   const key=JSON.stringify([m.type,m.urn]);
   const namePresent=!!m.new?.inputs&&Object.hasOwn(m.new.inputs,'name');
   const binding=JSON.stringify([m.type,m.urn,m.new?.type,m.new?.urn,m.new?.delete===true,namePresent,name]);
   const prior=observations.get(key),identical=!!prior?.bindings.has(binding);
   const metadataParts=typeof m.urn==='string'?m.urn.split('::'):[];
   const newParts=typeof m.new?.urn==='string'?m.new.urn.split('::'):[];
   const sequencePresent=Number.isSafeInteger(event.sequence)&&event.sequence>=0;
   if(candidates.length<64)candidates.push({
    code:codes.get(logical)??'unexpected',operation:operations.has(m.op)?m.op:'other',
    metadataType:typeTags.get(m.type)??'other',newStateType:typeTags.get(m.new?.type)??'other',
    countsTowardGuard:alarmLike&&m.op!=='replace'&&m.op!=='delete-replaced',excludedNonAlarm:!alarmLike,desiredOperation:desiredOps.has(m.op),
    metadataIsAlarm:m.type===type,newStateIsAlarm:m.new?.type===type,
    metadataTypedUrnMatches:known&&m.urn===urn,newStateTypedUrnMatches:known&&m.new?.urn===urn,
    metadataStageMatches:metadataParts[0]==='urn:pulumi:production',metadataProjectMatches:metadataParts[1]==='waka',metadataUrnTypeMatches:metadataParts[2]===type,
    newStateStageMatches:newParts[0]==='urn:pulumi:production',newStateProjectMatches:newParts[1]==='waka',newStateUrnTypeMatches:newParts[2]===type,
    metadataAndStateUrnsAgree:typeof m.urn==='string'&&m.urn===m.new?.urn,metadataAndStateTypesAgree:typeof m.type==='string'&&m.type===m.new?.type,
    namePresent,nameIsString:typeof name==='string',nameMatchesExpected:known&&typeof name==='string'&&name===expected.get(logical),
    repeatedIdentical:identical,conflictingBinding:!!prior&&!identical,
    sequencePresent,sequenceReused:sequencePresent&&!!prior?.sequences.has(event.sequence),
   });else candidatesCapped=true;
   const observation=prior??{bindings:new Set(),sequences:new Set()};
   observation.bindings.add(binding);if(sequencePresent)observation.sequences.add(event.sequence);observations.set(key,observation);
   if(!alarmLike)continue;
   if(m.op==='replace'||m.op==='delete-replaced')continue;
   observedCount++;
   if(!expected.has(logical))checks.knownIdentities=false;
   if(!desiredOps.has(m.op)||!m.new||!m.new.inputs||m.new.delete===true)checks.desiredStatePresent=false;
   if(m.urn!==urn||m.type!==type||m.new?.urn!==urn||m.new?.type!==type)checks.exactBindings=false;
   if(typeof name!=='string'||!expected.has(logical)||name!==expected.get(logical))checks.exactNames=false;
   if(seen.has(logical)||(typeof name==='string'&&names.has(name)))checks.uniqueIdentities=false;
   seen.add(logical);if(typeof name==='string')names.add(name);
  }
 } catch {checks.wellFormed=false;}
 checks.complete=expected.size===8&&observedCount===8&&[...expected.keys()].every(key=>seen.has(key));
 return {expectedCount:8,observedCount,checks,evidence:{candidateCount,distinctTypedCount:observations.size,excludedNonAlarmCount,candidatesCapped,candidates},passed:Object.values(checks).every(Boolean)&&!candidatesCapped};
}
