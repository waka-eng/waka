import {useCallback,useEffect,useRef,useState} from 'react';
import type {ProfileStorageScope} from './profile-storage';
import {readReviewSelections,recoverReviewSelections,settleReviewSelection,storeReviewSelection,type StoredReviewSelection} from './review-selection-drafts';

/** Store identities, not copied source text. Restored labels must come from
 * the current owned originals before Start is enabled. */
export function useReviewSelection(scope:ProfileStorageScope){
  const [current,setCurrent]=useState<StoredReviewSelection|null>(null),[drafts,setDrafts]=useState<StoredReviewSelection[]>([]),[error,setError]=useState(false);
  const live=useRef<StoredReviewSelection|null>(null),writer=useRef(crypto.randomUUID());
  const set=useCallback((row:StoredReviewSelection|null)=>{live.current=row;setCurrent(row);},[]);
  useEffect(()=>{
    set(null);setDrafts([]);setError(false);writer.current=crypto.randomUUID();
    try{const rows=readReviewSelections(scope);setDrafts(rows);set(rows[0]??null);}catch{setError(true);}
  },[scope.accountId,scope.profileId,set]);
  const write=(change:{ids?:string[];query?:string})=>{
    const old=live.current;
    const value={...(old?.value??{id:crypto.randomUUID(),writer:writer.current,ids:[],query:'',updatedAt:Date.now()}),...change,updatedAt:Date.now()};
    if(value.writer!==writer.current){value.id=crypto.randomUUID();value.writer=writer.current;}
    try{
      const saved=storeReviewSelection(scope,value,old??undefined);
      if(old&&old.id!==saved.id)settleReviewSelection(scope,old);
      set(saved);setDrafts(readReviewSelections(scope));setError(false);
    }catch{set({id:value.id,raw:old?.raw??'',value});setError(true);}
  };
  return {ids:current?.value.ids??[],query:current?.value.query??'',drafts,error,
    receipt:current?{id:current.id,raw:current.raw}:undefined,
    add:(id:string)=>{const ids=live.current?.value.ids??[];if(!ids.includes(id)&&ids.length<5)write({ids:[...ids,id],query:''});},
    remove:(id:string)=>write({ids:(live.current?.value.ids??[]).filter(item=>item!==id)}),
    setQuery:(query:string)=>write({query:query.slice(0,512)}),
    select:(row:StoredReviewSelection)=>set(row),
    recover:()=>{
      try{
        if(live.current)set(storeReviewSelection(scope,live.current.value,live.current));
        recoverReviewSelections(scope);const rows=readReviewSelections(scope);setDrafts(rows);set(rows.find(row=>row.id===live.current?.id)??rows[0]??null);setError(false);
      }catch{setError(true);}
    }};
}
