/** WHAT THIS MOCKS, AND WHY: two injected AWS reads return synthetic URL/policy
 * metadata. No cloud, credentials, source words or model calls are used. */
import {expect,it,vi} from 'vitest';
import {auditDevSourcePolicy} from '../../../scripts/dev-source-policy.mjs';
const api='waka-development-ApiFunction-efwcwxdn',worker='waka-development-BackgroundWorkerFunction-xxbrbmcx';
it('refuses production targets before any AWS read',()=>{
  const awsRead=vi.fn();expect(()=>auditDevSourcePolicy({api:'waka-production-ApiFunction-aaa',worker,awsRead})).toThrow();expect(awsRead).not.toHaveBeenCalled();
});
it('reports actual public configuration without disclosing URLs, principals or policy conditions',()=>{
  const awsRead=vi.fn(args=>args[1]==='get-function-url-config'?{authType:'NONE',url:'PRIVATE_URL'}:{policy:JSON.stringify({Statement:[{Effect:'Allow',Principal:'*',Action:'lambda:InvokeFunctionUrl',Resource:'PRIVATE_ARN',Condition:{secret:'PRIVATE_CONDITION'}}]})});
  const result=auditDevSourcePolicy({api,worker,awsRead});
  expect(awsRead).toHaveBeenCalledTimes(2);expect(result).toMatchObject({urlAuthType:'NONE',publicPrincipalPresent:true,cloudFrontOnlyVerified:false,forwardedHeaderTrustVerified:false});
  expect(JSON.stringify(result)).not.toContain('PRIVATE');
});
it('does not equate an IAM URL or CloudFront grant with a complete source attestation',()=>{
  const result=auditDevSourcePolicy({api,worker,awsRead:args=>args[1]==='get-function-url-config'?{authType:'AWS_IAM'}:{policy:JSON.stringify({Statement:[{Effect:'Allow',Principal:{Service:['cloudfront.amazonaws.com']},Action:['lambda:InvokeFunctionUrl']},{Effect:'Deny',Principal:'*',Action:'*'}]})}});
  expect(result).toMatchObject({urlAuthType:'AWS_IAM',cloudFrontServiceGrantPresent:true,publicPrincipalPresent:false,cloudFrontOnlyVerified:false});
});
it('keeps unknown settings, malformed policies and private service errors unverified',()=>{
  const result=auditDevSourcePolicy({api,worker,awsRead:args=>{if(args[1]==='get-function-url-config')return{authType:'PRIVATE_SETTING'};throw{stderr:'An error occurred (AccessDeniedException) PRIVATE_ROLE'};}});
  expect(result.urlAuthType).toBe('unknown');expect(result.reads[1]).toMatchObject({read:false,reason:'access_denied'});expect(JSON.stringify(result)).not.toContain('PRIVATE');
  expect(auditDevSourcePolicy({api,worker,awsRead:()=>({policy:'PRIVATE_NOT_JSON'})}).reads[1].read).toBe(false);
});
