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
