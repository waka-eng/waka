import type {ProfileStorageScope} from './profile-storage';

/** Account-scoped, memory-only summary snapshots. Never a source for models
 * or current evidence. Every reuse checks the server's owned material manifest. */
type Snapshot<T>={key:string;fingerprint:string;data:T};
type Flight<T>={controller:AbortController;promise:Promise<T>;users:number;settled:boolean};
let owner:string|null=null,epoch=0;
let snapshot:Snapshot<unknown>|null=null;
const flights=new Map<string,Flight<unknown>>();
const aborted=()=>new DOMException('Snapshot read superseded','AbortError');
const ownerKey=(scope:ProfileStorageScope)=>`${scope.accountId}:${scope.profileId}`;

export function setInspirationSnapshotOwner(scope:ProfileStorageScope|null){
  const next=scope?ownerKey(scope):null;if(next===owner)return;
  owner=next;epoch++;snapshot=null;
  for(const flight of flights.values())flight.controller.abort();flights.clear();
}

export function inspirationSourceRevision() { return epoch; }

export function invalidateInspirationSnapshots(){epoch++;snapshot=null;}

/** Attempts count too: a server may commit a source write whose reply is lost. */
export function invalidateSourceRequest(path:string){
  const pathname=new URL(path,'http://waka.invalid').pathname;
  if(/^\/api\/(inspirations|attachments)(\/|$)/.test(pathname))invalidateInspirationSnapshots();
}

export async function readInspirationSnapshot<T>(options:{scope:ProfileStorageScope;profileId:string;signal?:AbortSignal;
  validate:(signal:AbortSignal)=>Promise<string|null>;
  load:(signal:AbortSignal)=>Promise<{data:T;fingerprint:string|null}>;
}):Promise<T>{
  if(options.signal?.aborted)throw aborted();
  setInspirationSnapshotOwner(options.scope);
  const expectedOwner=ownerKey(options.scope),key=`${expectedOwner}:${options.profileId}`;
  let flight=flights.get(key) as Flight<T>|undefined;
  if(!flight||flight.controller.signal.aborted){
    const controller=new AbortController();
    const created={controller,users:0,settled:false} as Flight<T>;
    const current=()=>{if(controller.signal.aborted||owner!==expectedOwner)throw aborted();};
    created.promise=(async()=>{
      for(let attempt=0;attempt<2;attempt++){
        const version=epoch,previous=snapshot?.key===key?snapshot as Snapshot<T>:null;
        if(previous){
          try{
            const fingerprint=await options.validate(controller.signal);current();
            if(version!==epoch)continue;
            if(fingerprint&&fingerprint===previous.fingerprint)return previous.data;
            snapshot=null;
          }catch(error){if(snapshot?.key===key)snapshot=null;throw error;}
        }
        const loaded=await options.load(controller.signal);current();
        if(version!==epoch)continue;
        if(loaded.fingerprint)snapshot={key,fingerprint:loaded.fingerprint,data:structuredClone(loaded.data)};
        return loaded.data;
      }
      throw aborted();
    })().finally(()=>{created.settled=true;if(flights.get(key)===created)flights.delete(key);});
    flight=created;flights.set(key,created as Flight<unknown>);
  }
  const active=flight;active.users++;
  return new Promise<T>((resolve,reject)=>{
    let done=false;
    const release=()=>{
      options.signal?.removeEventListener('abort',cancel);active.users--;
      if(!active.users&&!active.settled){active.controller.abort();if(flights.get(key)===active)flights.delete(key);}
    };
    const cancel=()=>{if(done)return;done=true;release();reject(aborted());};
    options.signal?.addEventListener('abort',cancel,{once:true});
    active.promise.then(value=>{if(done)return;done=true;release();resolve(structuredClone(value));},error=>{if(done)return;done=true;release();reject(error);});
  });
}

/** Wire policy shared with the API: newest-first identity/revision pairs,
 * profile and exact total. A generation revision is deliberately not used. */
export async function inspirationSnapshotFingerprint(profileId:string,total:number,items:ReadonlyArray<{id:string;materialRevision?:string|null}>):Promise<string|null>{
  if(!globalThis.crypto?.subtle||items.length!==Math.min(total,2000)||new Set(items.map(row=>row.id)).size!==items.length||
    items.some(row=>!row.materialRevision||!/^[1-9]\d{0,18}$/.test(row.materialRevision)))return null;
  const input=JSON.stringify({policy:'inspiration-snapshot-v1',profileId,total,items:items.map(row=>[row.id,row.materialRevision])});
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
}
