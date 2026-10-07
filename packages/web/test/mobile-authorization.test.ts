// @vitest-environment node
/** WHAT THIS MOCKS, AND WHY (gate G6): nothing. Real WebCrypto and URL parsing
 * are the app-side protocol under test and need no replacement. Native URL
 * delivery/storage and the server exchange have separate acceptance gates. */
import {describe,expect,it} from 'vitest';
import {AuthorizationCancelled,createAuthorizationAttempt,validateAuthorizationCallback} from '../src/lib/platform/authorization';
describe('mobile authorization handoff',()=>{
  it('accepts cancellation only for the exact pending app/state, without an accompanying code',async()=>{
    const attempt=await createAuthorizationAttempt('im.waka.app.dev',1000);
    const cancelled=`${attempt.callback}?error=cancelled&state=${attempt.state}`;
    expect(()=>validateAuthorizationCallback(attempt,cancelled,2000)).toThrow(AuthorizationCancelled);
    for(const raw of [cancelled+'&code=synthetic_authorization_code',cancelled+'&error=cancelled',cancelled.replace(attempt.state,'foreign'),cancelled.replace('cancelled','unknown')])expect(()=>validateAuthorizationCallback(attempt,raw,2000)).toThrow();
  });
  it('generates unpredictable state and the actual S256 PKCE challenge',async()=>{
    const attempt=await createAuthorizationAttempt('im.waka.app.dev',1000),other=await createAuthorizationAttempt('im.waka.app.dev',1000);
    expect(attempt.verifier).toHaveLength(43);expect(attempt.state).not.toBe(other.state);
    const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(attempt.verifier));
    expect(attempt.challenge).toBe(Buffer.from(hash).toString('base64url'));expect(attempt.expiresAt).toBe(301000);
  });
  it('returns a code and verifier only for the intended live attempt',async()=>{
    const attempt=await createAuthorizationAttempt('im.waka.app.dev',1000);
    expect(validateAuthorizationCallback(attempt,`${attempt.callback}?code=synthetic_authorization_code&state=${attempt.state}`,2000)).toEqual({code:'synthetic_authorization_code',verifier:attempt.verifier});
  });
  it.each(['im.waka.app://auth/callback','im.waka.app.dev://other/callback','im.waka.app.dev://auth:123/callback','im.waka.app.dev://auth:443/callback','im.waka.app.dev://auth/other','https://auth/callback'])('refuses a foreign callback destination %s',async destination=>{
    const attempt=await createAuthorizationAttempt('im.waka.app.dev',1000);
    expect(()=>validateAuthorizationCallback(attempt,`${destination}?code=synthetic_authorization_code&state=${attempt.state}`,2000)).toThrow();
  });
  it('refuses expiry, duplicate parameters, reusable tokens, a missing code or a wrong state',async()=>{
    const attempt=await createAuthorizationAttempt('im.waka.app.dev',1000),valid=`${attempt.callback}?code=synthetic_authorization_code&state=${attempt.state}`;
    expect(()=>validateAuthorizationCallback(attempt,valid,301000)).toThrow('expired');
    for(const uri of [valid+'&token=private',valid+'&code=another_authorization_code',valid+'&state=duplicate',`${attempt.callback}?state=${attempt.state}`,valid.replace(attempt.state,'wrong_state')])expect(()=>validateAuthorizationCallback(attempt,uri,2000)).toThrow();
  });
});
