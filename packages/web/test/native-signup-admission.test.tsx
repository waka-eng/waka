// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY: `fetch`, `lib/auth-context`'s account boundary,
 * `lib/platform`'s OS bridge and `lib/platform/google-sign-in` pending state.
 * `VITE_API_URL` and `VITE_BUILD_TARGET` select the declared native fixture.
 * Real native API transport, public configuration
 * reader, origin checker and Login components run. No OS/browser/account/vendor
 * call. Existing Google pending-state storage is replaced to avoid OS access. */
import {act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const f=vi.hoisted(()=>({openBrowser:vi.fn(),signup:vi.fn(),login:vi.fn()}));
vi.mock('../src/lib/platform',()=>({isMobileBuild:true,platformServices:async()=>({openBrowser:f.openBrowser,credentials:{get:async()=>null,set:async()=>{},remove:async()=>{}}})}));
vi.mock('../src/lib/platform/google-sign-in',()=>({hasNativeGoogleSignIn:async()=>false}));
vi.mock('../src/lib/auth-context',()=>({useAuth:()=>f,hasSignedInHere:()=>false}));
import LoginPage,{SignupForm,LoginForm} from '../src/pages/Login';
import {ApiError} from '../src/lib/api';
import {t} from '../src/lib/locales';
let root:Root,host:HTMLDivElement,calls:Array<{url:string;method:string}>,mode:unknown;
(globalThis as typeof globalThis&{IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
beforeEach(()=>{
 vi.clearAllMocks();f.openBrowser.mockResolvedValue(undefined);vi.stubEnv('VITE_API_URL','https://waka.im');vi.stubEnv('VITE_BUILD_TARGET','mobile');
 host=document.createElement('div');document.body.append(host);root=createRoot(host);calls=[];mode={mode:'turnstile',siteKey:'synthetic-site-key',action:'signup'};
 vi.stubGlobal('fetch',vi.fn(async(url:string,init:RequestInit)=>{calls.push({url,method:init.method??'GET'});if(url!=='https://waka.im/api/auth/signup-admission?flow=password'||init.method!=='GET')throw Error('Unexpected mutation/endpoint');return Response.json(mode);}));
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllEnvs();vi.unstubAllGlobals();});
const render=async(node:React.ReactNode,path='/login')=>{await act(async()=>root.render(createElement(MemoryRouter,{initialEntries:[path]},node)));};
const fill=async(values:Record<string,string>)=>{for(const [name,value] of Object.entries(values))await act(async()=>{const field=host.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(field,value);field.dispatchEvent(new Event('input',{bubbles:true}));});};
it.each(['en-US','ko-KR'] as const)('hands configured native password signup to the checked browser without a native POST %s',async locale=>{
 await render(createElement(SignupForm,{locale}));expect(host.textContent).toContain(t(locale,'signupNativeBrowserHint'));expect(host.querySelector('form')).toBeNull();
 await act(async()=>host.querySelector<HTMLButtonElement>('button')!.click());expect(f.openBrowser).toHaveBeenCalledExactlyOnceWith('https://waka.im/login?signup=1');
 expect(calls).toEqual([{url:'https://waka.im/api/auth/signup-admission?flow=password',method:'GET'}]);expect(f.signup).not.toHaveBeenCalled();expect(document.querySelector('script[src*="cloudflare"]')).toBeNull();
});
it.each([{mode:'closed'},null,{mode:'invalid'}])('holds unavailable/malformed native configuration without account or proof writes %#',async value=>{
 mode=value;await render(createElement(SignupForm,{locale:'en-US'}));expect(host.textContent).toContain(t('en-US','signupVerificationUnavailable'));expect(host.querySelector('form')).toBeNull();expect(f.openBrowser).not.toHaveBeenCalled();expect(f.signup).not.toHaveBeenCalled();expect(calls).toHaveLength(1);
});
it('holds a failed public read without loading the widget or dispatching mutations',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>{throw Error('SYNTHETIC_PRIVATE_NETWORK');}));await render(createElement(SignupForm,{locale:'en-US'}));expect(host.textContent).toContain(t('en-US','signupVerificationUnavailable'));expect(host.textContent).not.toContain('SYNTHETIC');expect(f.signup).not.toHaveBeenCalled();expect(f.openBrowser).not.toHaveBeenCalled();
});
it('preserves OFF native password signup after exactly one readonly configuration GET',async()=>{
 mode={mode:'off'};f.signup.mockResolvedValue({account:{id:'synthetic-new-account'}});await render(createElement(SignupForm,{locale:'en-US'}));await fill({email:'synthetic@example.test',password:'synthetic-password-123'});
 await act(async()=>host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));expect(f.signup).toHaveBeenCalledOnce();expect(calls).toHaveLength(1);expect(calls[0]!.method).toBe('GET');expect(f.openBrowser).not.toHaveBeenCalled();
});
it('keeps native OFF signup usable after duplicate email, then submits the corrected email',async()=>{
 mode={mode:'off'};f.signup.mockRejectedValueOnce(new ApiError({status:409,message:'Email already exists'})).mockResolvedValueOnce({account:{id:'synthetic-corrected-account'}});
 await render(createElement(SignupForm,{locale:'en-US'}));await fill({email:'duplicate@example.test',password:'synthetic-password-123'});
 await act(async()=>host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));expect(f.signup).toHaveBeenCalledOnce();expect(host.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(false);
 await fill({email:'corrected@example.test'});await act(async()=>host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 expect(f.signup.mock.calls.map(c=>c[0].email)).toEqual(['duplicate@example.test','corrected@example.test']);expect(calls).toHaveLength(1);expect(f.openBrowser).not.toHaveBeenCalled();
});
it.each([new ApiError({status:503,message:'unknown'}),new ApiError({status:403,message:'policy closed',code:'signup_closed'})])('does not reopen native OFF signup after unknown/policy refusal %#',async error=>{
 mode={mode:'off'};f.signup.mockRejectedValueOnce(error);await render(createElement(SignupForm,{locale:'en-US'}));await fill({email:'synthetic@example.test',password:'synthetic-password-123'});
 const form=host.querySelector('form')!;await act(async()=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));expect(host.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(true);await act(async()=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));expect(f.signup).toHaveBeenCalledOnce();
});
it('refuses an untrusted origin before public fetch or OS browser dispatch',async()=>{
 vi.stubEnv('VITE_API_URL','https://untrusted.example');await render(createElement(SignupForm,{locale:'en-US'}));expect(calls).toHaveLength(0);expect(f.openBrowser).not.toHaveBeenCalled();expect(host.textContent).toContain(t('en-US','signupVerificationUnavailable'));
});
it('rechecks the trusted origin at the browser handoff seam',async()=>{
 await render(createElement(SignupForm,{locale:'en-US'}));vi.stubEnv('VITE_API_URL','https://untrusted.example');await act(async()=>host.querySelector<HTMLButtonElement>('button')!.click());expect(f.openBrowser).not.toHaveBeenCalled();expect(host.textContent).toContain(t('en-US','signupVerificationUnavailable'));expect(calls).toHaveLength(1);
});
it('keeps returning password login independent of signup readiness',async()=>{
 f.login.mockResolvedValue({account:{id:'synthetic-existing-account'}});await render(createElement(LoginForm));await fill({email:'synthetic@example.test',password:'old'});await act(async()=>host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));expect(f.login).toHaveBeenCalledOnce();expect(calls).toHaveLength(0);expect(f.openBrowser).not.toHaveBeenCalled();
});
it('a literal signup routing hint selects only the tab; closed admission cannot create',async()=>{
 mode={mode:'closed'};await render(createElement(LoginPage),'/login?signup=1');expect(host.querySelector('#login-tab-signup')?.getAttribute('aria-selected')).toBe('true');expect(f.signup).not.toHaveBeenCalled();expect(calls).toHaveLength(1);
 await act(async()=>host.querySelector<HTMLButtonElement>('#login-tab-login')!.click());expect(host.querySelector('input[name=password]')).not.toBeNull();expect(calls).toHaveLength(1);
});
