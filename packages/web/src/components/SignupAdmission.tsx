import {useEffect,useRef,useState} from 'react';
import {fetchSignupAdmission,fetchSignupAdmissionConfiguration,verifySignupAdmission,type SignupAdmissionConfiguration} from '../lib/api';
import {t,type SupportedLocale} from '../lib/locales';
import {platformServices} from '../lib/platform';
import {checkedNativeApiOrigin} from '../lib/platform/api-origin';
type Turnstile={render:(container:HTMLElement,options:{sitekey:string;action:string;cData:string;size:'compact';callback:(token:string)=>void;'error-callback':()=>void;'expired-callback':()=>void})=>string;remove:(id:string)=>void};
declare global{interface Window{turnstile?:Turnstile;}}
let loading:Promise<Turnstile>|undefined;
function widget():Promise<Turnstile>{
 if(window.turnstile)return Promise.resolve(window.turnstile);
 if(!loading)loading=new Promise((resolve,reject)=>{
  const script=document.createElement('script');script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';script.async=true;
  let finished=false;const fail=()=>{if(finished)return;finished=true;clearTimeout(timer);loading=undefined;script.remove();reject(new Error('Verification unavailable'));};
  const timer=setTimeout(fail,15000);script.onload=()=>{if(finished)return;if(!window.turnstile){fail();return;}finished=true;clearTimeout(timer);resolve(window.turnstile);};
  script.onerror=fail;document.head.append(script);
 });return loading;
}
/** WebView cookies intentionally stay separate. Only OFF may use the native
 * password form; configured human verification opens the trusted web surface. */
export function NativePasswordSignup({locale,children}:{locale:SupportedLocale;children:React.ReactNode}){
 const [mode,setMode]=useState<'loading'|'off'|'handoff'|'closed'>('loading'),[failed,setFailed]=useState(false),opening=useRef(false);
 useEffect(()=>{
  const controller=new AbortController();let stopped=false;
  void fetchSignupAdmissionConfiguration('password',controller.signal).then(value=>{
   if(stopped)return;
   setMode(value?.mode==='off'?'off':value?.mode==='turnstile'?'handoff':'closed');
  }).catch(()=>{if(!stopped)setMode('closed');});
  return ()=>{stopped=true;controller.abort();};
 },[]);
 async function open(){
  if(opening.current)return;opening.current=true;setFailed(false);
  try{const url=checkedNativeApiOrigin() + '/login?' + new URLSearchParams({ signup: '1', preferredLocale: locale });await (await platformServices()).openBrowser(url);}
  catch{setFailed(true);}finally{opening.current=false;}
 }
 if(mode==='off')return <>{children}</>;
 return <div>
  <p className="waka-settings-note" role="status">{t(locale,mode==='loading'?'signupVerificationChecking':mode==='handoff'&&!failed?'signupNativeBrowserHint':'signupVerificationUnavailable')}</p>
  {mode==='handoff'&&<button type="button" className="btn-primary btn-doorway" onClick={()=>void open()}>{t(locale,'signupOpenBrowser')}</button>}
 </div>;
}
/** Only the explicit new-account surface loads the human widget. Returning
 * sign-in does not mount this component or depend on its readiness. */
export function SignupAdmission({flow,locale,onReady}:{flow:'password'|'google';locale:SupportedLocale;onReady?:(ready:boolean)=>void}){
 const host=useRef<HTMLDivElement>(null),callback=useRef(onReady);callback.current=onReady;
 const [config,setConfig]=useState<SignupAdmissionConfiguration|null>(null),[state,setState]=useState<'loading'|'checking'|'required'|'verified'|'failed'>('loading'),[revision,setRevision]=useState(0);
 useEffect(()=>{
  const controller=new AbortController();let stopped=false,expired=false,submitted=false,id:string|undefined,adapter:Turnstile|undefined;
  // Start BEFORE config/nonce/script work. A conservative270s local window
  // cannot extend the server's300s signed proof. Check both awaits and callbacks.
  const wallDeadline=Date.now()+270000,monoDeadline=performance.now()+270000;
  const active=()=>!stopped&&!expired&&Date.now()<wallDeadline&&performance.now()<monoDeadline;
  const expire=()=>{if(stopped||expired)return;expired=true;controller.abort();if(adapter&&id){adapter.remove(id);id=undefined;}setState('failed');callback.current?.(false);};
  const expiry=setTimeout(expire,270000);
  callback.current?.(false);setState('loading');setConfig(null);
  void fetchSignupAdmission(flow,controller.signal).then(async value=>{
   if(!active()){expire();return;}setConfig(value);
   if(value.mode==='off'){clearTimeout(expiry);callback.current?.(true);return;}
   if(value.mode!=='turnstile'){clearTimeout(expiry);setState('failed');return;}
   if(typeof value.siteKey!=='string'||value.siteKey.length>256||!value.siteKey||value.action!=='signup'||!/^[A-Za-z0-9_-]{43}$/.test(value.nonce))throw new Error('Verification unavailable');
   adapter=await widget();if(!active()){expire();return;}if(!host.current)return;setState('required');
   id=adapter.render(host.current,{sitekey:value.siteKey,action:value.action,cData:value.nonce,size:'compact',
    callback:token=>{
     if(!active()){expire();return;}if(submitted)return;submitted=true;setState('checking');
     void verifySignupAdmission(flow,value.nonce,token,controller.signal).then(result=>{
      if(!active()){expire();return;}
      if(!result||typeof result!=='object'||Array.isArray(result)||Object.keys(result).join()!=='verified'||result.verified!==true)throw new Error('Verification unavailable');
      setState('verified');callback.current?.(true);
     }).catch(()=>{if(active()){setState('failed');callback.current?.(false);}});
    },
    'error-callback':()=>{if(active()){setState('failed');callback.current?.(false);}},
    'expired-callback':()=>{if(active()){setState('failed');callback.current?.(false);}},
   });
  }).catch(()=>{if(active())setState('failed');});
  return ()=>{stopped=true;clearTimeout(expiry);controller.abort();if(adapter&&id)adapter.remove(id);};
 },[flow,revision]);
 if(config?.mode==='off')return null;
 return <div>
  <p className="waka-settings-note" role="status">{t(locale,state==='verified'?'signupVerified':state==='failed'?'signupVerificationUnavailable':state==='checking'||state==='loading'?'signupVerificationChecking':'signupVerificationRequired')}</p>
  <div ref={host}/>
  {state==='failed'&&<button type="button" className="login-link" onClick={()=>setRevision(v=>v+1)}>{t(locale,'signupVerificationRetry')}</button>}
 </div>;
}
