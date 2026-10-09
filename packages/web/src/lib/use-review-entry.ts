import {useEffect,useState} from 'react';
import {fetchActiveReview,type ApiReviewSession} from './api';
import type {ProfileStorageScope} from './profile-storage';
import {t,type SupportedLocale} from './locales';

/** A scoped read only: opening the home never starts or advances a review. */
export function useReviewEntry(scope:ProfileStorageScope|null,refreshKey:string|null|undefined,locale:SupportedLocale){
  const [entry,setEntry]=useState<{owner:string;session:ApiReviewSession|null}|null>(null);
  const owner=scope?`${scope.accountId}:${scope.profileId}`:null;
  const reviewing=Boolean(refreshKey);
  useEffect(()=>{
    if(!scope||!owner||reviewing)return;
    const controller=new AbortController();
    const timeout=window.setTimeout(()=>controller.abort(),15000);
    void fetchActiveReview(scope.profileId,controller.signal).then(session=>{
      if(!controller.signal.aborted)setEntry({owner,session:session?.profileId===scope.profileId&&!session.completedAt?session:null});
    }).catch(()=>{if(!controller.signal.aborted)setEntry(null);}).finally(()=>window.clearTimeout(timeout));
    return()=>{controller.abort();window.clearTimeout(timeout);};
  },[owner,reviewing]);
  const session=entry?.owner===owner?entry?.session:null;
  return {resuming:Boolean(session),label:t(locale,'worldReviewTitle')};
}
