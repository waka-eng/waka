import {apiPath,getJson,postJson} from './http';
export type SignupAdmissionPublicConfiguration={mode:'off'|'closed'}|{mode:'turnstile';siteKey:string;action:'signup'};
export type SignupAdmissionConfiguration={mode:'off'|'closed'}|{mode:'turnstile';siteKey:string;action:'signup';nonce:string};
/** Readiness only: native signup must never bootstrap web-cookie proof here. */
export const fetchSignupAdmissionConfiguration=(flow:'password'|'google',signal?:AbortSignal)=>getJson<SignupAdmissionPublicConfiguration>(apiPath(`/auth/signup-admission?flow=${flow}`),'Verification is unavailable',signal);
export async function fetchSignupAdmission(flow:'password'|'google',signal?:AbortSignal):Promise<SignupAdmissionConfiguration>{
 const config=await fetchSignupAdmissionConfiguration(flow,signal);
 if(config.mode!=='turnstile')return config;
 const proof=await postJson<{nonce:string}>(apiPath('/auth/signup-admission/nonce'),{flow},'Verification is unavailable',signal);
 return {...config,nonce:proof.nonce};
}
export const verifySignupAdmission=(flow:'password'|'google',nonce:string,token:string,signal?:AbortSignal)=>postJson<{verified:true}>(apiPath('/auth/signup-admission'),{flow,nonce,token},'Verification did not finish',signal);
