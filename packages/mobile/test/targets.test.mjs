import {test} from 'node:test';
import assert from 'node:assert/strict';
import {targetFor, capacitorConfiguration, publicBuildEnvironment} from '../lib/targets.mjs';

test('distinct binary identities and API hosts make dev and production coexist',()=>{
  const dev=targetFor('development'),prod=targetFor('production');
  assert.notEqual(dev.appId,prod.appId);assert.notEqual(dev.apiOrigin,prod.apiOrigin);
  assert.equal(dev.apiOrigin,'https://dev.waka.im');assert.equal(prod.apiOrigin,'https://waka.im');
  assert.throws(()=>targetFor('staging'));assert.throws(()=>targetFor(undefined));
});
test('production packages assets and refuses debugging, remote pages and patched upload transport',()=>{
  const config=capacitorConfiguration(targetFor('production'));
  assert.equal(config.webDir,'www');assert.equal(config.loggingBehavior,'none');
  assert.equal(config.android.webContentsDebuggingEnabled,false);assert.equal(config.android.allowMixedContent,false);
  assert.equal(config.ios.webContentsDebuggingEnabled,false);
  assert.equal(Object.hasOwn(config.server,'url'),false);assert.equal(Object.hasOwn(config.server,'allowNavigation'),false);
  assert.equal(config.plugins.CapacitorHttp.enabled,false);assert.equal(config.plugins.CapacitorCookies.enabled,false);
});
test('only public build settings are exposed and diagnostics are disabled in production',()=>{
  const env=publicBuildEnvironment(targetFor('production'));
  assert.equal(env.VITE_MOBILE_DIAGNOSTICS,'0');
  assert.deepEqual(Object.keys(env).sort(),['WAKA_BUILD_TARGET','VITE_BUILD_TARGET','VITE_API_URL','VITE_PUBLIC_WEB_URL','VITE_APP_ENVIRONMENT','VITE_APP_ID','VITE_MOBILE_DIAGNOSTICS'].sort());
});
test('isolated fixtures cannot replace a shipping target or arbitrary API host',()=>{
  const ios=targetFor('development','ios'),android=targetFor('development','android');
  assert.equal(ios.appId,'im.waka.app.test');assert.equal(android.appId,ios.appId);
  assert.equal(ios.apiOrigin,'http://127.0.0.1:8787');assert.equal(android.apiOrigin,'http://10.0.2.2:8787');
  assert.throws(()=>targetFor('production','ios'));assert.throws(()=>targetFor('development','other'));
  assert.equal(capacitorConfiguration(android).server.androidScheme,'http');
  assert.equal(capacitorConfiguration(targetFor('production',null)).server.androidScheme,'https');
  assert.equal(Object.hasOwn(capacitorConfiguration(ios).server,'url'),false);
});
