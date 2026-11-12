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
const alarmEvents=()=>Object.keys(alarmLabels).map(code=>alarmEvent(code));
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
