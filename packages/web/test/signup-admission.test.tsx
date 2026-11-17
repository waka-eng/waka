// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY: the existing API seam and documented widget
 * render/callback seam. Real SignupAdmission/Google/Login components render;
 * `lib/api` and `lib/auth-context` replace HTTP/session boundaries; the widget
 * callback and `document.head.append` are local fakes. No external script,
 * challenge, identity or account request reaches a server. */
import {act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
vi.mock('../src/lib/api',async original=>({...await original<typeof import('../src/lib/api')>(),fetchSignupAdmission:vi.fn(),verifySignupAdmission:vi.fn()}));
const auth=vi.hoisted(()=>({signup:vi.fn()}));
vi.mock('../src/lib/auth-context',()=>({useAuth:()=>auth}));
import {fetchSignupAdmission,verifySignupAdmission,ApiError} from '../src/lib/api';
import {SignupAdmission} from '../src/components/SignupAdmission';
import {GoogleSignInButton,googleLoginUrl} from '../src/components/GoogleSignIn';
import {SignupForm} from '../src/pages/Login';
import {t} from '../src/lib/locales';
let root:Root,host:HTMLDivElement,callback:(token:string)=>void,options:Record<string,unknown>;
(globalThis as typeof globalThis&{IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
beforeEach(()=>{
 host=document.createElement('div');document.body.append(host);root=createRoot(host);vi.clearAllMocks();
 vi.mocked(fetchSignupAdmission).mockResolvedValue({mode:'turnstile',siteKey:'synthetic-site-key',action:'signup',nonce:'n'.repeat(43)});vi.mocked(verifySignupAdmission).mockResolvedValue({verified:true});
 window.turnstile={render:vi.fn((_host,input)=>{options=input;callback=input.callback;return 'synthetic-widget';}),remove:vi.fn()};
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();delete window.turnstile;vi.unstubAllGlobals();vi.restoreAllMocks();vi.useRealTimers();});
const render=async(node:React.ReactNode)=>{await act(async()=>root.render(node));};
it.each(['en-US','ko-KR'] as const)('requires a real verified callback before readiness, localizes %s, and submits a proof once',async locale=>{
 const ready=vi.fn();await render(createElement(SignupAdmission,{flow:'password',locale,onReady:ready}));expect(host.textContent).toContain(t(locale,'signupVerificationRequired'));expect(options).toMatchObject({action:'signup',cData:'n'.repeat(43),size:'compact'});expect(ready).not.toHaveBeenCalledWith(true);
 await act(async()=>{callback('synthetic-token');callback('synthetic-token');});expect(verifySignupAdmission).toHaveBeenCalledOnce();expect(verifySignupAdmission).toHaveBeenCalledWith('password','n'.repeat(43),'synthetic-token',expect.any(AbortSignal));expect(ready).toHaveBeenLastCalledWith(true);expect(host.textContent).toContain(t(locale,'signupVerified'));expect(document.querySelector('script[src*="challenges.cloudflare.com"]')).toBeNull();
});
it.each(['en-US','ko-KR'] as const)('keeps Google returning sign-in independent of unavailable signup %s',async locale=>{
 vi.mocked(fetchSignupAdmission).mockRejectedValue(new Error('private failure'));await render(createElement(GoogleSignInButton,{locale}));expect(fetchSignupAdmission).not.toHaveBeenCalled();expect(host.querySelector<HTMLButtonElement>('button')!.disabled).toBe(false);
 await render(createElement(GoogleSignInButton,{locale,needsVerification:true}));expect(host.textContent).toContain(t(locale,'signupVerificationUnavailable'));expect([...host.querySelectorAll('button')].find(b=>b.textContent===t(locale,'loginGoogleContinue'))!.disabled).toBe(false);
});
it('holds a failed verification and requires an explicit retry with a fresh nonce',async()=>{
 vi.mocked(verifySignupAdmission).mockRejectedValueOnce(new ApiError({status:503,message:'private unknown'}));const ready=vi.fn();await render(createElement(SignupAdmission,{flow:'google',locale:'en-US',onReady:ready}));await act(async()=>callback('old-token'));
 expect(ready).not.toHaveBeenCalledWith(true);expect(host.textContent).not.toContain('private unknown');expect(fetchSignupAdmission).toHaveBeenCalledTimes(1);
 await act(async()=>host.querySelector<HTMLButtonElement>('button')!.click());expect(fetchSignupAdmission).toHaveBeenCalledTimes(2);expect(verifySignupAdmission).toHaveBeenCalledTimes(1);
});
it.each(['en-US','ko-KR'] as const)('does not recreate an ambiguously committed password account %s',async locale=>{
 auth.signup.mockRejectedValueOnce(new ApiError({status:0,message:'network unknown'}));vi.mocked(fetchSignupAdmission).mockResolvedValue({mode:'off'});
 await render(createElement(MemoryRouter,null,createElement(SignupForm,{locale})));
 for(const [name,value] of [['email','synthetic@example.test'],['password','synthetic-password-123'],['name','Synthetic']]){await act(async()=>{const field=host.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(field,value);field.dispatchEvent(new Event('input',{bubbles:true}));});}
 const form=host.querySelector('form')!;await act(async()=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));expect(auth.signup).toHaveBeenCalledOnce();expect(host.textContent).toContain(t(locale,'signupOutcomeUnknown'));expect(host.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(true);
 await act(async()=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));expect(auth.signup).toHaveBeenCalledOnce();
});
it('keeps native continuation as a boolean routing flag, never a grant/token URL',()=>{
 const url=new URL(googleLoginUrl('/memory',true),'https://waka.im');expect([...url.searchParams.keys()].sort()).toEqual(['mobile','returnTo']);expect(url.searchParams.get('mobile')).toBe('1');
});

it('holds a blocked widget script with a bounded visible retry, without inserting a real resource',async()=>{
 delete window.turnstile;vi.useFakeTimers();const append=vi.spyOn(document.head,'append').mockImplementation(()=>{});const ready=vi.fn();await render(createElement(SignupAdmission,{flow:'password',locale:'en-US',onReady:ready}));expect(append).toHaveBeenCalledOnce();await act(async()=>vi.advanceTimersByTimeAsync(15000));expect(host.textContent).toContain(t('en-US','signupVerificationUnavailable'));expect(ready).not.toHaveBeenCalledWith(true);expect(verifySignupAdmission).not.toHaveBeenCalled();
});

it.each([null,{}, {verified:false},{verified:true,extraRaw:'SYNTHETIC_RAW_SENTINEL'}])('holds malformed resolved verification responses with a visible retry %#',async value=>{
 vi.mocked(verifySignupAdmission).mockResolvedValueOnce(value as never);const ready=vi.fn();await render(createElement(SignupAdmission,{flow:'password',locale:'en-US',onReady:ready}));await act(async()=>callback('synthetic-token'));expect(host.textContent).toContain(t('en-US','signupVerificationUnavailable'));expect(ready).not.toHaveBeenCalledWith(true);expect(host.textContent).not.toContain('SYNTHETIC_RAW');
});
it('expires verified readiness conservatively and requires explicit retry',async()=>{
 vi.useFakeTimers();const ready=vi.fn();await render(createElement(SignupAdmission,{flow:'password',locale:'en-US',onReady:ready}));await act(async()=>callback('synthetic-token'));expect(ready).toHaveBeenLastCalledWith(true);await act(async()=>vi.advanceTimersByTimeAsync(270001));expect(ready).toHaveBeenLastCalledWith(false);expect(host.textContent).toContain(t('en-US','signupVerificationUnavailable'));expect(fetchSignupAdmission).toHaveBeenCalledOnce();
});
it('ignores a first callback after local proof expiry',async()=>{
 vi.useFakeTimers();const ready=vi.fn();await render(createElement(SignupAdmission,{flow:'password',locale:'en-US',onReady:ready}));await act(async()=>vi.advanceTimersByTimeAsync(270001));await act(async()=>callback('late-token'));expect(verifySignupAdmission).not.toHaveBeenCalled();expect(ready).not.toHaveBeenCalledWith(true);
});
it('starts the expiry budget BEFORE a slow bootstrap and never mounts a late widget',async()=>{
 vi.useFakeTimers();let finish!:(v:Awaited<ReturnType<typeof fetchSignupAdmission>>)=>void;vi.mocked(fetchSignupAdmission).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));await render(createElement(SignupAdmission,{flow:'password',locale:'en-US'}));await act(async()=>vi.advanceTimersByTimeAsync(270001));await act(async()=>finish({mode:'turnstile',siteKey:'synthetic-site-key',action:'signup',nonce:'n'.repeat(43)}));expect(window.turnstile!.render).not.toHaveBeenCalled();expect(host.textContent).toContain(t('en-US','signupVerificationUnavailable'));
});

it('invalidates definite duplicate-email409 proof and offers fresh verification before a different signup',async()=>{
 auth.signup.mockRejectedValueOnce(new ApiError({status:409,message:'An account with this email already exists'}));await render(createElement(MemoryRouter,null,createElement(SignupForm,{locale:'en-US'})));
 for(const [name,value] of [['email','synthetic@example.test'],['password','synthetic-password-123'],['name','Synthetic']])await act(async()=>{const field=host.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(field,value);field.dispatchEvent(new Event('input',{bubbles:true}));});
 await act(async()=>callback('first-token'));expect(host.textContent).toContain(t('en-US','signupVerified'));await act(async()=>host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 expect(auth.signup).toHaveBeenCalledOnce();expect(fetchSignupAdmission).toHaveBeenCalledTimes(2);expect(host.textContent).not.toContain(t('en-US','signupVerified'));expect(host.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(true);
 await act(async()=>callback('second-token'));expect(host.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(false);
});

it('ignores a verification response that arrives after readiness expired',async()=>{
 vi.useFakeTimers();let finish!:(v:{verified:true})=>void;vi.mocked(verifySignupAdmission).mockImplementationOnce(()=>new Promise(r=>{finish=r;}));const ready=vi.fn();await render(createElement(SignupAdmission,{flow:'password',locale:'en-US',onReady:ready}));await act(async()=>callback('token'));await act(async()=>vi.advanceTimersByTimeAsync(270001));await act(async()=>finish({verified:true}));expect(ready).not.toHaveBeenCalledWith(true);expect(host.textContent).toContain(t('en-US','signupVerificationUnavailable'));expect(verifySignupAdmission).toHaveBeenCalledOnce();
});
