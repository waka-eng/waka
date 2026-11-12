import {expect,it} from 'vitest';
import {resolve} from 'node:path';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {transpileModule,ScriptTarget} from 'typescript';
import {alarmLabels} from '../src/monitoring/protocol';
const load=()=>import(/* @vite-ignore */resolve(__dirname,'../../../scripts/production-preview-policy.mjs'));
const read=(args:string[])=>args[0]==='s3api'?{ContentLength:100}:{value:args.includes('/sst/bootstrap')?JSON.stringify({version:5,state:'sst-state-veustfdskvrh'}):'SecureString'};
it('requires existing exact-version bootstrap, encrypted passphrase and production state before SST init',async()=>{
 const {verifyExistingProductionBootstrap}=await load();
 expect(verifyExistingProductionBootstrap(read)).toMatchObject({bootstrapUpgradeAllowed:false,updateHistoryMetadataWriteExpected:true});
 for(const value of [undefined,0,4,6])expect(()=>verifyExistingProductionBootstrap((args:string[])=>args.includes('/sst/bootstrap')?{value:JSON.stringify({version:value,state:'sst-state-veustfdskvrh'})}:read(args))).toThrow();
 expect(()=>verifyExistingProductionBootstrap((args:string[])=>args[0]==='s3api'?{}:read(args))).toThrow();
 expect(()=>verifyExistingProductionBootstrap((args:string[])=>args.includes('/sst/passphrase/waka/production')?{value:'String'}:read(args))).toThrow();
});

it('summarizes exact replace operations/properties without exposing secret inputs or outputs',async()=>{
 const {summarizePreviewEvents}=await load();
 const raw=JSON.stringify({resourcePreEvent:{metadata:{op:'replace',urn:'urn:pulumi:production::waka::aws:s3/bucket:Bucket::AttachmentsBucket',type:'aws:s3/bucket:Bucket',detailedDiff:{bucket:{diffKind:'update-replace',inputDiff:true}},new:{inputs:{password:'SECRET_SENTINEL'},outputs:{password:'SECRET_SENTINEL'}}}}});
 const result=summarizePreviewEvents(raw);
 expect(result).toEqual([{operation:'replace',resource:'AttachmentsBucket',type:'aws:s3/bucket:Bucket',changedProperties:['bucket']}]);
 expect(JSON.stringify(result)).not.toContain('SECRET_SENTINEL');
});

// Matches the versioned ResourcePreEvent/StepEventMetadata/StepEventStateMetadata
// contract in @pulumi/pulumi 3.210.0 (the SST 3.19.3 platform dependency).
const alarmType='aws:cloudwatch/metricAlarm:MetricAlarm';
function alarmEvent(code:string,op='create'){
 const urn=`urn:pulumi:production::waka::${alarmType}::Monitor${code}`;
 const provider='urn:pulumi:production::waka::pulumi:providers:aws::default_6_66_2::provider-id';
 return {sequence:1,timestamp:1794440000,resourcePreEvent:{planning:true,metadata:{op,urn,type:alarmType,provider,logical:true,
  new:{type:alarmType,urn,custom:true,id:'',parent:'urn:pulumi:production::waka::pulumi:pulumi:Stack::waka-production',provider,
   inputs:{name:`waka-production-${code}`,unrelated:'SECRET_SENTINEL'},outputs:{private:'SECRET_SENTINEL'}},
  detailedDiff:{name:{diffKind:'add',inputDiff:true}},
 }}};
}
const alarmEvents=()=>Object.keys(alarmLabels).map((code,index)=>({...alarmEvent(code),sequence:index+1}));
const jsonLines=(events:unknown[])=>events.map(e=>JSON.stringify(e)).join('\n');

it('attests all eight desired physical alarm identities without publishing any input values',async()=>{
 const {verifyMonitorAlarmIdentities,summarizePreviewEvents}=await load();
 const events=alarmEvents();
 for(const [i,event] of events.entries())event.resourcePreEvent.metadata.op=i%2?'same':'create';
 const nonmonitor={resourcePreEvent:{metadata:{op:'update',urn:'urn:pulumi:production::waka::aws:s3/bucket:Bucket::AttachmentsBucket',type:'aws:s3/bucket:Bucket',new:{inputs:{name:'existing-bucket',password:'SECRET_SENTINEL'}}}}};
 const raw=jsonLines([...events,nonmonitor]);
 const result=verifyMonitorAlarmIdentities(raw);
 expect(result).toMatchObject({expectedCount:8,observedCount:8,passed:true});
 expect(Object.values(result.checks).every(v=>v===true)).toBe(true);
 expect(JSON.stringify(result)).not.toContain('SECRET_SENTINEL');
 expect(JSON.stringify(result)).not.toContain('waka-production-');
 expect(summarizePreviewEvents(raw).at(-1)).toMatchObject({resource:'AttachmentsBucket',operation:'update'});
});

it.each(['missingAlarm','missingState','missingName','wrongProviderArgument','unknownName','wrongName','duplicateEvent','duplicatePhysicalName','unknownIdentity','foreignStack','foreignApp','foreignNewBinding','wrongType','deleted','malformed'])('refuses preview monitor identity %s',async kind=>{
 const {verifyMonitorAlarmIdentities}=await load();
 const events:any[]=alarmEvents(),m=events[0].resourcePreEvent.metadata;
 if(kind==='missingAlarm')events.pop();
 if(kind==='missingState')delete m.new;
 if(kind==='missingName')delete m.new.inputs.name;
 if(kind==='wrongProviderArgument'){m.new.inputs.alarmName=m.new.inputs.name;delete m.new.inputs.name;}
 if(kind==='unknownName')m.new.inputs.name='04da6b54-80e4-46f7-96ec-b56ff0331ba9'; // Pulumi unknown sentinel.
 if(kind==='wrongName')m.new.inputs.name='generated-alarm-name';
 if(kind==='duplicateEvent')events.push(structuredClone(events[0]));
 if(kind==='duplicatePhysicalName')events[1].resourcePreEvent.metadata.new.inputs.name=m.new.inputs.name;
 if(kind==='unknownIdentity')events.push(alarmEvent('Unexpected'));
 if(kind==='foreignStack'){m.urn=m.urn.replace(':production::',':development::');m.new.urn=m.urn;}
 if(kind==='foreignApp'){m.urn=m.urn.replace('::waka::','::other::');m.new.urn=m.urn;}
 if(kind==='foreignNewBinding')m.new.urn=events[1].resourcePreEvent.metadata.urn;
 if(kind==='wrongType')m.new.type='aws:s3/bucket:Bucket';
 if(kind==='deleted'){m.op='delete';delete m.new;}
 const raw=jsonLines(events)+(kind==='malformed'?'\n{not-json':'');
 const result=verifyMonitorAlarmIdentities(raw);
 expect(result.passed).toBe(false);
 expect(JSON.stringify(result)).not.toContain('SECRET_SENTINEL');
 expect(JSON.stringify(result)).not.toContain('waka-production-');
});

it('counts the desired replacement once while ignoring Pulumi wrapper and retired-state steps',async()=>{
 const {verifyMonitorAlarmIdentities}=await load(),events=alarmEvents();
 events[0].resourcePreEvent.metadata.op='create-replacement';
 const wrapper=structuredClone(events[0]);wrapper.resourcePreEvent.metadata.op='replace';
 const retired=structuredClone(events[0]);retired.resourcePreEvent.metadata.op='delete-replaced';
 expect(verifyMonitorAlarmIdentities(jsonLines([...events,wrapper,retired])).passed).toBe(true);
});

// Contract-shaped synthetic replays, NOT the discarded production eventlog.
// Pulumi 3.210.0 urn.New/createUrn includes type in resource identity; these
// legal distinct typed resources can share a logical name. The queue/alarm pair
// is present in artifact 13907627281; new-state values below are synthetic,
// not a claim that the discarded actual physical names have been verified.
it.each(['aws:sqs/queue:Queue','sst:sst:LinkRef'])('keeps exact eight alarms when a legal %s shares their logical name',async otherType=>{
 const {verifyMonitorAlarmIdentities}=await load(),events:any[]=alarmEvents();
 const index=otherType==='aws:sqs/queue:Queue'?Object.keys(alarmLabels).indexOf('DeliveryDlq'):0;
 const other=structuredClone(events[index]);other.sequence=9;
 const m=other.resourcePreEvent.metadata;m.op=otherType==='aws:sqs/queue:Queue'?'create':'same';m.type=otherType;m.urn=m.urn.replace(alarmType,m.type);
 m.new.type=m.type;m.new.urn=m.urn;m.new.inputs={private:'SECRET_SENTINEL'};
 const result=verifyMonitorAlarmIdentities(jsonLines([...events,other]));
 expect(result).toMatchObject({expectedCount:8,observedCount:8,passed:true,evidence:{candidateCount:9,distinctTypedCount:9,excludedNonAlarmCount:1,candidatesCapped:false}});
 expect(result.evidence.candidates.at(-1)).toMatchObject({code:Object.keys(alarmLabels)[index],metadataType:otherType==='aws:sqs/queue:Queue'?'sqs_queue':'sst_link_ref',countsTowardGuard:false,excludedNonAlarm:true,desiredOperation:true,
  metadataIsAlarm:false,newStateIsAlarm:false,metadataTypedUrnMatches:false,newStateTypedUrnMatches:false,
  metadataStageMatches:true,metadataProjectMatches:true,metadataAndStateUrnsAgree:true,metadataAndStateTypesAgree:true,
  namePresent:false,nameIsString:false,nameMatchesExpected:false,repeatedIdentical:false,conflictingBinding:false});
 expect(Object.values(result.checks).every(v=>v===true)).toBe(true);
 expect(JSON.stringify(result)).not.toContain('SECRET_SENTINEL');
});

it.each(['metadataType','metadataUrnType','newType','newUrnType'])('still refuses inconsistent alarm %s instead of hiding it as a non-alarm',async field=>{
 const {verifyMonitorAlarmIdentities}=await load(),events:any[]=alarmEvents(),m=events[0].resourcePreEvent.metadata;
 if(field==='metadataType')m.type='aws:sqs/queue:Queue';
 if(field==='metadataUrnType')m.urn=m.urn.replace(alarmType,'aws:sqs/queue:Queue');
 if(field==='newType')m.new.type='aws:sqs/queue:Queue';
 if(field==='newUrnType')m.new.urn=m.new.urn.replace(alarmType,'aws:sqs/queue:Queue');
 const result=verifyMonitorAlarmIdentities(jsonLines(events));
 expect(result.passed).toBe(false);expect(result.observedCount).toBe(8);expect(result.evidence.excludedNonAlarmCount).toBe(0);
 expect(result.evidence.candidates[0].countsTowardGuard).toBe(true);
});

it.each([true,false])('diagnoses identical typed-URN observations with sequence replay=%s but still refuses duplicates',async replay=>{
 const {verifyMonitorAlarmIdentities}=await load(),events=alarmEvents(),duplicate=structuredClone(events[0]);
 if(!replay)duplicate.sequence=9;
 const result=verifyMonitorAlarmIdentities(jsonLines([...events,duplicate]));
 expect(result.passed).toBe(false);expect(result.evidence.distinctTypedCount).toBe(8);
 expect(result.evidence.candidates.at(-1)).toMatchObject({metadataType:'metric_alarm',metadataTypedUrnMatches:true,newStateTypedUrnMatches:true,
  namePresent:true,nameIsString:true,nameMatchesExpected:true,repeatedIdentical:true,conflictingBinding:false,sequenceReused:replay});
});

it.each(['name','newUrn'])('refuses conflicting %s under the same metadata typed URN and identifies the failed binding',async field=>{
 const {verifyMonitorAlarmIdentities}=await load(),events=alarmEvents(),conflict=structuredClone(events[0]);conflict.sequence=9;
 if(field==='name')conflict.resourcePreEvent.metadata.new.inputs.name='SECRET_SENTINEL';
 else conflict.resourcePreEvent.metadata.new.urn=events[1].resourcePreEvent.metadata.urn;
 const result=verifyMonitorAlarmIdentities(jsonLines([...events,conflict]));
 expect(result.passed).toBe(false);expect(result.evidence.distinctTypedCount).toBe(8);
 expect(result.evidence.candidates.at(-1)).toMatchObject({repeatedIdentical:false,conflictingBinding:true,sequenceReused:false,
  metadataTypedUrnMatches:true,newStateTypedUrnMatches:field!=='newUrn',nameMatchesExpected:field!=='name'});
 expect(JSON.stringify(result)).not.toContain('SECRET_SENTINEL');
});

it('separates stage/project/type/name diagnostics without relaxing exact stage/typed URNs',async()=>{
 const {verifyMonitorAlarmIdentities}=await load(),events=alarmEvents();
 const m=events[0].resourcePreEvent.metadata;m.urn=m.urn.replace('::waka::','::SECRET_SENTINEL::');m.new.urn=m.urn;
 const result=verifyMonitorAlarmIdentities(jsonLines(events));
 expect(result.passed).toBe(false);
 expect(result.evidence.candidates[0]).toMatchObject({metadataIsAlarm:true,metadataStageMatches:true,metadataProjectMatches:false,
  metadataUrnTypeMatches:true,newStateProjectMatches:false,metadataTypedUrnMatches:false,newStateTypedUrnMatches:false,nameMatchesExpected:true});
 expect(JSON.stringify(result)).not.toContain('SECRET_SENTINEL');
});

it('uses only closed evidence values and caps observations while preserving failure',async()=>{
 const {verifyMonitorAlarmIdentities}=await load(),events:any[]=alarmEvents();
 const unknown=alarmEvent('SECRET_SENTINEL');unknown.resourcePreEvent.metadata.op='SECRET_SENTINEL';
 unknown.resourcePreEvent.metadata.type='SECRET_SENTINEL_TYPE';unknown.resourcePreEvent.metadata.new.type='SECRET_SENTINEL_TYPE';
 const raw=jsonLines([...events,unknown,...Array.from({length:70},()=>structuredClone(events[0]))]);
 const result=verifyMonitorAlarmIdentities(raw);
 expect(result.passed).toBe(false);expect(result.evidence.candidates).toHaveLength(64);expect(result.evidence.candidatesCapped).toBe(true);
 expect(result.evidence.candidates[8]).toMatchObject({code:'unexpected',operation:'other',metadataType:'other',newStateType:'other'});
 expect(JSON.stringify(result)).not.toContain('SECRET_SENTINEL');
 expect(JSON.stringify(result)).not.toContain('urn:pulumi:');
 expect(JSON.stringify(result)).not.toContain('waka-production-');
});

it('executes the actual SST helper with provider constructors stubbed and binds name to its permission ARN',async()=>{
 const {verifyMonitorAlarmIdentities}=await load();
 const source=readFileSync(resolve(__dirname,'../../../sst.config.ts'),'utf8');
 const helper=source.slice(source.indexOf('      const metricAlarm ='),source.indexOf('      metricAlarm("Availability"'));
 const alarms:any[]=[],permissions:any[]=[];
 const metricAlarm=runInNewContext(transpileModule(helper+'\nmetricAlarm;',{
  compilerOptions:{target:ScriptTarget.ES2022},
 }).outputText,{
  aws:{lambda:{Permission:class{constructor(public logical:string,public args:any){permissions.push(this);}}},cloudwatch:{MetricAlarm:class{constructor(public logical:string,public args:any,public options:any){alarms.push(this);}}}},
  caller:{accountId:{apply:(f:(a:string)=>unknown)=>f('111122223333')}},AWS_REGION:'us-west-2',relay:{name:'relay'},action:['relay-arn'],
 });
 for(const code of Object.keys(alarmLabels))metricAlarm(code,{name:'caller-must-not-override-identity'});
 for(const [i,alarm] of alarms.entries()){
  const code=Object.keys(alarmLabels)[i];
  expect(alarm.args.name).toBe(`waka-production-${code}`);
  expect(alarm.args).not.toHaveProperty('alarmName');
  expect(permissions[i].args.sourceArn).toBe(`arn:aws:cloudwatch:us-west-2:111122223333:alarm:${alarm.args.name}`);
  expect(alarm.options.dependsOn).toEqual([permissions[i]]);
 }
 const events=alarmEvents();
 for(const [i,e] of events.entries())e.resourcePreEvent.metadata.new.inputs=alarms[i].args;
 expect(verifyMonitorAlarmIdentities(jsonLines(events)).passed).toBe(true);
});
