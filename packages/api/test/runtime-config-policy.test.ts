/** WHAT THIS MOCKS, AND WHY: nothing. The operator policy checks synthetic
 * stage configurations and never reads credentials or deployed resources. */
import {expect,it} from 'vitest';
import {verifyRuntimeConfiguration} from '../../../scripts/runtime-config-policy.mjs';
const env={PUBLIC_WEB_URL:'https://dev.waka.im',PUBLIC_API_URL:'https://dev.waka.im',NODE_ENV:'production',WAKA_STAGE:'development',OPENROUTER_GENERATION_MODEL:'deepseek/deepseek-v4.1-flash',DB_CONNECTION_URL:'PRIVATE_DB_SECRET'};
it('verifies only supplied facts and leaves topology, privacy, limits and isolation unproven',()=>{
  const result=verifyRuntimeConfiguration({api:env,worker:env},'development');
  expect(result).toMatchObject({trustedOrigins:true,secureCookies:true,proxyTopologyDeclared:false,proxyTopologyVerified:false,databaseIsolationVerified:false,providerPrivacyVerified:false,monetaryLimitsVerified:false});
  expect(JSON.stringify(result)).not.toContain('PRIVATE_DB_SECRET');
});
it.each(['http://dev.waka.im','https://waka.im','https://dev.waka.im@evil.test','https://USER:PRIVATE@dev.waka.im','https://dev.waka.im/?token=PRIVATE','https://dev.waka.im/path','https://dev.waka.im/#PRIVATE'])('refuses an unsafe stage origin without echoing it: %s',origin=>{
  try{verifyRuntimeConfiguration({api:{...env,PUBLIC_API_URL:origin},worker:env},'development');throw new Error('Expected refusal');}
  catch(error){expect((error as Error).message).not.toMatch(/PRIVATE|evil\.test|USER/);expect((error as Error).message).not.toBe('Expected refusal');}
});
it.each([{NODE_ENV:'development'},{WAKA_INSECURE_COOKIES:'1'},{WAKA_STAGE:'production'},{WAKA_ENRICHMENT_ALLOWED_HOSTS:'127.0.0.1:8791'},{OPENROUTER_GENERATION_MODEL:'other/model'},{WAKA_TRUSTED_PROXY_HOPS:'-1'}])('rejects mismatched or unsafe runtime flags %#',override=>{
  expect(()=>verifyRuntimeConfiguration({api:{...env,...override},worker:env},'development')).toThrow();
});
it('accepts a declared proxy count without asserting the real network is attested',()=>{
  expect(verifyRuntimeConfiguration({api:{...env,WAKA_TRUSTED_PROXY_HOPS:'1'},worker:env},'development')).toMatchObject({proxyTopologyDeclared:true,proxyTopologyVerified:false});
});
it('compares parsed origins rather than equivalent capitalization or trailing slashes',()=>{
  expect(verifyRuntimeConfiguration({api:{...env,PUBLIC_API_URL:'https://DEV.WAKA.IM/'},worker:env},'development').trustedOrigins).toBe(true);
});
