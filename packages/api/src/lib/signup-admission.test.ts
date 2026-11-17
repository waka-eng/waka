/** WHAT THIS MOCKS, AND WHY: fixed Siteverify transport only. Strict production
 * config and the real bounded parser run; no widget, token service or DB call. */
import {afterEach,expect,it,vi} from 'vitest';
import {signupConfiguration,checkTurnstile} from './signup-admission.js';
const env={WAKA_STAGE:'production',SST_RESOURCE_App:JSON.stringify({name:'waka',stage:'production'}),PUBLIC_WEB_URL:'https://waka.im',WAKA_SIGNUP_ADMISSION:'turnstile',WAKA_TURNSTILE_SITE_KEY:'synthetic-site-key',WAKA_TURNSTILE_SECRET:'synthetic-secret-key',JWT_SECRET:'synthetic-signing-key'};
const ready=()=>{const c=signupConfiguration(env);if(c.mode!=='turnstile')throw Error('Invalid fixture');return c;};
const nonce='n'.repeat(43),valid=()=>({success:true,hostname:'waka.im',action:'signup',cdata:nonce,challenge_ts:new Date().toISOString()});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
it('closes missing/invalid production settings without throwing, and leaves local absence off',()=>{
 expect(signupConfiguration({})).toEqual({mode:'off'});expect(signupConfiguration({WAKA_STAGE:'production'})).toEqual({mode:'closed'});
 for(const patch of [{WAKA_SIGNUP_ADMISSION:'off'},{WAKA_SIGNUP_ADMISSION:undefined},{WAKA_SIGNUP_ADMISSION:'invalid'},{WAKA_TURNSTILE_SECRET:''},{WAKA_TURNSTILE_SITE_KEY:''},{PUBLIC_WEB_URL:'https://waka.im.evil.test'},{PUBLIC_WEB_URL:'https://waka.im/path'},{SST_RESOURCE_App:'private malformed'},{SST_RESOURCE_App:JSON.stringify({name:'waka',stage:'development'})},{WAKA_SIGNUP_VERIFY_HOUR:'0'},{WAKA_SIGNUP_CREATE_DAY:'201'},{WAKA_TURNSTILE_SECRET:'1x0000000000000000000000000000000AA'}])expect(signupConfiguration({...env,...patch})).toEqual({mode:'closed'});
 expect(ready().limits).toEqual({verifyHour:20,verifyDay:100,createHour:10,createDay:50});
});
it('allows explicit challenge-free production signup only with exact trusted stage, origin and no challenge binding',()=>{
 const off={...env,WAKA_SIGNUP_ADMISSION:'off',WAKA_TURNSTILE_SITE_KEY:undefined,WAKA_TURNSTILE_SECRET:undefined};
 expect(signupConfiguration(off)).toEqual({mode:'off',creation:{stage:'production',limits:{createHour:10,createDay:50}}});
 expect(signupConfiguration({...off,WAKA_SIGNUP_CREATE_HOUR:'2',WAKA_SIGNUP_CREATE_DAY:'3'})).toMatchObject({creation:{limits:{createHour:2,createDay:3}}});
 for(const patch of [
  {WAKA_STAGE:undefined},{WAKA_STAGE:'developmnt'},{SST_RESOURCE_App:undefined},{SST_RESOURCE_App:'null'},
  {SST_RESOURCE_App:'{"name":"other","stage":"production"}'},{SST_RESOURCE_App:'{"name":"waka","stage":"development"}'},
  {PUBLIC_WEB_URL:undefined},{PUBLIC_WEB_URL:'https://waka.im/'},{PUBLIC_WEB_URL:'http://waka.im'},
  {PUBLIC_WEB_URL:'https://waka.im:443'},{PUBLIC_WEB_URL:'https://waka.im.evil.test'},
  {SST_RESOURCE_TurnstileSecret:'{}'},{WAKA_TURNSTILE_SITE_KEY:''},{WAKA_TURNSTILE_SECRET:''},
  {WAKA_SIGNUP_CREATE_HOUR:'0'},{WAKA_SIGNUP_CREATE_DAY:'201'},{WAKA_SIGNUP_CREATE_HOUR:'3',WAKA_SIGNUP_CREATE_DAY:'2'},
 ]) expect(signupConfiguration({...off,...patch})).toEqual({mode:'closed'});
 expect(signupConfiguration({WAKA_STAGE:'development',WAKA_SIGNUP_ADMISSION:'off'})).toEqual({mode:'off'});
});
it('uses one fixed bounded POST without IP, redirect, retry or raw output',async()=>{
 const fetcher=vi.fn(async()=>new Response(JSON.stringify(valid()))),log=vi.spyOn(console,'log');
 expect(await checkTurnstile(ready(),'synthetic-token',nonce,fetcher)).toBe('verified');expect(fetcher).toHaveBeenCalledOnce();
 const [url,init]=fetcher.mock.calls[0] as unknown as [string,RequestInit];expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');expect(init.redirect).toBe('error');
 expect([...new URLSearchParams(init.body as URLSearchParams).keys()].sort()).toEqual(['response','secret']);expect(log).not.toHaveBeenCalled();log.mockRestore();
});
it.each([{hostname:'example.com'},{action:undefined},{cdata:undefined},{action:'login'},{cdata:'other'},{success:false},{challenge_ts:new Date(0).toISOString()},{challenge_ts:new Date(Date.now()+60000).toISOString()}])('rejects missing/foreign/stale complete proof fields %#',async patch=>{
 expect(await checkTurnstile(ready(),'synthetic-token',nonce,async()=>new Response(JSON.stringify({...valid(),...patch})))).toBe('rejected');
});
it.each([()=>new Response('PRIVATE malformed'),()=>new Response('x'.repeat(8193)),()=>new Response('PRIVATE body',{status:500}),()=>{throw Error('PRIVATE transport');}])('holds bounded malformed/failed transport without leaking it %#',async response=>{
 const fetcher=vi.fn(async()=>response());expect(await checkTurnstile(ready(),'synthetic-token',nonce,fetcher)).toBe('unknown');expect(fetcher).toHaveBeenCalledOnce();
});
it('returns unknown at8s even if transport ignores abort; late success cannot change it',async()=>{
 vi.useFakeTimers();let finish!:(value:Response)=>void;const fetcher=vi.fn(()=>new Promise<Response>(resolve=>{finish=resolve;}));
 const result=checkTurnstile(ready(),'synthetic-token',nonce,fetcher);await vi.advanceTimersByTimeAsync(8000);expect(await result).toBe('unknown');finish(new Response(JSON.stringify(valid())));await Promise.resolve();expect(await result).toBe('unknown');expect(fetcher).toHaveBeenCalledOnce();
});

it.each([
 {SST_RESOURCE_App:JSON.stringify({name:'waka',stage:'production'})},
 {NODE_ENV:'production'},
 {WAKA_STAGE:'produciton',SST_RESOURCE_App:JSON.stringify({name:'waka',stage:'production'})},
 {WAKA_STAGE:'development',SST_RESOURCE_App:'malformed'},
 {WAKA_STAGE:'development',SST_RESOURCE_App:JSON.stringify({name:'waka',stage:'production'})},
 {WAKA_STAGE:'development',SST_RESOURCE_App:JSON.stringify({name:'other',stage:'development'})},
])('closes production-marker or invalid App settings instead of falling back off %#',settings=>{expect(signupConfiguration(settings)).toEqual({mode:'closed'});});
