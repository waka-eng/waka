import {createConversation} from './api/conversations';
import {profileStorageKey,type ProfileStorageScope} from './profile-storage';
/** The durable id is retained until creation is confirmed, including when a
 * Principle entry loses its response. No message is generated or submitted. */
export async function startConversation(scope:ProfileStorageScope,signal?:AbortSignal,principleId?:string){
  const key=profileStorageKey(scope,principleId?`conversation:new:${principleId}`:'conversation:new')!;
  const id=localStorage.getItem(key)??crypto.randomUUID();localStorage.setItem(key,id);
  const row=await createConversation(scope.profileId,id,signal,principleId);
  if(signal?.aborted)throw new Error('Conversation view closed');
  if(localStorage.getItem(key)===id)localStorage.removeItem(key);return row;
}
