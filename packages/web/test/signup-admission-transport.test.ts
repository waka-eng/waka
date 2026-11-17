// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY: `fetch` is the HTTP boundary. The real resource
 * wrapper, apiPath and credential transport run against the declared API paths,
 * not a mocked API barrel or a permissive /auth fixture alias. No network. */
import {afterEach,expect,it,vi} from 'vitest';
import {fetchSignupAdmission,verifySignupAdmission} from '../src/lib/api/signup-admission';
import {apiPath} from '../src/lib/api/http';
afterEach(()=>vi.unstubAllGlobals());
it('uses the real /api route prefix, methods and credentials on ALL admission requests',async()=>{
 const calls:Array<{url:string;init:RequestInit}>=[];
 vi.stubGlobal('fetch',vi.fn(async(url:string,init:RequestInit)=>{
  calls.push({url,init});
  if(url===apiPath('/auth/signup-admission?flow=google')&&init.method==='GET')return Response.json({mode:'turnstile',siteKey:'synthetic-site-key',action:'signup'});
  if(url===apiPath('/auth/signup-admission/nonce')&&init.method==='POST')return Response.json({nonce:'n'.repeat(43)});
  if(url===apiPath('/auth/signup-admission')&&init.method==='POST')return Response.json({verified:true});
  throw Error('Wrong API route refused');
 }));
 const config=await fetchSignupAdmission('google');expect(config).toMatchObject({mode:'turnstile',nonce:'n'.repeat(43)});expect(await verifySignupAdmission('google','n'.repeat(43),'SYNTHETIC_TOKEN')).toEqual({verified:true});
 expect(calls.map(c=>new URL(c.url,'https://waka.im').pathname)).toEqual(['/api/auth/signup-admission','/api/auth/signup-admission/nonce','/api/auth/signup-admission']);
 expect(calls.map(c=>c.init.method)).toEqual(['GET','POST','POST']);expect(calls.every(c=>c.init.credentials==='include')).toBe(true);expect(calls.every(c=>!c.url.includes('SYNTHETIC_TOKEN'))).toBe(true);
 expect(JSON.parse(calls[1]!.init.body as string)).toEqual({flow:'google'});expect(JSON.parse(calls[2]!.init.body as string)).toEqual({flow:'google',nonce:'n'.repeat(43),token:'SYNTHETIC_TOKEN'});
});
it('does not issue a nonce POST when production is closed or local admission is off',async()=>{
 for(const mode of ['closed','off'] as const){const fetcher=vi.fn(async(_url:string,_init?:RequestInit)=>Response.json({mode}));vi.stubGlobal('fetch',fetcher);expect(await fetchSignupAdmission('password')).toEqual({mode});expect(fetcher).toHaveBeenCalledOnce();expect(fetcher.mock.calls[0]![0]).toBe(apiPath('/auth/signup-admission?flow=password'));}
});
