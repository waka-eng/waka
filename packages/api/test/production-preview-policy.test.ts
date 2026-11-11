import {expect,it} from 'vitest';
import {resolve} from 'node:path';
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
 const raw=JSON.stringify({resourcePreEvent:{metadata:{op:'replace',urn:'urn:pulumi:production::waka::aws:s3/bucket:Bucket::AttachmentsBucket',type:'aws:s3/bucket:Bucket',detailedDiff:{bucket:{kind:'update-replace',new:'SECRET_SENTINEL'}},new:{outputs:{password:'SECRET_SENTINEL'}}}}});
 const result=summarizePreviewEvents(raw);
 expect(result).toEqual([{operation:'replace',resource:'AttachmentsBucket',type:'aws:s3/bucket:Bucket',changedProperties:['bucket']}]);
 expect(JSON.stringify(result)).not.toContain('SECRET_SENTINEL');
});
