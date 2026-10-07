import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';

const mobile=fileURLToPath(new URL('../',import.meta.url));
const output=resolve(mobile,'../../work/mobile-foundation');mkdirSync(output,{recursive:true});
const device=process.argv[2];if(!/^emulator-\d+$/.test(device??''))throw new Error('An explicit emulator serial is required.');
const app='im.waka.app.dev',apk=resolve(mobile,'android/app/build/outputs/apk/debug/app-debug.apk');
const adb=(args,allowFailure=false)=>{
  const result=spawnSync('adb',['-s',device,...args],{encoding:'utf8',timeout:15000});
  if((result.status!==0||result.error)&&!allowFailure)throw new Error(`ADB ${args[0]} failed: ${result.stderr?.trim()||result.error?.message||result.status}`);
  return result.stdout??'';
};
const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
async function openAndRead(phase,uri=`${app}://diagnostics/check?phase=${phase}`){
  adb(['shell',`run-as ${app} rm -f files/waka/m1/report.json`],true);
  adb(['shell',`am start -W -a android.intent.action.VIEW -d ${quote(uri)}`]);
  const end=Date.now()+30000;
  while(Date.now()<end){
    let report;try{report=JSON.parse(adb(['exec-out','run-as',app,'cat','files/waka/m1/report.json'],true));}catch{/* Not yet published. */}
    if(report?.phase===phase){assert.equal(report.failed,undefined,report.reason);return report;}
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  throw new Error(`Native ${phase} report did not arrive.`);
}
adb(['install','-r',apk]);
adb(['shell','am','force-stop',app]);
const written=await openAndRead('write');assert.equal(written.secureWrite,true);assert.equal(written.fileWrite,true);
assert.equal(written.health.connected,true);assert.equal(written.health.origin,'https://dev.waka.im');
assert.equal(written.identity.id,app);assert.equal(written.identity.platform,'android');
assert.equal(written.fonts.body,true);assert.equal(written.fonts.heading,true);
const fixture=JSON.parse(adb(['exec-out','run-as',app,'cat','files/waka/m1/fixture.json']));
const ciphertext=adb(['exec-out','run-as',app,'cat','shared_prefs/waka-protected-credentials.xml']);
assert.ok(ciphertext.includes('ciphertext'));assert.equal(ciphertext.includes(fixture.fixture),false);
adb(['shell','am','force-stop',app]);
const reopened=await openAndRead('read');assert.equal(reopened.secureRead,true);assert.equal(reopened.fileRead,true);
const callback=await openAndRead('callback',written.callbackFixture);assert.equal(callback.callbackAccepted,true);assert.equal(callback.pendingRemoved,true);
const replay=await openAndRead('callback',written.callbackFixture);assert.equal(replay.callbackAccepted,false);
const removed=await openAndRead('cleanup');assert.equal(removed.secureRemoved,true);
adb(['shell',`am start -W -a android.intent.action.VIEW -d ${quote(`${app}://navigate/login`)}`]);
const picture=spawnSync('adb',['-s',device,'exec-out','screencap','-p'],{timeout:15000});
if(picture.status===0)writeFileSync(resolve(output,'android-login.png'),picture.stdout);
const receipt={device,apkSha256:createHash('sha256').update(readFileSync(apk)).digest('hex'),
  checkedAt:new Date().toISOString(),written,reopened,callback,replay,removed,plaintextAbsent:true};
writeFileSync(resolve(output,'android-checks.json'),JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify({passed:true,device,app,receipt:resolve(output,'android-checks.json')}));
