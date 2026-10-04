import {useEffect,useRef,useState} from 'react';
import {startConversation} from '../lib/conversation-start';
import type {ProfileStorageScope} from '../lib/profile-storage';
import {t,type SupportedLocale} from '../lib/locales';
export function ConversationStartButton({scope,principleId,locale,onStarted}:{scope:ProfileStorageScope;principleId:string;locale:SupportedLocale;onStarted:(id:string)=>void}){
  const [busy,setBusy]=useState(false),[failed,setFailed]=useState(false),controller=useRef<AbortController|null>(null);
  useEffect(()=>()=>controller.current?.abort(),[scope.accountId,scope.profileId,principleId]);
  const start=async()=>{if(busy)return;const request=new AbortController();controller.current=request;const timer=window.setTimeout(()=>request.abort(),15000);setBusy(true);setFailed(false);
    try{const row=await startConversation(scope,request.signal,principleId);if(!request.signal.aborted)onStarted(row.id);}catch{if(controller.current===request)setFailed(true);}finally{window.clearTimeout(timer);if(controller.current===request)setBusy(false);}};
  return <><button type="button" disabled={busy} onClick={()=>void start()}>{t(locale,busy?'worldConversationStarting':'worldConversationFromPrinciple')}</button>{failed?<span role="alert">{t(locale,'worldConversationStartFailed')}</span>:null}</>;
}
