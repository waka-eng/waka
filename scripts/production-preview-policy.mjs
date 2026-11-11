/** Version-pinned checks before invoking SST, whose init may bootstrap AWS. */
export function verifyExistingProductionBootstrap(read){
 const bootstrap=JSON.parse(read(['ssm','get-parameter','--name','/sst/bootstrap','--query','Parameter.Value']).value);
 if(bootstrap.version!==5||bootstrap.state!=='sst-state-veustfdskvrh')throw Error('Existing bootstrap version/store differs from reviewed SST3.19.3');
 const passphrase=read(['ssm','get-parameter','--name','/sst/passphrase/waka/production','--query','Parameter.Type']);
 if(passphrase.value!=='SecureString')throw Error('Existing production passphrase required');
 const state=read(['s3api','head-object','--bucket',bootstrap.state,'--key','app/waka/production.json']);
 if(!(state.ContentLength>0))throw Error('Existing production state required');
 return {sstVersion:'3.19.3',bootstrapVersion:5,existingState:true,existingPassphrase:true,bootstrapUpgradeAllowed:false,updateHistoryMetadataWriteExpected:true};
}
