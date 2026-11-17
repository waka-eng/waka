/** Operator admission bounds, checked again at the actual fetch seam. */
export interface EmbeddingDispatchDeadline{expiresAtMs:number;deadlineAtMs:number}
export class EmbeddingDispatchExpired extends Error{
 constructor(){super('Embedding dispatch approval or deadline expired');this.name='EmbeddingDispatchExpired';}
}
export function assertEmbeddingDispatchDeadline(deadline:EmbeddingDispatchDeadline,now=Date.now()){
 if(!Number.isFinite(deadline.expiresAtMs)||!Number.isFinite(deadline.deadlineAtMs)||!Number.isFinite(now)||now>=deadline.expiresAtMs||now>=deadline.deadlineAtMs)throw new EmbeddingDispatchExpired();
}
