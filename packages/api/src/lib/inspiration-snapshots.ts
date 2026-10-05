import {createHash} from 'node:crypto';
import {and,desc,eq,sql} from 'drizzle-orm';
import {inspirationRevisions,inspirations} from '../db/index.js';
import type {getDb} from './db.js';

export async function readInspirationSnapshot(db:ReturnType<typeof getDb>,profileId:string){
  return db.transaction(async tx=>{
    const [count]=await tx.select({total:sql<number>`count(*)::int`}).from(inspirations).where(eq(inspirations.profileId,profileId));
    const rows=await tx.select({id:inspirations.id,materialRevision:sql<string|null>`${inspirationRevisions.personalRevision}::text`})
      .from(inspirations).leftJoin(inspirationRevisions,and(eq(inspirationRevisions.profileId,inspirations.profileId),eq(inspirationRevisions.inspirationId,inspirations.id)))
      .where(eq(inspirations.profileId,profileId)).orderBy(desc(inspirations.createdAt),desc(inspirations.id)).limit(2000);
    const total=Number(count?.total??0);
    const fingerprint=rows.length===Math.min(total,2000)&&rows.every(row=>row.materialRevision)
      ?createHash('sha256').update(JSON.stringify({policy:'inspiration-snapshot-v1',profileId,total,items:rows.map(row=>[row.id,row.materialRevision])})).digest('hex'):null;
    return {profileId,total,fingerprint};
  },{isolationLevel:'repeatable read',accessMode:'read only'});
}
